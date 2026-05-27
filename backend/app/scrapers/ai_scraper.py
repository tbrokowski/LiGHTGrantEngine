"""
AI-powered general-purpose scraper.

Renders pages with Playwright (handles JS-heavy sites), extracts readable text,
then asks the LLM to parse out grant/funding opportunities as structured JSON.

No per-site CSS selector configuration required — just a URL.

scraper_config keys:
  crawl_depth    (int, 0 or 1, default 0)  — follow listing links to detail pages
  link_filter    (str, optional regex)      — restrict which detail links to follow
  use_playwright (bool, default True)       — False forces plain httpx (no JS rendering)
"""
import re
import json
import asyncio
import structlog

from app.scrapers.base import BaseScraper

logger = structlog.get_logger()

_STRIP_TAGS = [
    "script", "style", "nav", "header", "footer", "aside",
    "noscript", "iframe", "form", "button", "svg",
]

_EXTRACTION_SYSTEM = """\
You are a grant discovery assistant. Given the text content of a webpage, \
extract every grant or funding opportunity mentioned.

Return a JSON object in exactly this shape:
{
  "opportunities": [
    {
      "title": "...",
      "funder": "...",
      "description": "...",
      "url": "...",
      "deadline": "...",
      "program": "..."
    }
  ]
}

Rules:
- Use null for any field that is unknown or not present.
- url MUST be the direct link to the individual grant/call page. Never use the
  funder homepage, domain root, or generic grants/funding landing page.
- Prefer URLs from the "Available links" list when they match an opportunity.
- If the specific call URL cannot be determined, set url to null.
- If no grants are found, return {"opportunities": []}.
- Do not include any prose or markdown outside the JSON.
"""

_MAX_PAGE_CHARS = 100_000  # GPT-4o 128k context window handles full grant pages
_MAX_DETAIL_LINKS = 10   # cap detail pages per run to avoid long task times


def _extract_page_links(soup, base_url: str) -> list[tuple[str, str]]:
    """Return unique (anchor_text, absolute_href) pairs from a parsed page."""
    from urllib.parse import urljoin

    links: list[tuple[str, str]] = []
    seen: set[str] = set()
    for anchor in soup.find_all("a", href=True):
        href = anchor["href"].strip()
        if not href or href.startswith(("#", "mailto:", "javascript:", "tel:")):
            continue
        abs_href = urljoin(base_url, href)
        if abs_href in seen:
            continue
        seen.add(abs_href)
        text = anchor.get_text(separator=" ", strip=True)
        if text:
            links.append((text, abs_href))
    return links


def _fetch_page_text(url: str, use_playwright: bool) -> tuple[str, list[tuple[str, str]]]:
    """Fetch a page and return (cleaned_text, list_of_anchor_text_and_hrefs)."""
    from bs4 import BeautifulSoup

    html = ""
    if use_playwright:
        try:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                page = browser.new_page()
                page.goto(url, timeout=30000, wait_until="domcontentloaded")
                page.wait_for_timeout(2000)  # allow JS to settle
                html = page.content()
                browser.close()
        except Exception as e:
            logger.warning("Playwright failed, falling back to httpx", error=str(e))
            html = ""

    if not html:
        import httpx
        resp = httpx.get(
            url, timeout=30, follow_redirects=True,
            headers={"User-Agent": "LiGHT Grant System/1.0"},
        )
        resp.raise_for_status()
        html = resp.text

    soup = BeautifulSoup(html, "lxml")
    for tag in soup(_STRIP_TAGS):
        tag.decompose()

    page_links = _extract_page_links(soup, url)

    # Prefer semantic content blocks over full page noise
    content_el = (
        soup.find("main")
        or soup.find("article")
        or soup.find(id=re.compile(r"content|main", re.I))
        or soup.find(class_=re.compile(r"content|listing|results|grants|funding", re.I))
    )
    raw_text = (content_el or soup).get_text(separator="\n", strip=True)
    raw_text = re.sub(r"[ \t]+", " ", raw_text)
    raw_text = re.sub(r"\n{3,}", "\n\n", raw_text)
    return raw_text.strip()[:_MAX_PAGE_CHARS], page_links


async def _llm_extract(
    page_text: str,
    source_name: str,
    page_links: list[tuple[str, str]] | None = None,
) -> list[dict]:
    """Send page text to the LLM and return a list of parsed opportunity dicts."""
    from app.ai.client import chat_complete

    prompt = f"Source: {source_name}\n\nPage content:\n{page_text}"
    if page_links:
        link_lines = "\n".join(
            f"- {text}: {href}" for text, href in page_links[:50]
        )
        prompt += f"\n\nAvailable links on page:\n{link_lines}"
    raw = await chat_complete(
        messages=[
            {"role": "system", "content": _EXTRACTION_SYSTEM},
            {"role": "user", "content": prompt},
        ],
        temperature=0.0,
        max_tokens=4096,
        agent_name="ai_scraper",
        json_mode=True,
    )
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return parsed
        # Expected shape: {"opportunities": [...]}
        for key in ("opportunities", "grants", "results", "items"):
            if isinstance(parsed.get(key), list):
                return parsed[key]
    except Exception as e:
        logger.warning("AIScraper: failed to parse LLM JSON response",
                       error=str(e), raw_preview=raw[:200])
    return []


class AIScraper(BaseScraper):
    """
    General-purpose AI-powered scraper. Works on most grant websites
    without per-site CSS selector configuration. Uses Playwright to
    handle JS-rendered pages, then extracts structured opportunity data
    via the configured LLM.
    """

    def fetch(self) -> list[dict]:
        if not self.source.url:
            return []

        cfg = self.source.scraper_config or {}
        use_playwright: bool = cfg.get("use_playwright", True)
        crawl_depth: int = min(int(cfg.get("crawl_depth", 0)), 1)
        link_filter: str | None = cfg.get("link_filter")

        # Fetch and extract from the primary listing page
        try:
            page_text, page_links = _fetch_page_text(self.source.url, use_playwright)
        except Exception as e:
            logger.error("AIScraper: failed to fetch listing page",
                         url=self.source.url, error=str(e))
            return []

        self._page_links = page_links

        loop = asyncio.new_event_loop()
        try:
            listings = loop.run_until_complete(
                _llm_extract(page_text, self.source.name, page_links)
            )
        finally:
            loop.close()

        results = []
        for item in listings:
            if not item.get("title"):
                continue
            normalized = self._normalize(item)
            if normalized.get("url"):
                results.append(normalized)

        # depth=1: follow individual grant detail links and enrich
        if crawl_depth >= 1 and page_links:
            pattern = re.compile(link_filter, re.I) if link_filter else None
            candidates = [
                href for _, href in page_links
                if (pattern.search(href) if pattern else True)
                and href.rstrip("/") != (self.source.url or "").rstrip("/")
            ][:_MAX_DETAIL_LINKS]

            for link in candidates:
                try:
                    detail_text, detail_links = _fetch_page_text(link, use_playwright)
                    self._page_links = detail_links or page_links
                    detail_loop = asyncio.new_event_loop()
                    try:
                        detail_items = detail_loop.run_until_complete(
                            _llm_extract(detail_text, self.source.name, self._page_links)
                        )
                    finally:
                        detail_loop.close()
                    for item in detail_items:
                        item["url"] = item.get("url") or link
                        normalized = self._normalize(item)
                        if normalized.get("url"):
                            results.append(normalized)
                except Exception as e:
                    logger.warning("AIScraper: detail page failed",
                                   url=link, error=str(e))

        logger.info("AIScraper complete",
                    source=self.source.name, found=len(results))
        return results

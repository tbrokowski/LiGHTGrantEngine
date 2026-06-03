"""
AI-powered general-purpose scraper.

Renders pages with Playwright (handles JS-heavy sites), extracts readable text,
then asks the LLM to parse out grant/funding opportunities as structured JSON.

No per-site CSS selector configuration required — just a URL.

scraper_config keys:
  crawl_depth    (int, 0–2, default 0)      — 0: listing only; 1: follow detail links;
                                               2: discover category links then detail links
  link_filter    (str, optional regex)       — restrict which links to follow
  use_playwright (bool, default True)        — False forces plain httpx (no JS rendering)
  site_sections  (list[str], optional)       — sub-paths to crawl as independent roots
  paginate       (bool, default False)       — follow next-page links (up to max_pages)
  max_pages      (int, default 5)            — max pagination depth when paginate=True
  max_section_links (int, default 10)        — cap on category/section links at depth=2
  max_detail_links_per_section (int, def 5) — cap on detail links per category at depth=2
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

_OPPORTUNITY_TYPE_VALUES = (
    "grant", "fellowship", "scholarship", "residency", "open_call",
    "prize", "bursary", "commission", "other"
)

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
      "program": "...",
      "opportunity_type": "..."
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
- opportunity_type MUST be exactly one of: grant, fellowship, scholarship,
  residency, open_call, prize, bursary, commission, other.
  Use "open_call" for open calls for projects/submissions/entries.
  Use "grant" when the type is ambiguous.
"""

_MAX_PAGE_CHARS = 100_000  # GPT-4o 128k context window handles full grant pages
_MAX_DETAIL_LINKS = 10   # cap detail pages per run to avoid long task times

_SECTION_LINK_SYSTEM = """\
You are a funding portal navigator. Given the text and links from a grant-funder homepage or \
program index, identify links that lead to individual funding program or grant category pages \
(NOT news articles, NOT the homepage itself, NOT external sites).

Return ONLY a JSON object in this shape:
{"section_links": ["https://...", "https://...", ...]}

Rules:
- Include only URLs that are sub-pages listing specific grant programs or funding areas.
- Exclude: news/blog/press, about/contact/staff pages, social media, login, external links.
- Maximum 15 links. If no suitable links exist, return {"section_links": []}.
"""


async def _llm_extract_section_links(
    page_text: str,
    page_links: list[tuple[str, str]],
) -> list[str]:
    """Depth-2 helper: ask the LLM which links on a listing page are sub-category pages."""
    from app.ai.client import chat_complete

    link_lines = "\n".join(f"- {text}: {href}" for text, href in page_links[:80])
    prompt = f"Page text (first 2000 chars):\n{page_text[:2000]}\n\nLinks:\n{link_lines}"
    try:
        raw = await chat_complete(
            messages=[
                {"role": "system", "content": _SECTION_LINK_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            temperature=0.0,
            max_tokens=512,
            agent_name="ai_scraper_depth2",
            json_mode=True,
        )
        parsed = json.loads(raw)
        return [u for u in (parsed.get("section_links") or []) if isinstance(u, str)]
    except Exception:
        return []


def _detect_next_page(soup, current_url: str) -> str | None:
    """Return the URL of the next page if pagination is detected, else None."""
    from urllib.parse import urljoin, urlparse, parse_qs, urlencode, urlunparse
    import re as _re

    # rel="next" link tag (most reliable)
    next_tag = soup.find("link", rel=lambda v: v and "next" in v)
    if next_tag and next_tag.get("href"):
        return urljoin(current_url, next_tag["href"])

    # Anchor with aria-label="Next" or next-like text/rel
    next_texts = {"next", "next page", "›", "»", "next »", "→"}
    for a in soup.find_all("a", href=True):
        label = (a.get("aria-label") or "").lower().strip()
        rel = " ".join(a.get("rel") or []).lower()
        text = a.get_text(strip=True).lower()
        if label in next_texts or rel == "next" or text in next_texts:
            href = a["href"]
            if href and not href.startswith(("#", "javascript:", "mailto:")):
                return urljoin(current_url, href)

    # Collect all page-number anchors — supports ?page=N, ?paged=N, /page/N/
    page_anchors: list[tuple[int, str]] = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        # ?page=N or ?paged=N (WordPress query style)
        m = _re.search(r"[?&](page|paged)=(\d+)", href)
        if m:
            page_anchors.append((int(m.group(2)), urljoin(current_url, href)))
            continue
        # /page/N/ (WordPress pretty-URL style)
        m = _re.search(r"/page/(\d+)/?", href)
        if m:
            page_anchors.append((int(m.group(1)), urljoin(current_url, href)))

    if page_anchors:
        # Determine current page number from current_url
        cur = 1
        m = _re.search(r"[?&](page|paged)=(\d+)", current_url)
        if m:
            cur = int(m.group(2))
        else:
            m = _re.search(r"/page/(\d+)/?", current_url)
            if m:
                cur = int(m.group(1))
        # Return the anchor with the smallest page number > current
        candidates = [(n, u) for n, u in page_anchors if n > cur]
        if candidates:
            candidates.sort(key=lambda x: x[0])
            return candidates[0][1]
        # Fallback: if no current page detected, return the highest-numbered page
        page_anchors.sort(key=lambda x: x[0])
        return page_anchors[-1][1]

    return None


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
        crawl_depth: int = min(int(cfg.get("crawl_depth", 0)), 2)
        link_filter: str | None = cfg.get("link_filter")
        site_sections: list[str] = cfg.get("site_sections") or []
        paginate: bool = bool(cfg.get("paginate", False))
        max_pages: int = int(cfg.get("max_pages", 5))
        max_section_links: int = int(cfg.get("max_section_links", 10))
        max_detail_per_section: int = int(cfg.get("max_detail_links_per_section", 5))

        results: list[dict] = []

        # ── site_sections: delegate to SiteSectionCrawler and return early ──
        if site_sections:
            from app.scrapers.site_section_crawler import crawl_sections
            raw_items = crawl_sections(
                self.source.url,
                site_sections,
                self.source.name,
                use_playwright=use_playwright,
                link_filter=link_filter,
            )
            for item in raw_items:
                normalized = self._normalize(item)
                if normalized.get("url") or normalized.get("title"):
                    results.append(normalized)
            logger.info("AIScraper (site_sections) complete",
                        source=self.source.name, found=len(results))
            return results

        # ── Standard fetch: listing page ──────────────────────────────────
        try:
            page_text, page_links = _fetch_page_text(self.source.url, use_playwright)
        except Exception as e:
            logger.error("AIScraper: failed to fetch listing page",
                         url=self.source.url, error=str(e))
            return []

        self._page_links = page_links
        pattern = re.compile(link_filter, re.I) if link_filter else None

        # ── Pagination: collect additional listing pages ───────────────────
        all_page_texts = [(page_text, page_links)]
        if paginate:
            from bs4 import BeautifulSoup
            import httpx as _httpx
            visited_pages = {self.source.url}
            current_url = self.source.url
            for _ in range(max_pages - 1):
                try:
                    # Fetch the current page's raw HTML to detect next-page link
                    resp = _httpx.get(
                        current_url, timeout=30, follow_redirects=True,
                        headers={"User-Agent": "LiGHT Grant System/1.0"},
                    )
                    soup = BeautifulSoup(resp.text, "lxml")
                    next_url = _detect_next_page(soup, current_url)
                    if not next_url or next_url in visited_pages:
                        break
                    visited_pages.add(next_url)
                    current_url = next_url
                    next_text, next_links = _fetch_page_text(next_url, use_playwright)
                    all_page_texts.append((next_text, next_links))
                except Exception:
                    break

        # ── Extract from all listing pages ────────────────────────────────
        loop = asyncio.new_event_loop()
        try:
            async def _extract_all():
                tasks = [
                    _llm_extract(txt, self.source.name, lnks)
                    for txt, lnks in all_page_texts
                ]
                nested = await asyncio.gather(*tasks, return_exceptions=True)
                items = []
                for batch in nested:
                    if isinstance(batch, list):
                        items.extend(batch)
                return items

            listings = loop.run_until_complete(_extract_all())
        finally:
            loop.close()

        for item in listings:
            if not item.get("title"):
                continue
            normalized = self._normalize(item)
            if normalized.get("url"):
                results.append(normalized)

        # ── depth=1: follow individual grant detail links ─────────────────
        if crawl_depth >= 1:
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

        # ── depth=2: discover category links, then follow detail links ────
        if crawl_depth >= 2:
            d2_loop = asyncio.new_event_loop()
            try:
                async def _depth2():
                    section_urls = await _llm_extract_section_links(page_text, page_links)
                    section_urls = section_urls[:max_section_links]
                    depth2_results = []
                    for section_url in section_urls:
                        try:
                            sec_text, sec_links = await asyncio.to_thread(
                                _fetch_page_text, section_url, use_playwright
                            )
                        except Exception:
                            continue
                        sec_items = await _llm_extract(sec_text, self.source.name, sec_links)
                        for item in sec_items:
                            if item.get("title"):
                                depth2_results.append(item)

                        # Follow detail links within the section
                        detail_candidates = [
                            href for _, href in sec_links
                            if (pattern.search(href) if pattern else True)
                            and href.rstrip("/") != section_url.rstrip("/")
                        ][:max_detail_per_section]

                        for detail_url in detail_candidates:
                            try:
                                det_text, det_links = await asyncio.to_thread(
                                    _fetch_page_text, detail_url, use_playwright
                                )
                                det_items = await _llm_extract(det_text, self.source.name, det_links)
                                for item in det_items:
                                    item["url"] = item.get("url") or detail_url
                                    if item.get("title"):
                                        depth2_results.append(item)
                            except Exception:
                                pass
                    return depth2_results

                d2_items = d2_loop.run_until_complete(_depth2())
            finally:
                d2_loop.close()

            for item in d2_items:
                normalized = self._normalize(item)
                if normalized.get("url"):
                    results.append(normalized)

        logger.info("AIScraper complete",
                    source=self.source.name, depth=crawl_depth, found=len(results))
        return results

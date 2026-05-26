"""
Fetches and parses full grant detail pages to extract rich description content.

Used by the enrichment pipeline to populate Opportunity.description,
parsed_text, and short_summary after initial discovery.
"""
import re
from urllib.parse import urljoin, urlparse

import httpx
import markdownify as md
from bs4 import BeautifulSoup

# Tags to strip before extracting text — noisy structural/presentational elements
_STRIP_TAGS = ["script", "style", "nav", "header", "footer", "aside", "noscript", "iframe", "form"]

# CSS selectors tried in order to find the main content block
_CONTENT_SELECTORS = [
    "article",
    "main",
    "[class*='grant-detail']",
    "[class*='opportunity-detail']",
    "[class*='call-detail']",
    "[class*='funding-detail']",
    "[class*='programme-detail']",
    "[class*='content-body']",
    "[class*='page-content']",
    "[class*='entry-content']",
    "[class*='post-content']",
    "[class*='description']",
    "[class*='overview']",
    "[class*='summary']",
    "[id*='content']",
    "[id*='main-content']",
    "[id*='description']",
    ".content",
    "#content",
    "main",
]

_USER_AGENT = "LiGHT Grant System/1.0"
_MIN_DESCRIPTION_CHARS = 200
_MAX_PDF_LINKS = 10
_MIN_PDF_BYTES = 10_240  # skip tiny assets (logos, icons)


def _html_to_markdown(element) -> str:
    """Convert a BS4 element/soup to clean ATX markdown, keeping links, dropping images."""
    raw = md.markdownify(
        str(element),
        heading_style="ATX",
        strip=["img"],
    )
    return _clean_markdown(raw)


def _clean_markdown(text: str) -> str:
    """
    Post-process markdownify output:
    - Collapse excessive whitespace/blank lines
    - Shift H1 headings down one level (scraped content should start at H2)
    - Strip nav/breadcrumb/share cruft that leaks from site chrome
    """
    # Collapse whitespace
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)

    # Shift H1 → H2, H2 → H3, etc. if the text starts with a lone H1
    lines = text.split("\n")
    has_h1 = any(line.startswith("# ") and not line.startswith("## ") for line in lines)
    if has_h1:
        shifted = []
        for line in lines:
            if re.match(r"^#{1,5} ", line):
                line = "#" + line
            shifted.append(line)
        text = "\n".join(shifted)

    # Strip common cruft patterns (breadcrumbs, social share lines, lone nav words)
    _CRUFT = re.compile(
        r"^\s*("
        r"Home\s*[>›»].*|"          # breadcrumbs
        r"Share\s*(this)?\s*(page|post|article)?[\s:]*$|"
        r"(Tweet|Print|Email|Facebook|LinkedIn|WhatsApp)\s*$|"
        r"Skip to (main )?content\s*$|"
        r"Back to top\s*$|"
        r"Cookie\s*(policy|settings|notice|consent)\s*$"
        r")\s*$",
        re.IGNORECASE | re.MULTILINE,
    )
    text = _CRUFT.sub("", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _clean_text(text: str) -> str:
    """Collapse excess whitespace while preserving paragraph breaks."""
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _strip_markdown(text: str) -> str:
    """Remove markdown syntax to produce plain text suitable for short previews."""
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"\*{1,3}([^*\n]+)\*{1,3}", r"\1", text)
    text = re.sub(r"_{1,3}([^_\n]+)_{1,3}", r"\1", text)
    text = re.sub(r"^\s*[-*+]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*\d+\.\s+", "", text, flags=re.MULTILINE)
    return _clean_text(text)


def _extract_short_summary(text: str, max_chars: int = 600) -> str:
    """Return the first 2–3 sentences up to max_chars."""
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    summary = ""
    for sentence in sentences:
        candidate = f"{summary} {sentence}".strip()
        if len(candidate) > max_chars:
            break
        summary = candidate
    return summary or text[:max_chars]


def _is_pdf_url(url: str) -> bool:
    path = urlparse(url).path.lower()
    return path.endswith(".pdf") or ".pdf?" in path.lower()


def _fetch_html_httpx(url: str, timeout: int) -> tuple[str | None, str | None]:
    """Return (html, error)."""
    try:
        resp = httpx.get(
            url,
            timeout=timeout,
            follow_redirects=True,
            headers={"User-Agent": _USER_AGENT},
        )
        resp.raise_for_status()
        content_type = (resp.headers.get("content-type") or "").lower()
        if "application/pdf" in content_type or _is_pdf_url(str(resp.url)):
            return None, "direct_pdf"
        return resp.text, None
    except httpx.HTTPStatusError as e:
        return None, f"HTTP {e.response.status_code} for {url}"
    except Exception as e:
        return None, str(e)


def _fetch_html_playwright(url: str, timeout: int) -> str | None:
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto(url, timeout=timeout * 1000, wait_until="domcontentloaded")
            page.wait_for_timeout(2000)
            html = page.content()
            browser.close()
            return html
    except Exception:
        return None


def _discover_pdf_links(soup: BeautifulSoup, base_url: str, timeout: int) -> tuple[list[str], dict[str, str]]:
    """Collect PDF links from the page, deduped and capped. Returns (urls, url->anchor_text)."""
    seen: set[str] = set()
    pdf_urls: list[str] = []
    anchors: dict[str, str] = {}

    for anchor in soup.find_all("a", href=True):
        href = anchor["href"].strip()
        if not href or href.startswith(("#", "mailto:", "javascript:", "tel:")):
            continue
        abs_url = urljoin(base_url, href)
        if not _is_pdf_url(abs_url):
            continue
        if abs_url in seen:
            continue
        seen.add(abs_url)
        pdf_urls.append(abs_url)
        text = anchor.get_text(separator=" ", strip=True)
        if text:
            anchors[abs_url] = text

    # Filter out tiny PDFs (likely logos/icons) via HEAD request
    filtered: list[str] = []
    for pdf_url in pdf_urls[: _MAX_PDF_LINKS * 2]:
        try:
            head = httpx.head(
                pdf_url,
                timeout=timeout,
                follow_redirects=True,
                headers={"User-Agent": _USER_AGENT},
            )
            size = int(head.headers.get("content-length", 0) or 0)
            if size and size < _MIN_PDF_BYTES:
                continue
        except Exception:
            pass
        filtered.append(pdf_url)
        if len(filtered) >= _MAX_PDF_LINKS:
            break

    return filtered, {u: anchors.get(u, "") for u in filtered}


def _parse_html(html: str, detail_selectors: list[str] | None) -> dict:
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(_STRIP_TAGS):
        tag.decompose()

    full_text = _clean_text(_html_to_markdown(soup))
    description_text = None
    selectors_to_try = list(detail_selectors or []) + _CONTENT_SELECTORS

    for selector in selectors_to_try:
        try:
            if el := soup.select_one(selector):
                candidate = _clean_text(_html_to_markdown(el))
                if len(candidate) > _MIN_DESCRIPTION_CHARS:
                    description_text = candidate
                    break
        except Exception:
            continue

    if not description_text and (paras := [
        _clean_text(_html_to_markdown(p))
        for p in soup.find_all("p")
        if len(p.get_text(strip=True)) > 50
    ]):
        description_text = _clean_text("\n\n".join(paras))

    description_text = description_text or full_text
    return {
        "soup": soup,
        "description": description_text[:10000] if description_text else None,
        "parsed_text": full_text[:20000] if full_text else None,
        "short_summary": _extract_short_summary(_strip_markdown(description_text)) if description_text else None,
    }


def _empty_result(error: str | None = None) -> dict:
    return {
        "description": None,
        "parsed_text": None,
        "short_summary": None,
        "pdf_urls": [],
        "pdf_anchors": {},
        "error": error,
    }


class DetailPageParser:
    """
    Fetches a single grant opportunity URL and extracts the main description text.

    Source-specific CSS selectors can be passed via `detail_selectors` (from
    Source.scraper_config["detail_selectors"]) to override the generic heuristics.
    """

    def __init__(self, timeout: int = 30):
        self.timeout = timeout

    def fetch_and_parse(
        self,
        url: str,
        detail_selectors: list[str] | None = None,
        *,
        use_playwright: bool = False,
    ) -> dict:
        """
        Fetch `url` and extract the grant description as markdown.

        Returns a dict with:
            description   – main extracted prose as markdown (up to 10,000 chars)
            parsed_text   – full cleaned page markdown (up to 20,000 chars)
            short_summary – first 2–3 sentences as plain text (markdown stripped)
            pdf_urls      – PDF links discovered on the page
            error         – error message string if fetch/parse failed, else None
        """
        if _is_pdf_url(url):
            return {
                "description": None,
                "parsed_text": None,
                "short_summary": None,
                "pdf_urls": [url],
                "pdf_anchors": {},
                "error": None,
            }

        html, fetch_error = _fetch_html_httpx(url, self.timeout)

        if fetch_error == "direct_pdf":
            return {
                "description": None,
                "parsed_text": None,
                "short_summary": None,
                "pdf_urls": [url],
                "pdf_anchors": {},
                "error": None,
            }

        if fetch_error and not html:
            if use_playwright:
                html = _fetch_html_playwright(url, self.timeout)
            if not html:
                return _empty_result(fetch_error)

        parsed = _parse_html(html, detail_selectors)
        description_len = len(parsed.get("description") or "")

        if description_len < _MIN_DESCRIPTION_CHARS or use_playwright:
            pw_html = _fetch_html_playwright(url, self.timeout)
            if pw_html:
                pw_parsed = _parse_html(pw_html, detail_selectors)
                if len(pw_parsed.get("description") or "") > description_len:
                    parsed = pw_parsed
                    html = pw_html
                    soup = parsed.pop("soup")
                else:
                    soup = parsed.pop("soup")
            else:
                soup = parsed.pop("soup")
        else:
            soup = parsed.pop("soup")
        pdf_urls, pdf_anchors = _discover_pdf_links(soup, url, self.timeout)

        return {
            "description": parsed["description"],
            "parsed_text": parsed["parsed_text"],
            "short_summary": parsed["short_summary"],
            "pdf_urls": pdf_urls,
            "pdf_anchors": pdf_anchors,
            "error": None,
        }

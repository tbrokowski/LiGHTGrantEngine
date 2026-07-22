"""
Shared robust page-fetch layer for all HTML scrapers.

Why this exists: scrapers previously fetched with `User-Agent: "LiGHT Grant
System/1.0"` (an instant bot-block on many funder sites → 403/empty pages) and
only used Playwright when a source was manually configured with
`use_playwright: true`, so JS-rendered listings silently produced near-empty
text and "0 opportunities found." This module gives every scraper the same
behavior detail_fetcher.py already had, plus automatic escalation:

  1. httpx GET with real browser headers (retry once on transient failure,
     SSL-verify fallback for sites with broken certs).
  2. If the result looks blocked or empty (HTTP >= 400, too few anchors, or
     too little text) and Playwright is installed, automatically retry with a
     headless browser — even when the source isn't configured for it.
  3. `use_playwright: true` still forces Playwright on the first attempt.

The FetchResult reports which method finally produced the page so callers can
persist it (e.g. `_last_fetch_method` in scraper_config) for observability.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)

_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
# Single source of truth for browser-like headers (previously duplicated in
# detail_fetcher.py while ai_scraper/html_scraper sent a bot UA).
BROWSER_HEADERS = {
    "User-Agent": _USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Escalation thresholds — a real grant-listing page virtually always has more
# than this many links and this much text; below either, assume JS-rendered
# or blocked and try a real browser.
MIN_ANCHORS = 15
MIN_TEXT_CHARS = 2000


@dataclass
class FetchResult:
    url: str
    html: str = ""
    status_code: int | None = None
    final_url: str = ""
    method_used: str = "none"       # "httpx" | "playwright" | "none"
    escalated: bool = False          # True when Playwright ran because httpx looked bad
    error: str | None = None
    anchor_count: int = 0
    text_chars: int = 0
    redirected: bool = False

    @property
    def ok(self) -> bool:
        return bool(self.html) and (self.status_code is None or self.status_code < 400)


def count_page_signals(html: str) -> tuple[int, int]:
    """Cheap anchor-count + visible-text-length signals without full parsing cost."""
    if not html:
        return 0, 0
    anchor_count = html.lower().count("<a ")
    # Rough visible-text estimate: strip tags crudely; good enough for a threshold.
    import re
    text = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", html, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return anchor_count, len(text)


def should_escalate(status_code: int | None, anchor_count: int, text_chars: int) -> bool:
    """Decide whether an httpx result warrants a Playwright retry."""
    if status_code is not None and status_code >= 400:
        return True
    if anchor_count < MIN_ANCHORS:
        return True
    if text_chars < MIN_TEXT_CHARS:
        return True
    return False


def _fetch_httpx(url: str, timeout: int) -> FetchResult:
    import httpx

    result = FetchResult(url=url)

    def _get(verify: bool) -> "httpx.Response":
        return httpx.get(
            url,
            timeout=timeout,
            follow_redirects=True,
            headers=BROWSER_HEADERS,
            verify=verify,
        )

    try:
        try:
            resp = _get(verify=True)
        except Exception as exc:
            msg = str(exc)
            if "SSL" in msg or "certificate" in msg.lower():
                resp = _get(verify=False)
            else:
                raise
        result.status_code = resp.status_code
        result.final_url = str(resp.url)
        result.redirected = result.final_url.rstrip("/") != url.rstrip("/")
        result.html = resp.text if resp.status_code < 400 else (resp.text or "")
        result.method_used = "httpx"
    except Exception as exc:
        result.error = f"{type(exc).__name__}: {exc}"

    result.anchor_count, result.text_chars = count_page_signals(result.html)
    return result


def _fetch_playwright(url: str, timeout: int) -> FetchResult:
    result = FetchResult(url=url)
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(user_agent=_USER_AGENT)
            page.goto(url, timeout=timeout * 1000, wait_until="domcontentloaded")
            page.wait_for_timeout(2000)  # allow JS to settle
            result.html = page.content()
            result.final_url = page.url
            result.redirected = result.final_url.rstrip("/") != url.rstrip("/")
            browser.close()
        result.method_used = "playwright"
        result.status_code = 200 if result.html else None
    except Exception as exc:
        result.error = f"{type(exc).__name__}: {exc}"

    result.anchor_count, result.text_chars = count_page_signals(result.html)
    return result


def fetch_page(url: str, *, force_playwright: bool = False, timeout: int = 30) -> FetchResult:
    """
    Fetch a page robustly. httpx-first with automatic Playwright escalation
    when the result looks blocked/JS-empty; `force_playwright` skips straight
    to the browser (for sources configured with use_playwright: true).
    """
    if force_playwright:
        pw = _fetch_playwright(url, timeout)
        if pw.ok:
            return pw
        # Browser failed (not installed / crashed) — fall back to plain httpx
        # rather than returning nothing.
        httpx_result = _fetch_httpx(url, timeout)
        httpx_result.error = httpx_result.error or pw.error
        return httpx_result

    result = _fetch_httpx(url, timeout)
    if should_escalate(result.status_code, result.anchor_count, result.text_chars):
        pw = _fetch_playwright(url, timeout)
        if (pw.ok and (pw.anchor_count > result.anchor_count or not result.ok)) or (not result.ok and pw.html):
            pw.escalated = True
            logger.info(
                "fetch_page escalated to Playwright: %s (httpx status=%s anchors=%d chars=%d)",
                url, result.status_code, result.anchor_count, result.text_chars,
            )
            return pw
    return result


# ── Sitemap fallback ───────────────────────────────────────────────────────────

# URL-path patterns that suggest a page is (or lists) a funding opportunity.
SITEMAP_URL_PATTERN = (
    r"(call|grant|opportunit|fellowship|award|funding|scholarship|"
    r"conference|workshop|prize|bursar|residenc)"
)


def sitemap_candidate_urls(base_url: str, *, limit: int = 20, timeout: int = 20) -> list[str]:
    """
    Fetch the site's sitemap.xml and return opportunity-looking URLs.
    Used as a last resort when a listing page yields zero detail-link
    candidates. Returns [] on any failure — always safe to call.
    """
    import re
    from urllib.parse import urljoin, urlparse

    import httpx

    parsed = urlparse(base_url)
    root = f"{parsed.scheme}://{parsed.netloc}"
    urls: list[str] = []
    seen: set[str] = set()
    pattern = re.compile(SITEMAP_URL_PATTERN, re.I)

    def _collect_from(sitemap_url: str, depth: int = 0) -> None:
        if depth > 1 or len(urls) >= limit:
            return
        try:
            resp = httpx.get(sitemap_url, timeout=timeout, follow_redirects=True, headers=BROWSER_HEADERS)
            if resp.status_code >= 400:
                return
            locs = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", resp.text)
        except Exception:
            return
        for loc in locs:
            if len(urls) >= limit:
                return
            if loc.endswith(".xml"):
                # Sitemap index — recurse one level into child sitemaps whose
                # name looks relevant (or all, if none match).
                if pattern.search(loc) or "sitemap" in loc.lower():
                    _collect_from(loc, depth + 1)
                continue
            if loc in seen:
                continue
            seen.add(loc)
            path = urlparse(loc).path
            if pattern.search(path):
                urls.append(loc)

    _collect_from(urljoin(root, "/sitemap.xml"))
    return urls[:limit]

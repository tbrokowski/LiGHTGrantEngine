"""
Web proxy endpoint — fetches external URLs server-side (bypasses browser CORS),
strips executable content, and returns sanitized HTML for the in-editor browser pane.
"""
import contextlib
from urllib.parse import urljoin, urlparse, parse_qs, unquote
import httpx
from bs4 import BeautifulSoup, Tag
from fastapi import APIRouter, Depends, HTTPException, Query
from app.routers.auth import get_current_user
from app.models.user import User

router = APIRouter()

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}

# Tags we want to remove entirely (content + tag)
_STRIP_TAGS = {
    "script", "style", "iframe", "noscript", "object", "embed",
    "form", "input", "button", "select", "textarea",
}

# Structural chrome elements that add noise
_CHROME_TAGS = {
    "nav", "footer", "header", "aside", "advertisement",
    "banner", "cookie-banner",
}


def _unwrap_ddg_href(href: str) -> str:
    """
    DuckDuckGo Lite wraps all outbound links in a tracking redirect:
      https://duckduckgo.com/l/?uddg=<URL-encoded-target>&rut=...
    Extract and return the actual target URL so our proxy fetches it directly.
    """
    parsed = urlparse(href)
    if parsed.netloc in ("duckduckgo.com", "www.duckduckgo.com") and parsed.path == "/l/":
        qs = parse_qs(parsed.query)
        if targets := qs.get("uddg", []):
            return unquote(targets[0])
    return href


def _extract_content(soup: BeautifulSoup) -> Tag:
    """Return the best content container, falling back to <body>."""
    candidates = [
        soup.find("main"),
        soup.find("article"),
        soup.find(id="content"),
        soup.find(id="main"),
        soup.find(id="main-content"),
        soup.find(attrs={"class": "content"}),
        soup.find(attrs={"role": "main"}),
        soup.body,
    ]
    for c in candidates:
        if c and isinstance(c, Tag):
            return c
    return soup  # type: ignore[return-value]


@router.get("/web")
async def fetch_web_page(
    url: str = Query(..., description="The URL to fetch and sanitize"),
    current_user: User = Depends(get_current_user),
):
    """
    Fetch an external URL and return sanitised HTML + page title.
    Scripts, styles, and iframes are stripped before returning.
    DuckDuckGo tracking redirect links are unwrapped to their real targets.
    """
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, "URL must start with http:// or https://")

    try:
        async with httpx.AsyncClient(
            timeout=15.0,
            follow_redirects=True,
            headers=_HEADERS,
        ) as client:
            resp = await client.get(url)
            resp.raise_for_status()
    except httpx.TimeoutException:
        raise HTTPException(504, "Request timed out")
    except httpx.HTTPStatusError as exc:
        raise HTTPException(502, f"Remote server returned {exc.response.status_code}")
    except httpx.RequestError as exc:
        raise HTTPException(502, f"Could not reach {url}: {exc}")

    content_type = resp.headers.get("content-type", "")
    html_types = ("text/html", "application/xhtml", "text/plain")
    # Soft check: accept anything that looks like HTML; don't 415 on missing charset etc.
    looks_like_html = any(ct in content_type for ct in html_types)
    if not looks_like_html and resp.status_code != 200:
        raise HTTPException(415, "URL does not return an HTML page")

    soup = BeautifulSoup(resp.text, "html.parser")

    # Strip noisy tags
    for tag_name in _STRIP_TAGS | _CHROME_TAGS:
        for el in soup.find_all(tag_name):
            el.decompose()

    # Page title
    title_tag = soup.find("title")
    title = title_tag.get_text(strip=True) if title_tag else str(resp.url)

    content = _extract_content(soup)

    # Make relative links absolute and unwrap DuckDuckGo tracking redirects
    base_url = str(resp.url)
    for a in content.find_all("a", href=True):
        href = a["href"]
        if href.startswith(("#", "javascript:", "mailto:")):
            continue
        with contextlib.suppress(Exception):
            absolute = urljoin(base_url, href)
            # Unwrap DDG /l/?uddg= tracking links
            a["href"] = _unwrap_ddg_href(absolute)
        a["target"] = "_self"

    # Convert relative image src to absolute
    for img in content.find_all("img", src=True):
        src = img["src"]
        if src.startswith("data:"):
            continue
        with contextlib.suppress(Exception):
            img["src"] = urljoin(base_url, src)

    return {
        "title": title,
        "html": str(content),
        "url": str(resp.url),
    }

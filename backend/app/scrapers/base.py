"""Base scraper interface."""
import difflib
import re
from urllib.parse import urljoin, urlparse


def resolve_absolute_url(url: str, base_url: str) -> str:
    """Resolve relative URLs against the source page."""
    if not url:
        return ""
    url = url.strip()
    if url.startswith(("http://", "https://")):
        return url
    if not base_url:
        return url
    return urljoin(base_url, url)


def _normalize_url(url: str) -> str:
    parsed = urlparse(url)
    path = parsed.path.rstrip("/") or "/"
    netloc = parsed.netloc.lower().removeprefix("www.")
    return f"{parsed.scheme}://{netloc}{path}".rstrip("/").lower()


def is_unspecific_call_url(url: str, source_url: str) -> bool:
    """
    True when the URL is a site homepage or listing page — not a specific call.
    """
    if not url:
        return True

    resolved = resolve_absolute_url(url, source_url)
    parsed = urlparse(resolved)
    if not parsed.netloc:
        return True

    path = parsed.path.rstrip("/")
    if path in ("", "/"):
        return True

    if source_url:
        source_resolved = resolve_absolute_url(source_url, source_url)
        if _normalize_url(resolved) == _normalize_url(source_resolved):
            return True

    # Query strings / fragments usually identify a specific record on a listing site.
    if parsed.query or parsed.fragment:
        return False

    # Common grant listing landing paths without a specific call slug
    listing_patterns = (
        r"/grants/?$",
        r"/funding/?$",
        r"/funding-opportunities/?$",
        r"/opportunities/?$",
        r"/calls/?$",
        r"/apply/?$",
        r"/programs/?$",
    )
    if any(re.search(pattern, path, re.I) for pattern in listing_patterns):
        return True

    return False


def best_matching_link(
    title: str,
    links: list[tuple[str, str]],
    source_url: str,
) -> str | None:
    """Pick the page link whose anchor text best matches the opportunity title."""
    if not title or not links:
        return None

    title_lower = re.sub(r"\s+", " ", title.lower()).strip()
    best_score = 0.0
    best_href: str | None = None

    for text, href in links:
        text_clean = re.sub(r"\s+", " ", text.lower()).strip()
        if len(text_clean) < 8:
            continue

        abs_href = resolve_absolute_url(href, source_url)
        if is_unspecific_call_url(abs_href, source_url):
            continue

        if title_lower in text_clean or text_clean in title_lower:
            score = 0.95
        else:
            score = difflib.SequenceMatcher(None, title_lower, text_clean).ratio()

        if score > best_score and score >= 0.55:
            best_score = score
            best_href = abs_href

    return best_href


class BaseScraper:
    def __init__(self, source):
        self.source = source
        self._page_links: list[tuple[str, str]] = []

    def fetch(self) -> list[dict]:
        """Fetch raw listings from the source. Override in subclasses."""
        return []

    def _finalize_opportunity_url(self, raw_url: str, title: str) -> str:
        """Resolve and validate a call URL, falling back to title-matched page links."""
        base_url = self.source.url or ""
        resolved = resolve_absolute_url(raw_url, base_url)

        if resolved and not is_unspecific_call_url(resolved, base_url):
            return resolved

        matched = best_matching_link(title, self._page_links, base_url)
        if matched:
            return matched

        if resolved and not is_unspecific_call_url(resolved, base_url):
            return resolved

        return ""

    def _normalize(self, raw: dict) -> dict:
        title = raw.get("title", "")
        return {
            "title": title,
            "description": raw.get("description", ""),
            "url": self._finalize_opportunity_url(
                raw.get("url") or raw.get("link", ""),
                title,
            ),
            "funder": raw.get("funder", self.source.name),
            "deadline": raw.get("deadline"),
            "program_name": raw.get("program") or raw.get("program_name"),
            "raw_text": str(raw),
        }

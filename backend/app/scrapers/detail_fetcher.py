"""
Fetches and parses full grant detail pages to extract rich description content.

Used by the enrichment pipeline to populate Opportunity.description,
parsed_text, and short_summary after initial discovery.
"""
import re
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


def _html_to_markdown(element) -> str:
    """Convert a BS4 element/soup to clean ATX markdown, dropping links and images."""
    return md.markdownify(
        str(element),
        heading_style="ATX",
        strip=["a", "img"],
    )


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
    ) -> dict:
        """
        Fetch `url` and extract the grant description as markdown.

        Returns a dict with:
            description   – main extracted prose as markdown (up to 10,000 chars)
            parsed_text   – full cleaned page markdown (up to 20,000 chars)
            short_summary – first 2–3 sentences as plain text (markdown stripped)
            error         – error message string if fetch/parse failed, else None
        """
        try:
            resp = httpx.get(
                url,
                timeout=self.timeout,
                follow_redirects=True,
                headers={"User-Agent": "LiGHT Grant System/1.0"},
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            return {"description": None, "parsed_text": None, "short_summary": None,
                    "error": f"HTTP {e.response.status_code} for {url}"}
        except Exception as e:
            return {"description": None, "parsed_text": None, "short_summary": None,
                    "error": str(e)}

        soup = BeautifulSoup(resp.text, "lxml")

        # Remove noisy structural tags
        for tag in soup(_STRIP_TAGS):
            tag.decompose()

        # Full page as markdown fallback
        full_text = _clean_text(_html_to_markdown(soup))

        # Try selectors in order: source-specific first, then generic heuristics
        description_text = None
        selectors_to_try = list(detail_selectors or []) + _CONTENT_SELECTORS

        for selector in selectors_to_try:
            try:
                if el := soup.select_one(selector):
                    candidate = _clean_text(_html_to_markdown(el))
                    # Must be substantive — skip tiny matches
                    if len(candidate) > 200:
                        description_text = candidate
                        break
            except Exception:
                continue

        # Last resort: concatenate all <p> elements with meaningful content
        if not description_text and (paras := [
            _clean_text(_html_to_markdown(p))
            for p in soup.find_all("p")
            if len(p.get_text(strip=True)) > 50
        ]):
            description_text = _clean_text("\n\n".join(paras))

        description_text = description_text or full_text

        return {
            "description": description_text[:10000] if description_text else None,
            "parsed_text": full_text[:20000] if full_text else None,
            "short_summary": _extract_short_summary(_strip_markdown(description_text)) if description_text else None,
            "error": None,
        }

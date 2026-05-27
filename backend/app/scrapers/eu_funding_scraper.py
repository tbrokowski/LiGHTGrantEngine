"""
EU Funding & Tenders Portal API scraper.

Fetches open calls from the EU Funding & Tenders Portal (Horizon Europe,
ERC, EIC, Digital Europe, etc.).
Requires EU Login API key (set in source.scraper_config["api_key"]).
API docs: https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/support/apis

Also falls back to the public search endpoint for unauthenticated access.
"""
import httpx
import structlog
from app.scrapers.base import BaseScraper

logger = structlog.get_logger()

_PUBLIC_SEARCH_URL = "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-search"
_API_BASE = "https://api.tech.ec.europa.eu/search-api/prod/rest/search"

# Relevant programme identifiers
_RELEVANT_PROGRAMMES = [
    "HORIZON",  # Horizon Europe
    "ERC",      # European Research Council
    "EIC",      # European Innovation Council
    "DIGITAL",  # Digital Europe
    "LIFE",     # LIFE programme
]

_DEFAULT_KEYWORDS = "artificial intelligence health digital LMIC global"


class EUFundingScraper(BaseScraper):
    """Scraper for EU Funding & Tenders Portal."""

    def fetch(self) -> list[dict]:
        cfg = self.source.scraper_config or {}
        api_key = cfg.get("api_key") or cfg.get("eu_api_key")
        keywords = cfg.get("keywords", _DEFAULT_KEYWORDS)

        results = []

        # Try authenticated API first
        if api_key:
            results = self._fetch_authenticated(api_key, keywords)

        # Fall back to scraping the public portal search page
        if not results:
            results = self._fetch_public(keywords)

        logger.info("EU Funding scraper complete", found=len(results))
        return results

    def _fetch_authenticated(self, api_key: str, keywords: str) -> list[dict]:
        """Use the authenticated EC search API."""
        results = []
        try:
            headers = {
                "Accept": "application/json",
                "X-API-Key": api_key,
                "User-Agent": "LiGHT Grant System/1.0",
            }
            params = {
                "query": keywords,
                "pageSize": 100,
                "pageNumber": 1,
                "order": "DESC",
                "sortBy": "startDate",
                "status": "31094502",  # Open
                "programmePeriod": "2021-2027",
            }
            resp = httpx.get(_API_BASE, params=params, headers=headers, timeout=30)
            resp.raise_for_status()
            data = resp.json()

            for item in data.get("results", {}).get("result", []):
                metadata = item.get("metadata", {})
                results.append(self._normalize({
                    "title": metadata.get("title", [""])[0],
                    "description": metadata.get("callTitle", [""])[0],
                    "url": f"https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/{metadata.get('identifier', [''])[0]}",
                    "funder": f"EU – {metadata.get('programmePart', [self.source.name])[0]}",
                    "deadline": metadata.get("deadlineDate", [None])[0],
                    "program_name": metadata.get("callIdentifier", [""])[0],
                }))
        except Exception as e:
            logger.warning("EU authenticated API failed", error=str(e))
        return results

    def _fetch_public(self, keywords: str) -> list[dict]:
        """Scrape the public EU F&T Portal search."""
        from app.scrapers.ai_scraper import AIScraper

        # Delegate to AIScraper for the public portal
        try:
            import asyncio
            from app.scrapers.ai_scraper import _fetch_page_text, _llm_extract

            search_url = (
                f"https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/"
                f"opportunities/topic-search#programme/null/keywords/{keywords.replace(' ', '+')}"
            )
            page_text, _ = _fetch_page_text(search_url, use_playwright=True)
            loop = asyncio.new_event_loop()
            try:
                items = loop.run_until_complete(_llm_extract(page_text, self.source.name))
            finally:
                loop.close()
            return [self._normalize(item) for item in items]
        except Exception as e:
            logger.warning("EU public scrape failed", error=str(e))
        return []

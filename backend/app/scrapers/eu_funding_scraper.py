"""
EU Funding & Tenders Portal API scraper.

Fetches open and forthcoming calls from the EU Funding & Tenders Portal
(Horizon Europe, ERC, EIC, Digital Europe, LIFE, etc.).

Uses the public EC Search API — no registration required.
Public API key: SEDIA_NONH2020_PROD (passed as ?apiKey= query param)
API docs: https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/support/apis

Two modes:
  - Full scrape:        fetches all open/forthcoming grants (paginated)
  - Incremental scrape: fetches only grants with startDate >= last_successful_run - 1 day
"""
import json
from datetime import datetime, timedelta

import httpx
import structlog

from app.scrapers.base import BaseScraper

logger = structlog.get_logger()

_API_BASE = "https://api.tech.ec.europa.eu/search-api/prod/rest/search"
_PUBLIC_FALLBACK_URL = (
    "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/"
    "opportunities/calls-for-proposals"
    "?isExactMatch=true&status=31094501,31094502&order=DESC"
    "&pageNumber=1&pageSize=50&sortBy=startDate"
)

# EC Search API public key — no registration required
_PUBLIC_API_KEY = "SEDIA_NONH2020_PROD"

# Status codes:  31094501 = Forthcoming,  31094502 = Open
_OPEN_STATUSES = ["31094501", "31094502"]

_PAGE_SIZE = 100


class EUFundingScraper(BaseScraper):
    """Scraper for EU Funding & Tenders Portal."""

    def fetch(self) -> list[dict]:
        cfg = self.source.scraper_config or {}
        # Allow an optional override API key from scraper_config
        api_key = cfg.get("api_key") or cfg.get("eu_api_key") or _PUBLIC_API_KEY

        # Determine incremental window: if this source has run before, only
        # fetch grants that started/were posted since that run (minus 1 day buffer).
        since_date: datetime | None = None
        last_run = getattr(self.source, "last_successful_run", None)
        if last_run:
            since_date = last_run - timedelta(days=1)
            logger.info(
                "EU scraper: incremental mode",
                since=since_date.isoformat(),
            )
        else:
            logger.info("EU scraper: full scrape mode (no prior run)")

        results = self._fetch_all_pages(api_key, since_date)

        # If the API returned nothing, fall back to Playwright scrape
        if not results:
            logger.info("EU API returned no results, trying public fallback")
            results = self._fetch_public()

        logger.info("EU Funding scraper complete", found=len(results))
        return results

    # ------------------------------------------------------------------
    # Core fetch: POST-based paginated API call
    # ------------------------------------------------------------------

    def _fetch_all_pages(
        self, api_key: str, since_date: datetime | None
    ) -> list[dict]:
        """Paginate through the EC Search API until all results are retrieved."""
        results: list[dict] = []
        page = 1

        # Build the Elasticsearch-style boolean query
        must_clauses: list[dict] = [
            {"terms": {"status": _OPEN_STATUSES}},
        ]
        if since_date:
            must_clauses.append(
                {"range": {"startDate": {"gte": since_date.strftime("%Y-%m-%d")}}}
            )

        query = {"bool": {"must": must_clauses}}
        sort = [{"field": "startDate", "order": "DESC"}]
        languages = ["en"]

        while True:
            params = {
                "apiKey": api_key,
                "text": "***",  # wildcard — fetch all grants
                "pageSize": str(_PAGE_SIZE),
                "pageNumber": str(page),
            }
            try:
                resp = httpx.post(
                    _API_BASE,
                    params=params,
                    # EC Search API expects multipart form-data with JSON blobs
                    files={
                        "query": ("blob", json.dumps(query), "application/json"),
                        "sort": ("blob", json.dumps(sort), "application/json"),
                        "languages": (
                            "blob",
                            json.dumps(languages),
                            "application/json",
                        ),
                    },
                    timeout=60,
                )
                resp.raise_for_status()
                data = resp.json()
            except Exception as e:
                logger.warning(
                    "EU API page fetch failed", page=page, error=str(e)
                )
                break

            raw = data.get("results", [])
            # Support both list and nested {"result": [...]} shapes
            page_results = raw.get("result", []) if isinstance(raw, dict) else (raw or [])

            if not page_results:
                break

            for item in page_results:
                if normalized := self._parse_item(item):
                    results.append(normalized)

            logger.debug(
                "EU API page fetched",
                page=page,
                count=len(page_results),
                total_so_far=len(results),
            )

            # Stop if this page was not full — no more pages remain
            if len(page_results) < _PAGE_SIZE:
                break

            page += 1

        return results

    def _parse_item(self, item: dict) -> dict | None:
        """Parse a single search result item into a normalized listing."""
        metadata = item.get("metadata", {})

        # The topic identifier — e.g. HORIZON-MSCA-2025-COFUND-01-01
        identifier_list = metadata.get("identifier") or []
        identifier = identifier_list[0] if identifier_list else ""

        if not identifier:
            return None

        title_list = metadata.get("title") or []
        title = title_list[0] if title_list else ""

        call_title_list = metadata.get("callTitle") or []
        call_title = call_title_list[0] if call_title_list else ""

        programme_part_list = metadata.get("programmePart") or []
        programme_part = programme_part_list[0] if programme_part_list else self.source.name

        deadline_list = metadata.get("deadlineDate") or []
        deadline = deadline_list[0] if deadline_list else None

        # Build canonical topic-detail URL using the lower-cased identifier
        topic_url = (
            "https://ec.europa.eu/info/funding-tenders/opportunities/portal/"
            f"screen/opportunities/topic-details/{identifier.lower()}"
        )

        return self._normalize({
            "title": title,
            "description": call_title,  # parent call title as description
            "url": topic_url,
            "funder": f"EU – {programme_part}",
            "deadline": deadline,
            "program_name": identifier,  # HORIZON-XXXX-YYYY-ZZ-NN
        })

    # ------------------------------------------------------------------
    # Public fallback (Playwright + LLM) when API is unavailable
    # ------------------------------------------------------------------

    def _fetch_public(self) -> list[dict]:
        """Scrape the public EU F&T Portal calls-for-proposals page as a fallback."""
        try:
            import asyncio
            from app.scrapers.ai_scraper import _fetch_page_text, _llm_extract

            page_text, _ = _fetch_page_text(
                _PUBLIC_FALLBACK_URL, use_playwright=True
            )
            loop = asyncio.new_event_loop()
            try:
                items = loop.run_until_complete(
                    _llm_extract(page_text, self.source.name)
                )
            finally:
                loop.close()
            return [self._normalize(item) for item in items]
        except Exception as e:
            logger.warning("EU public scrape fallback failed", error=str(e))
        return []

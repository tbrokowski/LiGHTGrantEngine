"""
Grants.gov (Simpler Grants) API scraper.

Uses the Simpler Grants REST API to search for open opportunities relevant
to the LiGHT team themes. No API key required for basic search.
API docs: https://simpler.grants.gov/developer
"""
import httpx
import structlog
from app.scrapers.base import BaseScraper

logger = structlog.get_logger()

_SEARCH_URL = "https://api.simpler.grants.gov/v1/opportunities/search"
_FALLBACK_URL = "https://www.grants.gov/web/grants/search-grants.html"

# Keywords aligned with LiGHT team themes
_DEFAULT_QUERY = (
    "artificial intelligence health digital global LMIC tuberculosis "
    "maternal newborn ultrasound machine learning"
)

_PAGE_SIZE = 100


class GrantsGovScraper(BaseScraper):
    """Scraper for Grants.gov Simpler API."""

    def fetch(self) -> list[dict]:
        cfg = self.source.scraper_config or {}
        query = cfg.get("query", _DEFAULT_QUERY)
        page_size = int(cfg.get("page_size", _PAGE_SIZE))
        max_pages = int(cfg.get("max_pages", 3))

        agencies = cfg.get("agencies") or []
        filters: dict = {
            "opportunity_status": {"one_of": ["posted", "forecasted"]},
        }
        if agencies:
            filters["agency"] = {"one_of": agencies}

        results = []
        try:
            for page in range(1, max_pages + 1):
                payload = {
                    "query": query,
                    "pagination": {
                        "page_offset": page,
                        "page_size": page_size,
                        "sort_order": [
                            {"order_by": "post_date", "sort_direction": "descending"},
                        ],
                    },
                    "filters": filters,
                }
                resp = httpx.post(
                    _SEARCH_URL,
                    json=payload,
                    timeout=30,
                    headers={"Content-Type": "application/json", "User-Agent": "LiGHT Grant System/1.0"},
                )
                resp.raise_for_status()
                data = resp.json()
                items = data.get("data", [])
                if not items:
                    break

                for item in items:
                    opp = item.get("opportunity", item)
                    summary = opp.get("summary", {})
                    opp_number = (
                        opp.get("opportunity_number")
                        or str(opp.get("opportunity_id", ""))
                        or None
                    )
                    results.append(self._normalize({
                        "title": opp.get("opportunity_title") or opp.get("title", ""),
                        "description": summary.get("summary_description") or opp.get("description", ""),
                        "url": f"https://www.grants.gov/search-results-detail/{opp.get('opportunity_id', '')}",
                        "funder": opp.get("agency_name") or self.source.name,
                        "deadline": summary.get("close_date") or opp.get("close_date"),
                        "program_name": opp.get("program_title") or opp_number,
                        "opportunity_number": opp_number,
                    }))

                # Stop if we got fewer results than a full page
                if len(items) < page_size:
                    break

        except httpx.HTTPStatusError as e:
            logger.warning("GrantsGov API HTTP error", status=e.response.status_code, error=str(e))
        except Exception as e:
            logger.error("GrantsGov scraper failed", error=str(e))

        logger.info("GrantsGov scraper complete", found=len(results))
        return results

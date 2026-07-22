"""
Grants.gov API scraper.

Primary: the legacy public Search2 API (https://api.grants.gov/v1/api/search2)
— keyless and verified working (the newer "Simpler Grants" API at
api.simpler.grants.gov began requiring an API key and returns 401 without one;
audit 2026-07-22). If GRANTS_GOV_SIMPLER_API_KEY is set in the environment we
try the Simpler API first for its richer payloads, otherwise go straight to
Search2.

Search2 docs: https://www.grants.gov/api/common/search2
"""
import os

import httpx
import structlog
from app.scrapers.base import BaseScraper

logger = structlog.get_logger()

_SEARCH2_URL = "https://api.grants.gov/v1/api/search2"
_SIMPLER_URL = "https://api.simpler.grants.gov/v1/opportunities/search"

# Keywords aligned with LiGHT team themes
_DEFAULT_QUERY = (
    "artificial intelligence health digital global LMIC tuberculosis "
    "maternal newborn ultrasound machine learning"
)

_PAGE_SIZE = 100


class GrantsGovScraper(BaseScraper):
    """Scraper for Grants.gov (Search2, with optional Simpler-API upgrade)."""

    def fetch(self) -> list[dict]:
        cfg = self.source.scraper_config or {}
        query = cfg.get("query", _DEFAULT_QUERY)
        page_size = int(cfg.get("page_size", _PAGE_SIZE))
        max_pages = int(cfg.get("max_pages", 3))

        simpler_key = os.environ.get("GRANTS_GOV_SIMPLER_API_KEY", "")
        if simpler_key:
            results = self._fetch_simpler(cfg, query, page_size, max_pages, simpler_key)
            if results:
                return results
            logger.warning("GrantsGov Simpler API returned nothing — falling back to Search2")

        return self._fetch_search2(query, page_size, max_pages)

    # ── Search2 (keyless, primary) ─────────────────────────────────────────────

    def _fetch_search2(self, query: str, page_size: int, max_pages: int) -> list[dict]:
        results: list[dict] = []
        try:
            for page in range(max_pages):
                payload = {
                    "keyword": query,
                    "rows": page_size,
                    "startRecordNum": page * page_size,
                    "oppStatuses": "forecasted|posted",
                }
                resp = httpx.post(
                    _SEARCH2_URL, json=payload, timeout=30,
                    headers={"Content-Type": "application/json"},
                )
                resp.raise_for_status()
                data = resp.json().get("data") or {}
                hits = data.get("oppHits") or []
                if not hits:
                    break

                for hit in hits:
                    opp_id = hit.get("id", "")
                    results.append(self._normalize({
                        "title": hit.get("title", ""),
                        "description": "",  # enrichment fills this from the detail page
                        "url": f"https://www.grants.gov/search-results-detail/{opp_id}" if opp_id else "",
                        "funder": hit.get("agency") or self.source.name,
                        "deadline": hit.get("closeDate"),
                        "program_name": hit.get("number"),
                        "opportunity_number": hit.get("number"),
                        "opportunity_type": "grant",
                    }))

                if len(hits) < page_size:
                    break

        except httpx.HTTPStatusError as e:
            logger.warning("GrantsGov Search2 HTTP error", status=e.response.status_code, error=str(e))
        except Exception as e:
            logger.error("GrantsGov Search2 scraper failed", error=str(e))

        logger.info("GrantsGov scraper complete", found=len(results))
        return results

    # ── Simpler API (requires GRANTS_GOV_SIMPLER_API_KEY) ─────────────────────

    def _fetch_simpler(
        self, cfg: dict, query: str, page_size: int, max_pages: int, api_key: str,
    ) -> list[dict]:
        agencies = cfg.get("agencies") or []
        filters: dict = {"opportunity_status": {"one_of": ["posted", "forecasted"]}}
        if agencies:
            filters["agency"] = {"one_of": agencies}

        results: list[dict] = []
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
                    _SIMPLER_URL, json=payload, timeout=30,
                    headers={"Content-Type": "application/json", "X-Auth": api_key},
                )
                resp.raise_for_status()
                items = resp.json().get("data", [])
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
                        "opportunity_type": "grant",
                    }))

                if len(items) < page_size:
                    break

        except httpx.HTTPStatusError as e:
            logger.warning("GrantsGov Simpler API HTTP error", status=e.response.status_code, error=str(e))
        except Exception as e:
            logger.error("GrantsGov Simpler scraper failed", error=str(e))
        return results

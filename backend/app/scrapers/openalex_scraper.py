"""
OpenAlex Funders + Grants API scraper.

Uses the OpenAlex free API to find funders and their recent grants
relevant to LiGHT research themes. No API key required for polite pool.
API docs: https://docs.openalex.org/api-entities/funders
"""
import httpx
import structlog
from app.scrapers.base import BaseScraper

logger = structlog.get_logger()

_FUNDERS_URL = "https://api.openalex.org/funders"
_WORKS_URL = "https://api.openalex.org/works"

# Relevant funder keywords
_FUNDER_SEARCHES = [
    "artificial intelligence health",
    "global health",
    "digital health",
    "tuberculosis",
]

_USER_EMAIL = "grants@epfl.ch"  # polite pool identification


class OpenAlexScraper(BaseScraper):
    """Scraper for OpenAlex funder and grant metadata."""

    def fetch(self) -> list[dict]:
        cfg = self.source.scraper_config or {}
        searches = cfg.get("searches", _FUNDER_SEARCHES)
        per_page = int(cfg.get("per_page", 50))
        email = cfg.get("email", _USER_EMAIL)

        results = []
        seen_ids: set[str] = set()

        headers = {
            "User-Agent": f"LiGHT Grant System/1.0 (mailto:{email})",
            "Accept": "application/json",
        }

        try:
            for search in searches[:3]:
                # Search for relevant funders
                # NOTE: grants_count was removed from the /funders select fields
                # (400 Bad Request; audit 2026-07-22) — use grants_count only if
                # present in the response, never in `select`.
                params = {
                    "search": search,
                    "per-page": min(per_page, 25),
                    "select": "id,display_name,description,homepage_url,works_count",
                }
                resp = httpx.get(_FUNDERS_URL, params=params, headers=headers, timeout=30)
                resp.raise_for_status()
                data = resp.json()

                for funder in data.get("results", []):
                    funder_id = funder.get("id", "")
                    if funder_id in seen_ids:
                        continue
                    seen_ids.add(funder_id)

                    # grants_count is no longer selectable — use works_count as
                    # the "substantial funder" proxy instead.
                    if not funder.get("works_count", 0):
                        continue

                    # Each funder entry is an opportunity to investigate
                    results.append(self._normalize({
                        "title": f"Funding from {funder.get('display_name', '')}",
                        "description": funder.get("description", ""),
                        "url": funder.get("homepage_url") or f"https://openalex.org/funders/{funder_id}",
                        "funder": funder.get("display_name", self.source.name),
                        "deadline": None,
                        "program_name": f"{funder.get('works_count', 0)} funded works tracked",
                    }))

        except httpx.HTTPStatusError as e:
            logger.warning("OpenAlex HTTP error", status=e.response.status_code)
        except Exception as e:
            logger.error("OpenAlex scraper failed", error=str(e))

        logger.info("OpenAlex scraper complete", found=len(results))
        return results

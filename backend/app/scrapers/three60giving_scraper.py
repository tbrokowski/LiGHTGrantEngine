"""
360Giving GrantNav API scraper.

Fetches UK philanthropic grants from 360Giving's free public API.
1M+ grants from 200+ UK funders (Wellcome, DCMS, Lloyds Bank Foundation, etc.).
No authentication required.
API docs: https://grantnav.threesixtygiving.org/developers
"""
import httpx
import structlog
from app.scrapers.base import BaseScraper

logger = structlog.get_logger()

_GRANTNAV_URL = "https://grantnav.threesixtygiving.org/api/v1/grants"

_DEFAULT_QUERIES = [
    "artificial intelligence",
    "digital health",
    "global health",
    "machine learning",
    "tuberculosis",
]

_PAGE_SIZE = 100


class ThreeSixtyGivingScraper(BaseScraper):
    """Scraper for 360Giving GrantNav API."""

    def fetch(self) -> list[dict]:
        cfg = self.source.scraper_config or {}
        queries = cfg.get("queries", _DEFAULT_QUERIES)
        page_size = int(cfg.get("page_size", _PAGE_SIZE))

        results = []
        seen_ids: set[str] = set()

        try:
            headers = {
                "Accept": "application/json",
                "User-Agent": "LiGHT Grant System/1.0",
            }

            for query in queries[:3]:
                params = {
                    "q": query,
                    "limit": page_size,
                    "offset": 0,
                    "ordering": "-awardDate",
                }
                resp = httpx.get(
                    _GRANTNAV_URL,
                    params=params,
                    headers=headers,
                    timeout=30,
                )
                resp.raise_for_status()
                data = resp.json()
                grants = data.get("results", [])

                for grant in grants:
                    grant_id = grant.get("id", "")
                    if grant_id in seen_ids:
                        continue
                    seen_ids.add(grant_id)

                    funder = grant.get("fundingOrganization", [{}])[0] if grant.get("fundingOrganization") else {}
                    funder_name = funder.get("name", self.source.name) if isinstance(funder, dict) else self.source.name

                    recipient = grant.get("recipientOrganization", [{}])[0] if grant.get("recipientOrganization") else {}

                    results.append(self._normalize({
                        "title": grant.get("title", ""),
                        "description": grant.get("description", ""),
                        "url": grant.get("canonicalUrl") or f"https://grantnav.threesixtygiving.org/grant/{grant_id}",
                        "funder": funder_name,
                        "deadline": grant.get("plannedEndDate") or grant.get("awardDate"),
                        "program_name": grant.get("grantProgramme", [{}])[0].get("title") if grant.get("grantProgramme") else None,
                    }))

        except httpx.HTTPStatusError as e:
            logger.warning("360Giving HTTP error", status=e.response.status_code)
        except Exception as e:
            logger.error("360Giving scraper failed", error=str(e))

        logger.info("360Giving scraper complete", found=len(results))
        return results

"""
SBIR.gov solicitations scraper.

Fetches open SBIR/STTR solicitations from the SBIR.gov data API.
No authentication required.
API docs: https://www.sbir.gov/data-resources
"""
import httpx
import structlog
from app.scrapers.base import BaseScraper

logger = structlog.get_logger()

_SOLICITATIONS_URL = "https://www.sbir.gov/api/solicitations/open.json"
_TOPICS_URL = "https://www.sbir.gov/api/solicitations.json"


class SBIRScraper(BaseScraper):
    """Scraper for SBIR.gov open solicitations."""

    def fetch(self) -> list[dict]:
        results = []
        try:
            # Fetch open solicitations
            resp = httpx.get(
                _SOLICITATIONS_URL,
                timeout=30,
                headers={"User-Agent": "LiGHT Grant System/1.0"},
                params={"rows": 200, "start": 0},
            )
            resp.raise_for_status()
            data = resp.json()

            # API may return a list or dict with items
            items = data if isinstance(data, list) else data.get("solicitations", data.get("items", []))

            for item in items[:200]:
                title = item.get("solicitation_title") or item.get("program") or ""
                agency = item.get("agency") or item.get("department") or self.source.name
                close_date = item.get("close_date") or item.get("closing_date")
                sol_number = item.get("solicitation_number") or item.get("solicitation_id", "")
                description = item.get("solicitation_agencies") or item.get("abstract", "")

                url = item.get("solicitation_url") or (
                    f"https://www.sbir.gov/solicitations/{sol_number}" if sol_number else self.source.url
                )

                if not title:
                    continue

                results.append(self._normalize({
                    "title": f"{agency} – {title}" if agency and agency.lower() not in title.lower() else title,
                    "description": description,
                    "url": url,
                    "funder": f"SBIR – {agency}",
                    "deadline": close_date,
                    "program_name": sol_number,
                }))

        except httpx.HTTPStatusError as e:
            logger.warning("SBIR API HTTP error", status=e.response.status_code)
            # Fall back to AI scraper behaviour
        except Exception as e:
            logger.error("SBIR scraper failed", error=str(e))

        logger.info("SBIR scraper complete", found=len(results))
        return results

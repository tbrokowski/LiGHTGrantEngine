"""
SBIR.gov solicitations scraper.

Fetches open SBIR/STTR solicitations from the SBIR.gov public data API.
The legacy www.sbir.gov/api/... endpoints now 404; the current API lives at
api.www.sbir.gov and rate-limits aggressively (429), so we send browser
headers and retry with backoff. No authentication required.
API docs: https://www.sbir.gov/api
"""
import time

import httpx
import structlog
from app.scrapers.base import BaseScraper
from app.scrapers.fetch import BROWSER_HEADERS

logger = structlog.get_logger()

_SOLICITATIONS_URL = "https://api.www.sbir.gov/public/api/solicitations"


class SBIRScraper(BaseScraper):
    """Scraper for SBIR.gov open solicitations."""

    def fetch(self) -> list[dict]:
        results = []
        try:
            # Fetch open solicitations (retry politely on 429 rate limits)
            resp = None
            for attempt in range(3):
                resp = httpx.get(
                    _SOLICITATIONS_URL,
                    timeout=30,
                    headers={**BROWSER_HEADERS, "Accept": "application/json"},
                    params={"open": 1, "rows": 200, "start": 0},
                )
                if resp.status_code != 429:
                    break
                time.sleep(5 * (attempt + 1))
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

                url = (
                    item.get("solicitation_agency_url")
                    or item.get("sbir_solicitation_link")
                    or item.get("solicitation_url")
                    or (f"https://www.sbir.gov/solicitations/{sol_number}" if sol_number else self.source.url)
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
                    "opportunity_number": sol_number or None,
                }))

        except httpx.HTTPStatusError as e:
            logger.warning("SBIR API HTTP error", status=e.response.status_code)
            # Fall back to AI scraper behaviour
        except Exception as e:
            logger.error("SBIR scraper failed", error=str(e))

        logger.info("SBIR scraper complete", found=len(results))
        return results

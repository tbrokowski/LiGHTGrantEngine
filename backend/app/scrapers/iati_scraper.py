"""
IATI Datastore API scraper.

Searches IATI-published international development activities relevant to
LiGHT research themes. No authentication required.
API docs: https://developer.iatistandard.org/

Also covers FCDO/USAID activities published under IATI.
"""
import httpx
import structlog
from app.scrapers.base import BaseScraper

logger = structlog.get_logger()

_DATASTORE_URL = "https://api.iatistandard.org/datastore/activity/select"

_DEFAULT_QUERIES = [
    "artificial intelligence health",
    "digital health LMIC",
    "global health innovation",
    "tuberculosis AI",
    "maternal newborn health",
]

_PAGE_SIZE = 50


class IATIScraper(BaseScraper):
    """Scraper for IATI Datastore API."""

    def fetch(self) -> list[dict]:
        cfg = self.source.scraper_config or {}
        queries = cfg.get("queries", _DEFAULT_QUERIES)
        rows = int(cfg.get("rows", _PAGE_SIZE))

        results = []
        seen_ids: set[str] = set()

        try:
            headers = {
                "Accept": "application/json",
                "User-Agent": "LiGHT Grant System/1.0",
            }

            for query in queries[:3]:
                params = {
                    "q": f"title_narrative:{query} OR description_narrative:{query}",
                    "rows": rows,
                    "start": 0,
                    "fl": "iati_identifier,title_narrative,description_narrative,reporting_org_narrative,"
                          "activity_date_iso_date,activity_status_code,default_currency",
                    "sort": "activity_date_iso_date desc",
                    "wt": "json",
                }
                resp = httpx.get(
                    _DATASTORE_URL,
                    params=params,
                    headers=headers,
                    timeout=30,
                )
                resp.raise_for_status()
                data = resp.json()
                docs = data.get("response", {}).get("docs", [])

                for doc in docs:
                    iati_id = doc.get("iati_identifier", "")
                    if iati_id in seen_ids:
                        continue
                    seen_ids.add(iati_id)

                    # title and description are lists in IATI
                    title_list = doc.get("title_narrative", [])
                    title = title_list[0] if isinstance(title_list, list) and title_list else str(title_list)

                    desc_list = doc.get("description_narrative", [])
                    desc = desc_list[0] if isinstance(desc_list, list) and desc_list else ""

                    org_list = doc.get("reporting_org_narrative", [])
                    org = org_list[0] if isinstance(org_list, list) and org_list else self.source.name

                    dates = doc.get("activity_date_iso_date", [])
                    deadline = dates[-1] if isinstance(dates, list) and dates else None

                    results.append(self._normalize({
                        "title": title,
                        "description": desc,
                        "url": f"https://d-portal.org/ctrack.html#view=act&aid={iati_id}",
                        "funder": org,
                        "deadline": deadline,
                        "program_name": iati_id,
                        "opportunity_number": iati_id or None,
                    }))

        except httpx.HTTPStatusError as e:
            logger.warning("IATI API HTTP error", status=e.response.status_code)
        except Exception as e:
            logger.error("IATI scraper failed", error=str(e))

        logger.info("IATI scraper complete", found=len(results))
        return results

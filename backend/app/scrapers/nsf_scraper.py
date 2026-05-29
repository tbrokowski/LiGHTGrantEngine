"""
NSF Award Search API scraper.

Uses the NSF public awards API to find relevant funding.
No API key required. Returns up to 3,000 results per query.
API docs: https://resources.research.gov/common/webapi/awardapisearch-v1.htm
"""
import httpx
import structlog
from app.scrapers.base import BaseScraper

logger = structlog.get_logger()

_API_URL = "https://api.nsf.gov/services/v1/awards.json"

_SEARCH_KEYWORDS = [
    "artificial intelligence health",
    "machine learning medical",
    "global health digital",
    "point of care diagnostics",
    "federated learning",
]


class NSFScraper(BaseScraper):
    """Scraper for NSF Award Search API."""

    def fetch(self) -> list[dict]:
        cfg = self.source.scraper_config or {}
        keywords = cfg.get("keywords", _SEARCH_KEYWORDS)
        date_start = cfg.get("date_start", "01/01/2023")
        max_per_kw = int(cfg.get("max_per_keyword", 50))

        results = []
        seen_ids: set[str] = set()

        try:
            for kw in keywords[:4]:
                params = {
                    "keyword": kw,
                    "dateStart": date_start,
                    "printFields": "id,title,abstractText,fundsObligatedAmt,expDate,agency,piFirstName,piLastName,awardeeName",
                    "rpp": max_per_kw,
                    "offset": 1,
                }
                resp = httpx.get(
                    _API_URL,
                    params=params,
                    timeout=30,
                    headers={"User-Agent": "LiGHT Grant System/1.0"},
                )
                resp.raise_for_status()
                data = resp.json()
                awards = data.get("response", {}).get("award", [])

                for award in awards:
                    award_id = award.get("id", "")
                    if award_id in seen_ids:
                        continue
                    seen_ids.add(award_id)

                    results.append(self._normalize({
                        "title": award.get("title", ""),
                        "description": award.get("abstractText", ""),
                        "url": f"https://www.nsf.gov/awardsearch/showAward?AWD_ID={award_id}",
                        "funder": f"NSF – {award.get('agency', self.source.name)}",
                        "deadline": award.get("expDate"),
                        "program_name": award.get("id"),
                        "opportunity_number": award_id or None,
                    }))

        except httpx.HTTPStatusError as e:
            logger.warning("NSF API HTTP error", status=e.response.status_code)
        except Exception as e:
            logger.error("NSF scraper failed", error=str(e))

        logger.info("NSF scraper complete", found=len(results))
        return results

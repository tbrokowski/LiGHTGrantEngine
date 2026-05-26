"""
NIH RePORTER API scraper (v2).

Searches NIH-funded projects for themes relevant to LiGHT research.
No authentication required. Rate limit: ~1 req/sec.
API docs: https://api.reporter.nih.gov/
"""
import httpx
import structlog
from app.scrapers.base import BaseScraper

logger = structlog.get_logger()

_SEARCH_URL = "https://api.reporter.nih.gov/v2/projects/search"
_PAGE_SIZE = 500

# Fiscal years to search (recent)
_FISCAL_YEARS = [2024, 2025, 2026]

# Search terms relevant to LiGHT
_SEARCH_TERMS = [
    "artificial intelligence health",
    "machine learning clinical",
    "digital health LMIC",
    "global health AI",
    "medical imaging AI",
    "point of care ultrasound",
    "tuberculosis digital",
    "federated learning health",
]


class NIHReporterScraper(BaseScraper):
    """Scraper for NIH RePORTER v2 API."""

    def fetch(self) -> list[dict]:
        cfg = self.source.scraper_config or {}
        fiscal_years = cfg.get("fiscal_years", _FISCAL_YEARS)
        search_terms = cfg.get("search_terms", _SEARCH_TERMS)
        max_per_term = int(cfg.get("max_per_term", 50))

        results = []
        seen_ids: set[str] = set()

        try:
            for term in search_terms[:5]:  # Cap to avoid excessive API calls
                payload = {
                    "criteria": {
                        "advanced_text_search": {
                            "operator": "and",
                            "search_field": "terms",
                            "search_text": term,
                        },
                        "fiscal_years": fiscal_years,
                    },
                    "include_fields": [
                        "ProjectTitle", "AbstractText", "ProjectNum",
                        "OrgName", "ContactPiName", "FiscalYear",
                        "AwardAmount", "ProjectStartDate", "ProjectEndDate",
                    ],
                    "offset": 0,
                    "limit": max_per_term,
                    "sort_field": "project_start_date",
                    "sort_order": "desc",
                }
                resp = httpx.post(
                    _SEARCH_URL,
                    json=payload,
                    timeout=30,
                    headers={"Content-Type": "application/json", "User-Agent": "LiGHT Grant System/1.0"},
                )
                resp.raise_for_status()
                data = resp.json()

                for item in data.get("results", []):
                    proj_num = item.get("project_num", "")
                    if proj_num in seen_ids:
                        continue
                    seen_ids.add(proj_num)

                    award = item.get("award_amount")
                    results.append(self._normalize({
                        "title": item.get("project_title", ""),
                        "description": item.get("abstract_text", ""),
                        "url": f"https://reporter.nih.gov/project-details/{proj_num}" if proj_num else "",
                        "funder": f"NIH – {item.get('org_name', self.source.name)}",
                        "deadline": item.get("project_end_date"),
                        "program_name": proj_num,
                    }))

        except httpx.HTTPStatusError as e:
            logger.warning("NIH RePORTER HTTP error", status=e.response.status_code)
        except Exception as e:
            logger.error("NIH RePORTER scraper failed", error=str(e))

        logger.info("NIH RePORTER scraper complete", found=len(results))
        return results

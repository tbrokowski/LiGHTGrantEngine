"""
UKRI Gateway to Research (GtR) API scraper.

Searches UKRI-funded projects for themes relevant to LiGHT research.
No authentication required. Data updated quarterly.
API docs: https://gtr.ukri.org/resources/GtR-2-API-v1.7.5.pdf
"""
import httpx
import structlog
from app.scrapers.base import BaseScraper

logger = structlog.get_logger()

_BASE_URL = "https://gtr.ukri.org/gtr/api"
_PROJECTS_URL = f"{_BASE_URL}/projects"

_DEFAULT_QUERY = "artificial intelligence health digital global"
_PAGE_SIZE = 100


class UKRIGtRScraper(BaseScraper):
    """Scraper for UKRI Gateway to Research API."""

    def fetch(self) -> list[dict]:
        cfg = self.source.scraper_config or {}
        query = cfg.get("query", _DEFAULT_QUERY)
        max_pages = int(cfg.get("max_pages", 3))

        results = []
        seen_ids: set[str] = set()

        try:
            headers = {
                "Accept": "application/vnd.rcuk.gtr.json-v7",
                "User-Agent": "LiGHT Grant System/1.0",
            }

            for page in range(1, max_pages + 1):
                params = {
                    "q": query,
                    "f": "pro.t",  # search in project titles
                    "s": _PAGE_SIZE,
                    "p": page,
                }
                resp = httpx.get(
                    _PROJECTS_URL,
                    params=params,
                    headers=headers,
                    timeout=30,
                )
                resp.raise_for_status()
                data = resp.json()
                projects = data.get("project", [])

                if not projects:
                    break

                for proj in projects:
                    proj_id = proj.get("id", "")
                    if proj_id in seen_ids:
                        continue
                    seen_ids.add(proj_id)

                    fund = proj.get("fund", {})
                    funder_info = fund.get("funder", {})
                    funder_name = funder_info.get("name", self.source.name) if isinstance(funder_info, dict) else self.source.name

                    results.append(self._normalize({
                        "title": proj.get("title", ""),
                        "description": proj.get("abstractText", ""),
                        "url": proj.get("url") or f"https://gtr.ukri.org/projects?ref={proj_id}",
                        "funder": f"UKRI – {funder_name}",
                        "deadline": fund.get("end") if isinstance(fund, dict) else None,
                        "program_name": proj.get("grantCategory") or proj.get("status"),
                    }))

                if len(projects) < _PAGE_SIZE:
                    break

        except httpx.HTTPStatusError as e:
            logger.warning("UKRI GtR HTTP error", status=e.response.status_code)
        except Exception as e:
            logger.error("UKRI GtR scraper failed", error=str(e))

        logger.info("UKRI GtR scraper complete", found=len(results))
        return results

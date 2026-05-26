"""
ProPublica Nonprofit Explorer (IRS 990) scraper.

Uses the ProPublica free API to find nonprofits and foundations that fund
health/AI/global development research (useful for identifying new funders).
API docs: https://projects.propublica.org/nonprofits/api
"""
import httpx
import structlog
from app.scrapers.base import BaseScraper

logger = structlog.get_logger()

_SEARCH_URL = "https://projects.propublica.org/nonprofits/api/v2/organizations.json"
_ORG_URL = "https://projects.propublica.org/nonprofits/api/v2/organizations/{ein}.json"

_DEFAULT_QUERIES = [
    "artificial intelligence health research",
    "global health foundation",
    "digital health innovation",
    "medical research foundation",
]


class ProPublicaScraper(BaseScraper):
    """Scraper for ProPublica 990 nonprofit data to identify funders."""

    def fetch(self) -> list[dict]:
        cfg = self.source.scraper_config or {}
        queries = cfg.get("queries", _DEFAULT_QUERIES)
        per_page = int(cfg.get("per_page", 25))

        results = []
        seen_eins: set[str] = set()

        try:
            headers = {"User-Agent": "LiGHT Grant System/1.0"}

            for query in queries[:3]:
                params = {"q": query, "ntee[0]": "H"}  # NTEE H = Health
                resp = httpx.get(
                    _SEARCH_URL,
                    params=params,
                    headers=headers,
                    timeout=30,
                )
                resp.raise_for_status()
                data = resp.json()
                orgs = data.get("organizations", [])

                for org in orgs[:per_page]:
                    ein = str(org.get("ein", ""))
                    if ein in seen_eins:
                        continue
                    seen_eins.add(ein)

                    name = org.get("name", "")
                    city = org.get("city", "")
                    state = org.get("state", "")
                    income = org.get("income_amount", 0) or 0
                    ntee = org.get("ntee_code", "")

                    # Only include substantial foundations (>$1M income)
                    if income < 1_000_000:
                        continue

                    results.append(self._normalize({
                        "title": f"Funder Profile: {name}",
                        "description": (
                            f"{name} is a nonprofit organization based in {city}, {state}. "
                            f"Annual income: ${income:,.0f}. NTEE code: {ntee}. "
                            f"This organization may offer grant funding opportunities."
                        ),
                        "url": f"https://projects.propublica.org/nonprofits/organizations/{ein}",
                        "funder": name,
                        "deadline": None,
                        "program_name": f"EIN: {ein}",
                    }))

        except httpx.HTTPStatusError as e:
            logger.warning("ProPublica HTTP error", status=e.response.status_code)
        except Exception as e:
            logger.error("ProPublica scraper failed", error=str(e))

        logger.info("ProPublica scraper complete", found=len(results))
        return results

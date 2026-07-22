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

_SEARCH_URL = "https://projects.propublica.org/nonprofits/api/v2/search.json"
_ORG_URL = "https://projects.propublica.org/nonprofits/api/v2/organizations/{ein}.json"

# Keep queries to 1-2 words: the search API ANDs all terms and returns
# HTTP 404 (not an empty list) when nothing matches (audit 2026-07-22).
_DEFAULT_QUERIES = [
    "global health",
    "medical research",
    "health foundation",
    "digital health",
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
                # NTEE filtering moved client-side: the ntee[] query param 404s
                # on the current v2 search endpoint (audit 2026-07-22).
                params = {"q": query}
                resp = httpx.get(
                    _SEARCH_URL,
                    params=params,
                    headers=headers,
                    timeout=30,
                )
                if resp.status_code == 404:
                    # API quirk: 404 means "no organizations matched this query"
                    continue
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
                    ntee = org.get("ntee_code", "") or ""

                    # The v2 search response no longer includes income_amount
                    # (audit 2026-07-22), so size-filtering moved out. Keep a
                    # loose health/science/education relevance gate via NTEE
                    # major group when a code is present (E=health, G/H=disease
                    # & medical research, B=education, U=science/tech).
                    if ntee and ntee[0].upper() not in ("E", "G", "H", "B", "U", "Q", "T"):
                        continue

                    results.append(self._normalize({
                        "title": f"Funder Profile: {name}",
                        "description": (
                            f"{name} is a nonprofit organization based in {city}, {state}. "
                            f"NTEE code: {ntee or 'unknown'}. "
                            f"This organization may offer grant funding opportunities."
                        ),
                        "url": f"https://projects.propublica.org/nonprofits/organizations/{ein}",
                        "funder": name,
                        "deadline": None,
                        "program_name": f"EIN: {ein}",
                        "opportunity_number": f"EIN:{ein}" if ein else None,
                    }))

        except httpx.HTTPStatusError as e:
            logger.warning("ProPublica HTTP error", status=e.response.status_code)
        except Exception as e:
            logger.error("ProPublica scraper failed", error=str(e))

        logger.info("ProPublica scraper complete", found=len(results))
        return results

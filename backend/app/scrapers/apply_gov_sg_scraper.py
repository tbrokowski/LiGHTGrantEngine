"""
Singapore Research Grants Portal scraper (apply.gov.sg).

The listing at https://www.apply.gov.sg/grants/research/listing is a JS-rendered
SPA, so the generic HTML/AI scrapers get nothing: a plain GET of that URL returns
``{"message": "Not found"}``. The same URL serves the listing as JSON when asked
with ``Accept: application/json`` — no auth, no cookies — which is exactly what
the page's own client does. Shape:

    {"data": {"lifecycles": [
        {"id": 2184,
         "name": "36th Competitive Research Programme (CRP36)",
         "has_active_form": true,
         "data": {"excerpt": "... The CRP36 call closes on 9 Nov 2026, 4 PM (SGT).",
                  "domain_horizontal": "Academic Research (AR)",
                  "grant_administering_agency": "National Research Foundation",
                  "website_url": "https://www.rgp.gov.sg/nrf-ar/crp",
                  "support_contact_email": "nrf_crp@nrf.gov.sg",
                  "support_contact_url": ""}}]}}

apply.gov.sg has no per-grant detail endpoint (``/grants/research/<id>`` 404s).
Each card's "Website" link is the grant's real page on the administering agency's
own site, so "opening the individual boxes" means following ``website_url``. With
``follow_details`` (default on) we fetch that page for a fuller description and a
deadline — the listing excerpt only ever states the closing date in prose.

scraper_config keys:
  follow_details (bool, default True)  — fetch each grant's website_url
  max_details    (int,  default 25)    — cap on detail fetches per run
  include_closed (bool, default False) — keep grants with no active form
  use_playwright (bool, default False) — force a browser for detail pages
"""
import re
from datetime import date

import httpx
import structlog

from app.scrapers.base import BaseScraper
from app.scrapers.fetch import BROWSER_HEADERS, fetch_page

logger = structlog.get_logger()

LISTING_URL = "https://www.apply.gov.sg/grants/research/listing"

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

# "9 Nov 2026" / "31 December 2026"
_DMY = re.compile(r"\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b")
# "Nov 9, 2026" / "December 31 2026"
_MDY = re.compile(r"\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b")

# Sentences that actually announce a closing date, preferred over any stray year
# mentioned elsewhere on a detail page (eligibility text, award history, ...).
_DEADLINE_CUE = re.compile(
    r"(clos\w+|deadline|due|submit\w*\s+by|last\s+day|expir\w+"
    r"|until|remain\w*\s+open|applications?\s+open)",
    re.I,
)


def _iso(day: int, month_name: str, year: int) -> str | None:
    month = _MONTHS.get(month_name[:3].lower())
    if not month:
        return None
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def _dates_in(text: str) -> list[str]:
    found = []
    for d, m, y in _DMY.findall(text):
        iso = _iso(int(d), m, int(y))
        if iso:
            found.append(iso)
    for m, d, y in _MDY.findall(text):
        iso = _iso(int(d), m, int(y))
        if iso:
            found.append(iso)
    return found


def _parse_deadline(text: str) -> str | None:
    """Best-effort closing date from freeform prose.

    Prefers a date in a sentence that mentions closing/deadline/due; falls back
    to the earliest future date anywhere in the text. Returns an ISO date.
    """
    if not text:
        return None

    today = date.today().isoformat()

    cued: list[str] = []
    for sentence in re.split(r"(?<=[.!?])\s+|\n+", text):
        if _DEADLINE_CUE.search(sentence):
            cued.extend(_dates_in(sentence))
    future_cued = sorted(d for d in cued if d >= today)
    if future_cued:
        return future_cued[0]
    if cued:
        return sorted(cued)[-1]

    future_any = sorted(d for d in _dates_in(text) if d >= today)
    return future_any[0] if future_any else None


def _page_text(html: str, limit: int = 20_000) -> str:
    """Visible text of a detail page, for deadline/description extraction."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "nav", "footer", "header"]):
        tag.decompose()
    return re.sub(r"\n{3,}", "\n\n", soup.get_text("\n", strip=True))[:limit]


class ApplyGovSGScraper(BaseScraper):
    """Singapore's whole-of-government research grants portal."""

    def fetch(self) -> list[dict]:
        cfg = self.source.scraper_config or {}
        follow_details: bool = bool(cfg.get("follow_details", True))
        max_details: int = int(cfg.get("max_details", 25))
        include_closed: bool = bool(cfg.get("include_closed", False))
        use_playwright: bool = bool(cfg.get("use_playwright", False))

        url = self.source.url or LISTING_URL
        # The Accept header is load-bearing: without it the SPA route 404s.
        headers = {**BROWSER_HEADERS, "Accept": "application/json"}

        try:
            resp = httpx.get(url, timeout=30, headers=headers, follow_redirects=True)
            resp.raise_for_status()
            payload = resp.json()
        except Exception as e:
            logger.error("apply.gov.sg: listing fetch failed", url=url, error=str(e))
            return []

        lifecycles = ((payload or {}).get("data") or {}).get("lifecycles") or []
        if not lifecycles:
            logger.warning("apply.gov.sg: listing returned no lifecycles", url=url)
            return []

        results: list[dict] = []
        detail_budget = max_details if follow_details else 0

        for item in lifecycles:
            if not isinstance(item, dict):
                continue
            title = (item.get("name") or "").strip()
            if not title:
                continue
            if not include_closed and item.get("has_active_form") is False:
                continue

            data = item.get("data") or {}
            excerpt = (data.get("excerpt") or "").strip()
            agency = (data.get("grant_administering_agency") or "").strip()
            domain = (data.get("domain_horizontal") or "").strip()
            website = (data.get("website_url") or "").strip()
            email = (data.get("support_contact_email") or "").strip()
            contact_url = (data.get("support_contact_url") or "").strip()

            call_url = website or contact_url
            description = excerpt
            deadline = _parse_deadline(excerpt)

            # Open the individual grant's own page for the detail the card omits.
            if call_url and detail_budget > 0:
                detail_budget -= 1
                try:
                    page = fetch_page(call_url, force_playwright=use_playwright)
                    if page.ok:
                        text = _page_text(page.html)
                        if text:
                            deadline = deadline or _parse_deadline(text)
                            if len(text) > len(description):
                                description = (
                                    f"{excerpt}\n\n{text}" if excerpt else text
                                )
                    else:
                        logger.info(
                            "apply.gov.sg: detail page unavailable",
                            url=call_url, status=page.status_code, error=page.error,
                        )
                except Exception as e:
                    # A broken agency page must not sink the whole listing.
                    logger.warning(
                        "apply.gov.sg: detail fetch failed", url=call_url, error=str(e)
                    )

            contact_bits = " | ".join(b for b in (email, contact_url) if b)
            if contact_bits:
                description = f"{description}\n\nContact: {contact_bits}".strip()

            results.append(self._normalize({
                "title": title,
                "description": description,
                "url": call_url,
                "funder": agency or self.source.name,
                "deadline": deadline,
                "program_name": domain or None,
                "opportunity_number": str(item.get("id")) if item.get("id") else None,
                "opportunity_type": "grant",
            }))

        logger.info(
            "apply.gov.sg: parsed listings",
            count=len(results), followed_details=max_details - detail_budget,
        )
        return results

"""
Seed all grant sources from grant_funding_portals.xlsx into the database.

Usage (from repo root):
    cd backend
    python scripts/seed_sources_from_excel.py

Or with a custom path:
    python scripts/seed_sources_from_excel.py --excel /path/to/grant_funding_portals.xlsx
"""
import sys
import os
import argparse
import uuid

# Allow imports from app/ when run from backend/
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    import openpyxl
except ImportError:
    print("openpyxl not installed. Run: pip install openpyxl")
    sys.exit(1)

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from app.config import get_settings
from app.models.source import Source

settings = get_settings()

# ── Scraper type mapping ────────────────────────────────────────────────────
# Sources where we have dedicated API scrapers (registered in scrapers/__init__.py)
DEDICATED_SCRAPER_MAP = {
    "grants.gov": "grants_gov",
    "simpler.grants.gov": "grants_gov",
    "reporter.nih.gov": "nih_reporter",
    "nsf.gov": "nsf",
    "sbir.gov": "sbir",
    "ec.europa.eu": "eu_funding",
    "eufundingportal": "eu_funding",
    "gtr.ukri.org": "ukri_gtr",
    "iatistandard.org": "iati",
    "d-portal.org": "iati",
    "grantnav.threesixtygiving.org": "three60giving",
    "openalex.org": "openalex",
    "propublica.org": "propublica",
}

# Source website domain → local static logo path served by Next.js from frontend/public/logos/
# Logos downloaded by backend/scripts/download_logos.py
FUNDER_LOGO_DOMAINS = {
    "grants.gov":                   "/logos/grants-gov.svg",
    "simpler.grants.gov":           "/logos/grants-gov.svg",
    "reporter.nih.gov":             "/logos/nih.svg",
    "nsf.gov":                      "/logos/nsf.svg",
    "sbir.gov":                     "/logos/nsf.svg",
    "gatesfoundation.org":          "/logos/gates-foundation.svg",
    "wellcome.org":                 "/logos/wellcome.svg",
    "fordfoundation.org":           "/logos/ford-foundation.svg",
    "macfound.org":                 "/logos/macarthur.svg",
    "ec.europa.eu":                 "/logos/horizon-europe.svg",
    "cordis.europa.eu":             "/logos/horizon-europe.svg",
    "erc.europa.eu":                "/logos/horizon-europe.svg",
    "eic.ec.europa.eu":             "/logos/horizon-europe.svg",
    "ukri.org":                     "/logos/ukri.svg",
    "gtr.ukri.org":                 "/logos/ukri.svg",
    "worldbank.org":                "/logos/world-bank.svg",
    "theglobalfund.org":            "/logos/global-fund.svg",
    "who.int":                      "/logos/who.svg",
    "unicef.org":                   "/logos/unicef.svg",
    "undp.org":                     "/logos/undp.svg",
    "usaid.gov":                    "/logos/usaid.svg",
    "edctp.org":                    "/logos/edctp.jpg",
    "elrha.org":                    "/logos/wellcome.svg",
    "ted.com":                      "/logos/ted.svg",
    "chanzuckerberg.com":           "/logos/chan-zuckerberg.svg",
    "openphilanthropy.org":         "/logos/open-philanthropy.svg",
}

# High-priority sources (flag for daily/frequent scanning)
HIGH_PRIORITY_NAMES = {
    "grants.gov (simpler grants)",
    "nih reporter",
    "nsf award search",
    "sbir.gov",
    "eu funding & tenders portal",
    "horizon europe / cordis",
    "ukri gateway to research",
    "ukri funding opportunities",
    "iati datastore / d-portal",
    "360giving grantnav",
    "openalex",
    "bill & melinda gates foundation",
    "wellcome trust",
    "grand challenges",
    "bill & melinda gates foundation – grand challenges explorations",
    "chan zuckerberg initiative",
    "wellcome leap",
}

# API endpoint mappings for API-type sources
API_ENDPOINT_MAP = {
    "grants.gov (simpler grants)": {
        "endpoint": "https://simpler.grants.gov/api/opportunities/search",
        "config": {
            "method": "post",
            "params": {"query": "health AI digital", "pagination": {"page_offset": 1, "page_size": 100}},
            "items_key": "data",
            "title_field": "opportunity_title",
            "desc_field": "summary_description",
            "url_field": "opportunity_id",
            "deadline_field": "close_date",
        },
    },
    "nih reporter": {
        "endpoint": "https://api.reporter.nih.gov/v2/projects/search",
        "config": {
            "method": "post",
            "items_key": "results",
            "title_field": "project_title",
            "desc_field": "abstract_text",
            "url_field": "opportunity_number",
            "deadline_field": "fiscal_year",
        },
    },
    "nsf award search": {
        "endpoint": "https://api.nsf.gov/services/v1/awards.json",
        "config": {
            "params": {"keyword": "artificial intelligence health digital", "dateStart": "01/01/2024"},
            "items_key": "response.award",
            "title_field": "title",
            "desc_field": "abstractText",
            "url_field": "id",
            "deadline_field": "expDate",
        },
    },
    "ukri gateway to research (gtr)": {
        "endpoint": "https://gtr.ukri.org/gtr/api/projects",
        "config": {
            "params": {"q": "AI health digital", "f": "pro.t", "s": 100},
            "items_key": "project",
            "title_field": "title",
            "desc_field": "abstractText",
            "url_field": "url",
        },
    },
}


def _get_logo_url(website: str) -> str | None:
    """Return a local static logo path for a source website, or None if not mapped."""
    if not website:
        return None
    try:
        from urllib.parse import urlparse
        parsed = urlparse(website if website.startswith("http") else f"https://{website}")
        domain = parsed.netloc.lstrip("www.")
        for key, logo_path in FUNDER_LOGO_DOMAINS.items():
            if key in domain or domain in key:
                return logo_path
    except Exception:
        pass
    return None


def _get_scraper_type(name: str, website: str, has_api: str) -> str:
    """Determine scraper type from source metadata."""
    name_lower = name.lower()
    website_lower = (website or "").lower()

    # Check dedicated scraper map
    for key, scraper_type in DEDICATED_SCRAPER_MAP.items():
        if key in website_lower:
            return scraper_type

    # Decide based on API availability
    if has_api and (has_api.startswith("YES") or has_api.startswith("Partial")):
        # Has API but no dedicated scraper → use generic ai_scraper (it handles JS pages well)
        return "ai_scraper"

    return "ai_scraper"


def seed_sources(excel_path: str, dry_run: bool = False):
    engine = create_engine(settings.database_url)

    wb = openpyxl.load_workbook(excel_path)
    ws = wb["Grant & Funding Sources"]

    rows = list(ws.iter_rows(min_row=2, values_only=True))
    print(f"Found {len(rows)} rows in Excel")

    sources_to_add = []
    for row in rows:
        if not any(row):
            continue
        category, name, website, has_api, api_endpoint_doc, api_auth, data_available, scraping_notes = (
            row + (None,) * 8
        )[:8]

        if not name or not website:
            continue

        name = str(name).strip()
        website = str(website).strip() if website else None
        has_api = str(has_api).strip() if has_api else "NO"
        category = str(category).strip() if category else "Other"
        data_available = str(data_available).strip() if data_available else None
        scraping_notes = str(scraping_notes).strip() if scraping_notes else None

        scraper_type = _get_scraper_type(name, website or "", has_api)
        logo_url = _get_logo_url(website or "")
        is_high_priority = name.lower() in HIGH_PRIORITY_NAMES

        # Refresh frequency based on priority
        refresh_frequency = "daily" if is_high_priority else "weekly"

        # Scraper config
        scraper_config = {}
        api_endpoint = None

        # Use dedicated API configs where we have them
        name_key = name.lower()
        for key, api_cfg in API_ENDPOINT_MAP.items():
            if key in name_key:
                api_endpoint = api_cfg["endpoint"]
                scraper_config = api_cfg.get("config", {})
                break

        # For AI scraper sources, configure crawl depth for paginated listing sites
        if scraper_type == "ai_scraper" and not scraper_config:
            scraper_config = {
                "use_playwright": True,
                "crawl_depth": 0,
            }
            # Enable depth-1 crawl for known listing sites
            if website and any(kw in website.lower() for kw in [
                "grants.gov", "foundation.org", "philanthropy", "fundsfor"
            ]):
                scraper_config["crawl_depth"] = 1

        relevant_themes = []
        if data_available:
            d = data_available.lower()
            if any(kw in d for kw in ["health", "medical", "ai", "digital", "climate"]):
                relevant_themes = ["health", "digital", "AI"]
            if "development" in d or "lmic" in d or "international" in d:
                relevant_themes.append("global health")

        sources_to_add.append({
            "id": str(uuid.uuid4()),
            "name": name,
            "category": category,
            "url": website,
            "source_type": scraper_type,
            "api_endpoint": api_endpoint,
            "scraper_config": scraper_config,
            "refresh_frequency": refresh_frequency,
            "is_high_priority": is_high_priority,
            "logo_url": logo_url,
            "status": "active",
            "relevant_themes": list(set(relevant_themes)),
            "notes": scraping_notes,
        })

    print(f"Prepared {len(sources_to_add)} sources to seed")

    if dry_run:
        for s in sources_to_add:
            print(f"  [{s['source_type']:15}] {s['name'][:60]}")
        print("\nDry run — no changes made.")
        return

    with Session(engine) as db:
        existing_names = {
            row[0].lower()
            for row in db.execute(
                __import__("sqlalchemy").text("SELECT name FROM sources")
            ).fetchall()
        }

        added = 0
        skipped = 0
        for s in sources_to_add:
            if s["name"].lower() in existing_names:
                skipped += 1
                continue
            source = Source(**s)
            db.add(source)
            added += 1

        db.commit()
        print(f"Done: {added} sources added, {skipped} already existed.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed grant sources from Excel")
    parser.add_argument(
        "--excel",
        default=os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
            "grant_funding_portals.xlsx",
        ),
        help="Path to grant_funding_portals.xlsx",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print sources without inserting")
    args = parser.parse_args()

    print(f"Loading Excel from: {args.excel}")
    seed_sources(args.excel, dry_run=args.dry_run)

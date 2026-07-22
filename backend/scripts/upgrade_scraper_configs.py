#!/usr/bin/env python3
"""
Upgrade scraper_config for all ai_scraper sources in grant_funding_portals.json.

Rules applied:
  1. depth=0 → depth=1 for real funder pages (not aggregators/portals/data sites)
  2. paginate + max_pages added to all listing pages based on funder size
  3. link_filter added to sites where crawl should stay on grant subpaths
  4. use_playwright=True enforced on all ai_scraper entries

Usage:
    cd backend
    python scripts/upgrade_scraper_configs.py [--dry-run]

Note: as of the pagination/detail-crawl overhaul, newly discovered sources get
paginate/max_pages set automatically at discovery time via
app.scrapers.ai_scraper.probe_pagination (see discovery_tasks.discover_new_sources),
so this script's ongoing purpose narrows to one-off legacy cleanup and manual
link_filter/crawl_depth=2/site_sections tuning.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "data"

# ── Classification tables ────────────────────────────────────────────────────

# Aggregators, login-required platforms, data portals, procurement systems.
# These stay at depth=0 — the AI scraper can't meaningfully follow their links.
KEEP_DEPTH_0: set[str] = {
    # Grant aggregator platforms (require accounts or are listing sites)
    "DevelopmentAid.org",
    "Candid Foundation Directory Online (FDO)",
    "Candid / 990 Finder (Nonprofit data)",
    "Instrumentl",
    "GrantWatch",
    "Pivot-RP (ProQuest/Clarivate)",
    "OpenGrants.io",
    "GrantStation",
    "OpenOpps.com (World Bank, ADB, IDB tenders)",
    "SPIN – Sponsored Programs Information Network (InfoEd)",
    "GrantForward",
    "Inside Philanthropy (Grant Finder)",
    "ResearchProfessional (Clarivate)",
    "Dimensions (Digital Science) – Grants",
    "CrossRef Grant Metadata",
    "Europe PubMed Central (Europe PMC) – Grants",
    "Semantic Scholar (AI2) – Funding metadata",
    "Terra Viva Grants",
    # Announcements boards (ephemeral, no individual grant pages worth following)
    "Artforum – Opportunities Listings",
    "e-flux – Open Calls",
    # Data / spending portals
    "SAM.gov – Contract & Grant Opportunities",
    "USASpending.gov",
    "Federal Audit Clearinghouse (GSA)",
    "AidData (College of William & Mary)",
    "European Commission Open Data Portal",
    "Research Portal Denmark (Forskningsportal.dk)",
    "FCDO DevTracker (UK Foreign Aid)",
    "World Bank Open Data / Projects",
    # Procurement/tender systems (not open calls for researchers)
    "UN Global Marketplace (UNGM) – Procurement",
    "UNICEF Supply Division / Procurement",
    "WHO Procurement / Calls",
    "Asian Development Bank (ADB) Tenders & Grants",
    "Inter-American Development Bank (IDB/IADB)",
    "African Development Bank (AfDB) Tenders",
    "European Bank for Reconstruction and Development (EBRD – ECEPP)",
    "European Investment Bank (EIB)",
    # Project/grant-management tools (not opportunity listings)
    "EMDESK (Horizon Europe project management)",
    "eCivis (Government Grant Management)",
    "EU Funding & Grants Portal (eufundingportal.eu – aggregator)",
    # Publication databases
    "Wellcome Open Research (publications/grants)",
    # Duplicate/subsumed entries that are covered by a dedicated scraper
    "Bill & Melinda Gates Foundation – Grand Challenges Explorations",
    "Grand Challenges (BMGF / USAID / Grand Challenges Canada)",
    "Innovate UK – Smart Grants & Competitions",           # covered by UKRI scraper
    "Wellcome Leap (health moonshots)",                    # duplicate Wellcome Leap entry
    "CGIAR Research Programs (agriculture)",               # programme overview, not calls
}

# ── Pagination size tiers ─────────────────────────────────────────────────────
# Sources in none of these sets get max_pages=5 (the safe default).

MAX_PAGES_10: set[str] = {
    # Very large foundations — dozens to hundreds of active grants
    "Bill & Melinda Gates Foundation",
    "Grand Challenges Global (BMGF) – Grant Opportunities",
    "Grand Challenges Explorations (BMGF / Grand Challenges Canada)",
    "Wellcome Trust",
    "Wellcome Data for Science and Health",
    "Wellcome Africa Research Programmes",
    "Wellcome Early Career Awards",
    "Ford Foundation",
    "MacArthur Foundation",
    "Open Society Foundations",
    "Robert Wood Johnson Foundation (RWJF)",
    "Rockefeller Foundation",
    "Bloomberg Philanthropies",
    "Simons Foundation",
    "Alfred P. Sloan Foundation",
    "Open Philanthropy",
    "Chan Zuckerberg Initiative",
    "Andrew W. Mellon Foundation",
    "Kresge Foundation",
    "William & Flora Hewlett Foundation",
    "Pew Charitable Trusts",
    "Carnegie Corporation of New York",
    "Howard Hughes Medical Institute (HHMI)",
    "David and Lucile Packard Foundation",
    "Joyce Foundation",
    "John S. and James L. Knight Foundation",
    "Spencer Foundation",
    "Ewing Marion Kauffman Foundation",
    "Conrad N. Hilton Foundation",
    "Doris Duke Foundation",
    "Annie E. Casey Foundation",
    "Arnold Ventures",
    "Gordon and Betty Moore Foundation",
    "W.K. Kellogg Foundation",
    "Mastercard Foundation",
    "Lumina Foundation",
    "Children's Investment Fund Foundation (CIFF)",
    "Children's Investment Fund Foundation",
    "Burroughs Wellcome Fund",
    "William T. Grant Foundation",
    # Large national research councils
    "NIHR – National Institute for Health & Care Research",
    "NIHR Global Health Research",
    "Cancer Research UK (CRUK)",
    "UKRI Funding Opportunities",
    "DFG – Deutsche Forschungsgemeinschaft (German Research Foundation)",
    "Swiss National Science Foundation (SNSF)",
    "NWO – Dutch Research Council (Netherlands)",
    "Research Council of Norway (Norges Forskningsråd)",
    "ANR – Agence Nationale de la Recherche (France)",
    "Academy of Finland / Research Council of Finland",
    "Novo Nordisk Foundation",
    "fundsforNGOs",
    "FundsforNGOs Premium / Grants Alert",
    "ProposalCentral – Grant Submission Aggregator",
    "DAAD – German Academic Exchange Scholarships",
}

MAX_PAGES_3: set[str] = {
    # Fellowship/award programs with a small, fixed number of slots
    "Fulbright Program – US Scholar",
    "Branco Weiss Fellowship (ETH Zurich / EPFL-adjacent)",
    "Guggenheim Fellowship",
    "ACLS – Fellowships & Grants",
    "Chevening Scholarships",
    "NWO Veni/Vidi/Vici Talent Programme (Netherlands)",
    "American Academy in Rome – Rome Prize",
    "MacArthur Foundation – Fellowships ('Genius Grant')",
    "Commonwealth Scholarships",
    "Swiss Government Excellence Scholarships",
    "Whiting Foundation – Grants & Fellowships",
    "Pulitzer Center – Grants",
    "Thomas J. Watson Fellowship",
    "Rotary Peace Fellowship",
    "Nieman Foundation – Fellowships",
    "Heinrich Böll Stiftung – Scholarships",
    "Friedrich Ebert Stiftung – Scholarships",
    "Schmidt Science Fellows",
    "Gates Cambridge Scholarships",
    "Fogarty International Center – NIH Global Health Fellowships",
    "Wellcome Leap – Research Challenges",
    "Wellcome Leap",
    "Branco Weiss Fellowship (ETH Zurich / EPFL-adjacent)",
    # Small arts grants and residency programs
    "Rhizome – Digital Art Commissions",
    "Eyebeam – Residency & Grants",
    "Creative Capital",
    "United States Artists – Fellowships",
    "Sundance Institute – Grants",
    "Alliance of Artists Communities – Residencies",
    "Artadia – Grants",
    "Foundation for Contemporary Arts",
    "Franklin Furnace Archive",
    "MAP Fund – Performing Arts",
    "Lower Manhattan Cultural Council – Grants",
    "Jan Michalski Foundation – Fellowships",
    "Tribeca Foundation – Grants",
    "Ars Electronica – Open Calls",
    "American Academy in Rome – Rome Prize",
    "Leenaards Foundation",
    "Luminos Fund – Grants",
    "FACE Foundation – French-American Cultural",
    "Kunsthaus Zürich – Open Calls",
    "Konrad Adenauer Stiftung – Scholarships",
    "Rosa Luxemburg Stiftung – Scholarships",
    "Whiting Foundation – Grants & Fellowships",
    # Single-programme / project-based funders
    "Rotary Peace Fellowship",
    "Gates Cambridge Scholarships",
    "Newton Fund / British Council",
    "Swiss Government Excellence Scholarships",
    "EUREKA Network (collaborative R&D)",
    "NordForsk – Nordic Research and Innovation Funding",
    "Italian National Recovery Plan (PNRR) – Health Extended R&D",
    "Culture Moves Europe – Mobility Grants",
    "MSCA Marie Curie – Individual Fellowships",
    "Erasmus+ – EU Education & Youth Grants",
    "Mo Ibrahim Foundation",
    "Grand Challenges Canada",
    "JICA – Japan International Cooperation Agency",
    "KOICA – Korea International Cooperation Agency",
    "CIFAR – Canadian Institute for Advanced Research",
    "Horizon Europe NCP Portal",
    "UK AI Safety Institute / DSIT",
    "French AI National Strategy (Programme IA / ANR IA)",
    "Philips Foundation – Health Access",
    "Roche Foundation",
    "Sanofi Espoir Foundation",
    "Johnson & Johnson Foundation – Global Health",
    "Novartis Foundation",
    "Serpentine Galleries – Open Calls",
    "TransArtists – Residency Database",
    "Res Artis – Worldwide Residency Network",
    "European Cultural Foundation – Grants",
    "Nordic Culture Fund",
    "Jerome Foundation – Grants",
    "Porticus Foundation – Grants",
    "Mid Atlantic Arts – Grants",
    "New England Foundation for the Arts",
    "Paul Hamlyn Foundation – Grants",
    "Schmidt Futures – Grants",
    "Mozilla Foundation – Awards",
    "British Council – Arts Grants",
    "Goethe-Institut – Cultural Funding",
    "Institut français – Cultural Grants (AFAA)",
    "Creative Scotland – Funding",
    "Creative Time – Grants",
    "Mondriaan Fund – Dutch Arts",
    "Prince Claus Fund",
    "International Documentary Association – IDA Grants",
    "Robert Bosch Stiftung (Robert Bosch Foundation)",
    "Robert Bosch Stiftung – Grants",
    "Mercator Stiftung – Funding",
    "VolkswagenStiftung (Volkswagen Foundation)",
    "Volkswagen Stiftung – Funding",
    "Fondazione Cariplo – Grants",
    "Fondazione Compagnia di San Paolo",
    "European Climate Foundation",
    "Skoll Foundation",
    "DBT – Department of Biotechnology (India)",
    "NMRC – National Medical Research Council (Singapore)",
    "Singapore National Research Foundation (NRF-SG)",
    "NRF – National Research Foundation of Korea",
    "JSPS – Japan Society for the Promotion of Science (KAKENHI)",
    "AMED – Japan Agency for Medical Research and Development",
}

# ── Link filters ──────────────────────────────────────────────────────────────
# Applied to depth=1 sources to prevent the crawler following nav/news/about links.
# Each entry: source name → regex string used as link_filter.

LINK_FILTERS: dict[str, str] = {
    # Government sites with mixed content — restrict to grant/funding subpaths
    "DARPA – R&D Opportunities (BAAs)":
        r"/work-with-us/|/opportunities",
    "DOD CDMRP – Congressionally Directed Medical Research Programs":
        r"/funding",
    "USDA NIFA – National Institute of Food and Agriculture":
        r"/grants/|/funding",
    "CDC – Centers for Disease Control and Prevention Grants":
        r"/grants|/funding",
    "AHRQ – Agency for Healthcare Research and Quality":
        r"/funding",
    "DOE Office of Science – PAMS Grant Portal":
        r"/grants|/funding|/program",
    "NASA – NSPIRES (Research Opportunities in Space and Earth Sciences)":
        r"/solicitations|/opportunities",
    "UK International Development Funding (GOV.UK)":
        r"/international-development|/grant",
    "UNDP Funding Windows Portal":
        r"/funding|/grant|/call",
    "Global Fund to Fight AIDS, TB & Malaria":
        r"/funding|/grant|/call",
    "Gavi, the Vaccine Alliance":
        r"/funding|/grant|/programme",
    "USAID (foreign aid grants/contracts)":
        r"/funding|/grant|/partner",
    # Large foundations with a lot of non-grant content
    "Bill & Melinda Gates Foundation":
        r"/grant|/what-we-do|/program",
    "Ford Foundation":
        r"/work/our-grants|/grant",
    "MacArthur Foundation":
        r"/grants/|/program",
    "Open Society Foundations":
        r"/grants|/fellowship|/program",
    "Rockefeller Foundation":
        r"/grants|/initiative|/program",
    "Howard Hughes Medical Institute (HHMI)":
        r"/programs|/grant|/funding",
    "Carnegie Corporation of New York":
        r"/grants|/program",
    "Wellcome Trust":
        r"/grant-funding|/scheme",
    "Wellcome Data for Science and Health":
        r"/grant-funding|/scheme",
    "Wellcome Africa Research Programmes":
        r"/grant-funding|/scheme",
    "Wellcome Early Career Awards":
        r"/grant-funding|/scheme",
    "Mastercard Foundation":
        r"/programs|/grant|/partner",
    # Fellowship-specific – only follow program/fellowship subpages
    "Fulbright Program – US Scholar":
        r"/program",
    "DAAD – German Academic Exchange Scholarships":
        r"/scholarship|/program|/find-funding",
    "Chevening Scholarships":
        r"/scholarships",
    "Commonwealth Scholarships":
        r"/apply|/scholarships",
    "MacArthur Foundation – Fellowships ('Genius Grant')":
        r"/fellows|/awards",
    "ACLS – Fellowships & Grants":
        r"/programs|/fellowship",
    "Guggenheim Fellowship":
        r"/applicants|/fellowship",
    "Pulitzer Center – Grants":
        r"/grants|/fellowship",
    # European research councils – restrict to funding/programme subpaths
    "DFG – Deutsche Forschungsgemeinschaft (German Research Foundation)":
        r"/funding-opportunities|/programme",
    "Swiss National Science Foundation (SNSF)":
        r"/funding|/grant",
    "ANR – Agence Nationale de la Recherche (France)":
        r"/call|/funding|/programme",
    "NWO – Dutch Research Council (Netherlands)":
        r"/calls|/grant|/funding",
    "Research Council of Norway (Norges Forskningsråd)":
        r"/call|/funding|/programme",
    "Academy of Finland / Research Council of Finland":
        r"/research-funding|/call",
    "NIHR – National Institute for Health & Care Research":
        r"/funding|/programme|/scheme",
    "NIHR Global Health Research":
        r"/funding|/programme|/global",
    # Arts organisations with lots of news/exhibition content
    "Arts Council England – Grants":
        r"/our-open-funds|/grant|/fund",
    "Arts Council of Ireland – Funding":
        r"/Funds|/grant|/award",
    "British Council – Arts Grants":
        r"/arts|/funding|/grant",
    "Creative Scotland – Funding":
        r"/funding|/grant|/award",
    "Pro Helvetia – Swiss Arts Council":
        r"/funding|/grant|/program",
    "European Cultural Foundation – Grants":
        r"/grants|/program|/fund",
    # UK-specific
    "Leverhulme Trust":
        r"/funding|/grant|/award",
    "Nuffield Foundation":
        r"/funding|/grant",
    "Nuffield Foundation – Grants":
        r"/funding|/grant",
    "Cancer Research UK (CRUK)":
        r"/funding-for-researchers|/grant",
    "NHS AI Lab (NHS England)":
        r"/ai-lab|/funding|/program",
    # Health-specific funders
    "Alzheimer's Association – International Research Grants":
        r"/grants|/research",
    "American Cancer Society – Research Grants":
        r"/research|/grant",
    "American Heart Association – Research Funding":
        r"/research-programs|/funding",
    "Cystic Fibrosis Foundation – Research Grants":
        r"/grants|/research",
    "British Heart Foundation":
        r"/apply|/grant|/research",
    "JDRF – Juvenile Diabetes Research Foundation":
        r"/research|/grant|/funding",
}

# ── Main update logic ─────────────────────────────────────────────────────────

def upgrade(dry_run: bool = False) -> None:
    path = DATA_DIR / "grant_funding_portals.json"
    payload = json.loads(path.read_text())
    sources = payload["sources"]

    depth_upgraded = []
    paginate_added = []
    filter_added = []
    playwright_added = []

    for s in sources:
        if s.get("source_type") != "ai_scraper":
            continue

        name = s["name"]
        cfg: dict = dict(s.get("scraper_config") or {})

        # ── 1. Enforce use_playwright=True ────────────────────────────────
        if "use_playwright" not in cfg:
            cfg["use_playwright"] = True
            playwright_added.append(name)

        # ── 2. Upgrade crawl_depth ────────────────────────────────────────
        current_depth = cfg.get("crawl_depth", 0)
        if current_depth == 0 and name not in KEEP_DEPTH_0:
            cfg["crawl_depth"] = 1
            depth_upgraded.append(name)

        # ── 3. Add pagination ─────────────────────────────────────────────
        if not cfg.get("paginate") and name not in KEEP_DEPTH_0:
            cfg["paginate"] = True
            if name in MAX_PAGES_10:
                cfg["max_pages"] = 10
            elif name in MAX_PAGES_3:
                cfg["max_pages"] = 3
            else:
                cfg["max_pages"] = 5  # safe default for unknown-size sources
            paginate_added.append(f"{name} (max_pages={cfg['max_pages']})")

        # ── 4. Add link_filter ────────────────────────────────────────────
        if name in LINK_FILTERS and "link_filter" not in cfg:
            cfg["link_filter"] = LINK_FILTERS[name]
            filter_added.append(name)

        s["scraper_config"] = cfg

    # ── Report ────────────────────────────────────────────────────────────
    print(f"\n{'[DRY RUN] ' if dry_run else ''}Changes to apply:\n")

    print(f"  crawl_depth 0→1 ({len(depth_upgraded)} sources):")
    for n in depth_upgraded:
        print(f"    + {n}")

    print(f"\n  pagination enabled ({len(paginate_added)} sources):")
    for n in paginate_added:
        print(f"    + {n}")

    print(f"\n  link_filter added ({len(filter_added)} sources):")
    for n in filter_added:
        print(f"    + {n}")

    print(f"\n  use_playwright enforced ({len(playwright_added)} sources):")
    for n in playwright_added:
        print(f"    + {n}")

    total = len(depth_upgraded) + len(paginate_added) + len(filter_added) + len(playwright_added)
    print(f"\nTotal changes: {total} across {len(sources)} ai_scraper sources.")

    if dry_run:
        print("\nDry run — no files written. Re-run without --dry-run to apply.")
        return

    payload["version"] = payload.get("version", 5) + 1
    payload["notes"] = (
        payload.get("notes", "") +
        f" v{payload['version']}: bulk scraper_config upgrade — "
        f"depth=0→1 for {len(depth_upgraded)} sources, "
        f"pagination added to {len(paginate_added)} sources, "
        f"link_filter added to {len(filter_added)} sources, "
        f"use_playwright enforced on {len(playwright_added)} sources."
    )

    path.write_text(json.dumps(payload, indent=2))
    print(f"\nWrote {path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    upgrade(dry_run=args.dry_run)

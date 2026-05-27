#!/usr/bin/env python3
"""
Pipeline debug / smoke-test script.

Tests every scraper type, both scorers, and the beat schedule.
Run from the repo root (or inside the Docker container):

    python backend/scripts/test_pipelines.py
    python backend/scripts/test_pipelines.py --llm
    python backend/scripts/test_pipelines.py --source-type eu_funding
    python backend/scripts/test_pipelines.py --source-name "Grants.gov"
    python backend/scripts/test_pipelines.py --list-sources
    python backend/scripts/test_pipelines.py --skip-live   # scorers + DB only, no HTTP fetches

Requires the backend Python env (pip install -r requirements.txt).
Does NOT require a running FastAPI server.
"""
import argparse
import os
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ── path setup so we can import app.* ─────────────────────────────────────────
_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

# ── Load .env if present ───────────────────────────────────────────────────────
_ENV = _BACKEND.parent / ".env"
if _ENV.exists():
    from dotenv import load_dotenv
    load_dotenv(_ENV, override=False)

# ── Colour helpers ─────────────────────────────────────────────────────────────
RESET = "\033[0m"
GREEN = "\033[92m"
RED   = "\033[91m"
YELLOW = "\033[93m"
CYAN  = "\033[96m"
BOLD  = "\033[1m"

def ok(msg: str) -> str:   return f"{GREEN}✓{RESET}  {msg}"
def fail(msg: str) -> str: return f"{RED}✗{RESET}  {msg}"
def warn(msg: str) -> str: return f"{YELLOW}!{RESET}  {msg}"
def info(msg: str) -> str: return f"{CYAN}·{RESET}  {msg}"
def hdr(msg: str) -> str:  return f"\n{BOLD}{msg}{RESET}"

# ── Result accumulator ─────────────────────────────────────────────────────────
results: list[dict] = []

def record(section: str, name: str, passed: bool, detail: str = "") -> None:
    results.append({"section": section, "name": name, "passed": passed, "detail": detail})
    symbol = ok(name) if passed else fail(name)
    if detail:
        print(f"  {symbol}  — {detail}")
    else:
        print(f"  {symbol}")


# ══════════════════════════════════════════════════════════════════════════════
# 1. DATABASE HEALTH
# ══════════════════════════════════════════════════════════════════════════════
def check_db() -> dict[str, Any]:
    print(hdr("1 · Database Health"))
    try:
        from sqlalchemy import create_engine, text
        from app.config import get_settings
        settings = get_settings()
        engine = create_engine(settings.database_url)
        with engine.connect() as conn:
            # Basic connectivity
            conn.execute(text("SELECT 1"))
            record("db", "PostgreSQL connection", True)

            # pgvector extension
            try:
                conn.execute(text("SELECT extname FROM pg_extension WHERE extname='vector'"))
                record("db", "pgvector extension", True)
            except Exception:
                record("db", "pgvector extension", False, "extension not loaded")

            # Row counts
            for table, label in [
                ("sources", "Sources"),
                ("opportunities", "Opportunities"),
                ("institution_opportunities", "InstitutionOpportunities"),
                ("source_runs", "SourceRuns"),
            ]:
                try:
                    row = conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()
                    record("db", f"{label} table readable", True, f"{row:,} rows")
                except Exception as e:
                    record("db", f"{label} table readable", False, str(e))

            # Active vs disabled sources
            try:
                active = conn.execute(
                    text("SELECT COUNT(*) FROM sources WHERE status='active'")
                ).scalar()
                total = conn.execute(text("SELECT COUNT(*) FROM sources")).scalar()
                record("db", "Active sources", True, f"{active} active / {total} total")
            except Exception as e:
                record("db", "Active sources", False, str(e))

            # Recent source run errors (last 24h)
            try:
                errors = conn.execute(text(
                    "SELECT COUNT(*) FROM source_runs "
                    "WHERE status='failed' AND started_at > NOW() - INTERVAL '24 hours'"
                )).scalar()
                passed = errors == 0
                record("db", "Source run errors (last 24h)", passed,
                       f"{errors} failed runs" if errors else "none")
            except Exception as e:
                record("db", "Source run errors (last 24h)", False, str(e))

        return {"engine": engine}
    except Exception as e:
        record("db", "PostgreSQL connection", False, str(e))
        print(f"  {warn('DB unavailable — skipping DB-dependent checks')}")
        return {}


# ══════════════════════════════════════════════════════════════════════════════
# 2. SOURCE INVENTORY
# ══════════════════════════════════════════════════════════════════════════════
def check_source_inventory(engine=None) -> list[dict]:
    print(hdr("2 · Source Inventory"))
    sources_by_type: dict[str, int] = {}
    all_sources: list[dict] = []

    if not engine:
        print(f"  {warn('Skipped — no DB connection')}")
        return []

    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            rows = conn.execute(text(
                "SELECT id, name, source_type, status, url, is_high_priority, "
                "last_checked, last_successful_run, opportunities_discovered "
                "FROM sources ORDER BY source_type, name"
            )).mappings().all()

            for r in rows:
                all_sources.append(dict(r))
                sources_by_type[r["source_type"]] = sources_by_type.get(r["source_type"], 0) + 1

            print(f"  {info('Sources by type:')}")
            for stype, count in sorted(sources_by_type.items()):
                print(f"      {stype:<25} {count}")

            # High priority sources
            hp = [s for s in all_sources if s["is_high_priority"] and s["status"] == "active"]
            print(f"\n  {info(f'{len(hp)} high-priority active sources:')}")
            for s in hp:
                last = s["last_checked"].strftime("%Y-%m-%d %H:%M") if s["last_checked"] else "never"
                print(f"      {s['name'][:45]:<46} last: {last}")

            # Stale sources (active, checked before, but >10 days ago)
            from datetime import timedelta
            cutoff = datetime.now(timezone.utc) - timedelta(days=10)
            stale = [
                s for s in all_sources
                if s["status"] == "active"
                and s["last_checked"]
                and s["last_checked"].replace(tzinfo=timezone.utc) < cutoff
            ]
            if stale:
                print(f"\n  {warn(f'{len(stale)} stale active sources (checked >10 days ago):')}")
                for s in stale[:10]:
                    print(f"      {s['name'][:50]}")

            record("inventory", "Source inventory", True,
                   f"{len(all_sources)} total, {len(hp)} high-priority")
    except Exception as e:
        record("inventory", "Source inventory", False, str(e))

    return all_sources


# ══════════════════════════════════════════════════════════════════════════════
# 3. SCRAPER SMOKE TESTS
# ══════════════════════════════════════════════════════════════════════════════
def _make_mock_source(name: str, url: str, source_type: str, cfg: dict | None = None):
    """Build a minimal Source-like object without touching the DB."""
    class _S:
        pass
    s = _S()
    s.id = "test"
    s.name = name
    s.url = url
    s.source_type = source_type
    s.scraper_config = cfg or {}
    s.api_endpoint = None
    return s


def run_scraper_smoke(
    source_type: str,
    name: str,
    url: str,
    cfg: dict | None = None,
    timeout: int = 60,
) -> tuple[bool, str]:
    """Run a single scraper and return (passed, detail)."""
    from app.scrapers import get_scraper
    mock = _make_mock_source(name, url, source_type, cfg)
    t0 = time.time()
    try:
        scraper = get_scraper(mock)
        items = scraper.fetch()
        elapsed = round(time.time() - t0, 1)
        count = len(items) if items else 0
        if count > 0:
            return True, f"{count} items in {elapsed}s"
        else:
            return False, f"0 items returned in {elapsed}s (page may be empty or scraper needs API key)"
    except Exception as e:
        elapsed = round(time.time() - t0, 1)
        return False, f"{elapsed}s — {type(e).__name__}: {str(e)[:120]}"


# Representative test target for each scraper type
_SMOKE_TARGETS = [
    {
        "section": "scraper",
        "source_type": "grants_gov",
        "name": "Grants.gov",
        "url": "https://simpler.grants.gov",
        "cfg": {},
    },
    {
        "section": "scraper",
        "source_type": "nih_reporter",
        "name": "NIH RePORTER",
        "url": "https://reporter.nih.gov",
        "cfg": {},
    },
    {
        "section": "scraper",
        "source_type": "nsf",
        "name": "NSF Awards",
        "url": "https://www.nsf.gov/funding/",
        "cfg": {},
    },
    {
        "section": "scraper",
        "source_type": "sbir",
        "name": "SBIR.gov",
        "url": "https://www.sbir.gov",
        "cfg": {},
    },
    {
        "section": "scraper",
        "source_type": "eu_funding",
        "name": "EU Funding & Tenders Portal",
        "url": "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-search",
        "cfg": {},
    },
    {
        "section": "scraper",
        "source_type": "ukri_gtr",
        "name": "UKRI Gateway to Research",
        "url": "https://gtr.ukri.org",
        "cfg": {},
    },
    {
        "section": "scraper",
        "source_type": "three60giving",
        "name": "360Giving GrantNav",
        "url": "https://grantnav.threesixtygiving.org",
        "cfg": {},
    },
    {
        "section": "scraper",
        "source_type": "openalex",
        "name": "OpenAlex",
        "url": "https://openalex.org",
        "cfg": {},
    },
    {
        "section": "scraper",
        "source_type": "ai_scraper",
        "name": "Wellcome Trust (ai_scraper)",
        "url": "https://wellcome.org/grant-funding/schemes",
        "cfg": {"use_playwright": True, "crawl_depth": 0},
    },
]


def check_scrapers(
    filter_type: str | None = None,
    filter_name: str | None = None,
    skip_live: bool = False,
) -> None:
    print(hdr("3 · Scraper Smoke Tests"))
    if skip_live:
        print(f"  {warn('Skipped — --skip-live flag set')}")
        return

    targets = _SMOKE_TARGETS
    if filter_type:
        targets = [t for t in targets if t["source_type"] == filter_type]
    if filter_name:
        targets = [t for t in targets if filter_name.lower() in t["name"].lower()]

    if not targets:
        print(f"  {warn('No matching scraper targets')}")
        return

    for t in targets:
        print(f"  {info(f'Testing {t[\"name\"]} ({t[\"source_type\"]}) ...')}", end="", flush=True)
        passed, detail = run_scraper_smoke(
            t["source_type"], t["name"], t["url"], t.get("cfg")
        )
        record(t["section"], t["name"], passed, detail)


# ══════════════════════════════════════════════════════════════════════════════
# 4. EU / HORIZON FOCUSED TEST
# ══════════════════════════════════════════════════════════════════════════════
def check_eu_horizon(skip_live: bool = False) -> None:
    print(hdr("4 · EU / Horizon Grants Focused Test"))
    if skip_live:
        print(f"  {warn('Skipped — --skip-live flag set')}")
        return

    eu_targets = [
        {
            "name": "EU Funding & Tenders Portal",
            "url": "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-search",
            "cfg": {},
        },
        {
            "name": "Horizon Europe / CORDIS (open calls)",
            "url": "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-search",
            "cfg": {},
        },
        {
            "name": "European Innovation Council (EIC)",
            "url": "https://eic.ec.europa.eu/eic-funding-opportunities_en",
            "cfg": {},
        },
        {
            "name": "ERC Calls for Proposals",
            "url": "https://erc.europa.eu/funding/calls-for-proposals",
            "cfg": {"use_playwright": True},
        },
    ]

    for t in eu_targets:
        source_type = "eu_funding" if "cfg" in t and "use_playwright" not in t["cfg"] else "ai_scraper"
        # ERC uses ai_scraper; the others use eu_funding
        if "erc.europa.eu" in t["url"]:
            source_type = "ai_scraper"

        print(f"  {info(f'Testing {t[\"name\"]} ...')}", end="", flush=True)
        passed, detail = run_scraper_smoke(source_type, t["name"], t["url"], t.get("cfg"))
        record("eu_horizon", t["name"], passed, detail)


# ══════════════════════════════════════════════════════════════════════════════
# 5. PLAYWRIGHT AVAILABILITY CHECK
# ══════════════════════════════════════════════════════════════════════════════
def check_playwright() -> None:
    print(hdr("5 · Playwright Browser Check"))
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto("https://example.com", timeout=15000)
            title = page.title()
            browser.close()
        record("playwright", "Chromium launch + page load", True, f'page title: "{title}"')
    except Exception as e:
        short = str(e).split("\n")[0][:120]
        record("playwright", "Chromium launch + page load", False, short)
        print(f"    {warn('Hint: rebuild the Docker image — playwright install chromium --with-deps')}")


# ══════════════════════════════════════════════════════════════════════════════
# 6. KEYWORD SCORER TEST
# ══════════════════════════════════════════════════════════════════════════════
def check_keyword_scorer() -> None:
    print(hdr("6 · Keyword Scorer"))
    try:
        from app.services.keyword_scorer import keyword_score_opportunity
        result = keyword_score_opportunity(
            title="AI for Global Health: Machine Learning in LMIC Settings",
            description=(
                "This grant supports research on AI-driven diagnostics for tuberculosis "
                "and maternal health in sub-Saharan Africa and South Asia."
            ),
            funder="Wellcome Trust",
            eligibility="Academic institutions eligible",
            geography=["sub-Saharan Africa", "South Asia"],
        )
        score = result.get("fit_score", 0)
        priority = result.get("priority", "")
        matched = result.get("matched_themes", [])
        passed = score > 0 and priority in {"high", "medium", "low"}
        record(
            "scorer", "keyword_score_opportunity",
            passed,
            f"score={score}, priority={priority}, matched={matched[:5]}",
        )
    except Exception as e:
        record("scorer", "keyword_score_opportunity", False, traceback.format_exc(limit=3))


# ══════════════════════════════════════════════════════════════════════════════
# 7. LLM SCORER TEST (optional)
# ══════════════════════════════════════════════════════════════════════════════
def check_llm_scorer() -> None:
    print(hdr("7 · LLM Fit Scorer (fit_scorer.py)"))
    import asyncio
    try:
        from app.ai.agents.fit_scorer import score_opportunity
        result = asyncio.run(score_opportunity(
            title="AI for Global Health: ML Diagnostics in LMICs",
            description=(
                "Funding for development and validation of AI-powered TB diagnostics "
                "using point-of-care ultrasound in sub-Saharan Africa."
            ),
            funder="Wellcome Trust",
            eligibility="Academic institutions eligible. Principal investigator must be based at a research-intensive university.",
            geography="sub-Saharan Africa",
            award_amount="$500,000–$1,000,000",
            deadline="2026-12-31",
        ))
        score = result.get("fit_score", -1)
        priority = result.get("priority", "")
        rationale = (result.get("rationale") or "")[:80]
        error = result.get("error")

        if error:
            record("scorer", "fit_scorer LLM", False, f"LLM error: {error[:120]}")
        else:
            passed = 0 <= score <= 100 and priority in {
                "high_priority", "worth_reviewing", "watchlist", "low_fit"
            }
            record("scorer", "fit_scorer LLM", passed,
                   f"score={score}, priority={priority} — {rationale}")
    except Exception as e:
        record("scorer", "fit_scorer LLM", False, traceback.format_exc(limit=3))


# ══════════════════════════════════════════════════════════════════════════════
# 8. BEAT SCHEDULE SUMMARY
# ══════════════════════════════════════════════════════════════════════════════
def check_beat_schedule() -> None:
    print(hdr("8 · Celery Beat Schedule"))
    try:
        from app.workers.celery_app import celery_app
        schedule = celery_app.conf.beat_schedule or {}
        if not schedule:
            print(f"  {warn('No beat schedule found')}")
            return
        print(f"  {'Task':<55} {'Schedule'}")
        print(f"  {'─'*55} {'─'*30}")
        for key, entry in sorted(schedule.items()):
            task = entry.get("task", "").replace("app.workers.", "")
            sched = str(entry.get("schedule", ""))
            print(f"  {task:<55} {sched}")
        record("beat", "Beat schedule loaded", True, f"{len(schedule)} scheduled tasks")
    except Exception as e:
        record("beat", "Beat schedule loaded", False, str(e))


# ══════════════════════════════════════════════════════════════════════════════
# 9. RECENT SOURCE RUN SUMMARY
# ══════════════════════════════════════════════════════════════════════════════
def check_recent_runs(engine=None) -> None:
    print(hdr("9 · Recent Source Run Summary (last 50)"))
    if not engine:
        print(f"  {warn('Skipped — no DB connection')}")
        return
    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            rows = conn.execute(text("""
                SELECT
                    sr.status,
                    sr.started_at,
                    sr.records_found,
                    sr.new_opportunities,
                    sr.errors,
                    s.name AS source_name,
                    s.source_type
                FROM source_runs sr
                LEFT JOIN sources s ON sr.source_id = s.id
                ORDER BY sr.started_at DESC
                LIMIT 50
            """)).mappings().all()

            if not rows:
                print(f"  {warn('No source runs found in DB')}")
                return

            success = [r for r in rows if r["status"] == "success"]
            failed  = [r for r in rows if r["status"] == "failed"]
            running = [r for r in rows if r["status"] == "running"]

            print(f"  Last {len(rows)} runs:  "
                  f"{GREEN}{len(success)} success{RESET}  "
                  f"{RED}{len(failed)} failed{RESET}  "
                  f"{YELLOW}{len(running)} running{RESET}")

            if failed:
                print(f"\n  {BOLD}Failed runs:{RESET}")
                for r in failed[:10]:
                    ts = r["started_at"].strftime("%m-%d %H:%M") if r["started_at"] else "?"
                    errs = (r["errors"] or [])
                    short_err = errs[0][:80] if errs else "no error detail"
                    print(f"    [{ts}] {(r['source_name'] or '?')[:40]:<41} {short_err}")

            print(f"\n  {BOLD}Recent successful runs with records found:{RESET}")
            productive = [r for r in success if (r["records_found"] or 0) > 0][:10]
            if productive:
                for r in productive:
                    ts = r["started_at"].strftime("%m-%d %H:%M") if r["started_at"] else "?"
                    print(f"    [{ts}] {(r['source_name'] or '?')[:35]:<36} "
                          f"found={r['records_found']:>4}  new={r['new_opportunities'] or 0:>3}")
            else:
                print(f"    {warn('No successful runs returned any records')}")

            record("runs", "Recent runs readable", True,
                   f"{len(success)}/{len(rows)} succeeded, {len(failed)} failed")
    except Exception as e:
        record("runs", "Recent runs readable", False, str(e))


# ══════════════════════════════════════════════════════════════════════════════
# 10. LIST SOURCES (helper mode)
# ══════════════════════════════════════════════════════════════════════════════
def list_all_sources(engine=None) -> None:
    print(hdr("All Sources"))
    if not engine:
        print(f"  {warn('No DB connection — showing catalog JSON instead')}")
        import json
        catalog = _BACKEND / "data" / "grant_funding_portals.json"
        if catalog.exists():
            with open(catalog) as f:
                sources = json.load(f)
            sources = sources if isinstance(sources, list) else sources.get("sources", [])
            print(f"  {'Name':<50} {'Type':<20} {'Priority'}")
            print(f"  {'─'*50} {'─'*20} {'─'*8}")
            for s in sources:
                hp = "HIGH" if s.get("is_high_priority") else ""
                print(f"  {s['name'][:49]:<50} {s.get('source_type',''):<20} {hp}")
        return

    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            rows = conn.execute(text(
                "SELECT name, source_type, status, is_high_priority, "
                "last_checked, opportunities_discovered FROM sources ORDER BY name"
            )).mappings().all()
            print(f"  {'Name':<50} {'Type':<20} {'Status':<14} {'Discovered':>10}  {'Last Checked'}")
            print(f"  {'─'*50} {'─'*20} {'─'*14} {'─'*10}  {'─'*16}")
            for r in rows:
                lc = r["last_checked"].strftime("%Y-%m-%d %H:%M") if r["last_checked"] else "never"
                hp = " ★" if r["is_high_priority"] else ""
                print(f"  {(r['name']+hp)[:49]:<50} {r['source_type']:<20} {r['status']:<14} "
                      f"{(r['opportunities_discovered'] or 0):>10}  {lc}")
    except Exception as e:
        print(f"  {fail(str(e))}")


# ══════════════════════════════════════════════════════════════════════════════
# SUMMARY
# ══════════════════════════════════════════════════════════════════════════════
def print_summary() -> int:
    print(hdr("Summary"))
    passed = [r for r in results if r["passed"]]
    failed = [r for r in results if not r["passed"]]

    # Group by section
    sections: dict[str, list[dict]] = {}
    for r in results:
        sections.setdefault(r["section"], []).append(r)

    print(f"  {'Section':<20} {'Pass':>5} {'Fail':>5}")
    print(f"  {'─'*20} {'─'*5} {'─'*5}")
    for sec, items in sections.items():
        p = sum(1 for i in items if i["passed"])
        f = sum(1 for i in items if not i["passed"])
        colour = GREEN if f == 0 else RED
        print(f"  {sec:<20} {colour}{p:>5}{RESET} {RED if f else ''}{f:>5}{RESET}")

    total = len(results)
    print(f"\n  Total: {GREEN}{len(passed)}/{total} passed{RESET}  "
          f"{RED}{len(failed)} failed{RESET}")

    if failed:
        print(f"\n  {BOLD}Failing checks:{RESET}")
        for r in failed:
            print(f"    {fail(r['name'])}  {r['detail']}")

    return 1 if failed else 0


# ══════════════════════════════════════════════════════════════════════════════
# ENTRY POINT
# ══════════════════════════════════════════════════════════════════════════════
def main() -> int:
    parser = argparse.ArgumentParser(
        description="Smoke-test all LiGHT Grant Engine funding pipelines."
    )
    parser.add_argument("--llm", action="store_true",
                        help="Also test the LLM fit_scorer (costs tokens)")
    parser.add_argument("--skip-live", action="store_true",
                        help="Skip live HTTP scraper tests (DB + scorers only)")
    parser.add_argument("--source-type", metavar="TYPE",
                        help="Only test scrapers of this type, e.g. eu_funding")
    parser.add_argument("--source-name", metavar="NAME",
                        help="Only test scrapers whose name contains this string")
    parser.add_argument("--list-sources", action="store_true",
                        help="Print all sources and exit")
    args = parser.parse_args()

    print(f"\n{BOLD}{'═'*60}{RESET}")
    print(f"{BOLD}  LiGHT Grant Engine — Pipeline Test{RESET}")
    print(f"{BOLD}  {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}{RESET}")
    print(f"{BOLD}{'═'*60}{RESET}")

    db_info = check_db()
    engine = db_info.get("engine")

    if args.list_sources:
        list_all_sources(engine)
        return 0

    check_source_inventory(engine)
    check_playwright()
    check_scrapers(
        filter_type=args.source_type,
        filter_name=args.source_name,
        skip_live=args.skip_live,
    )

    if not (args.source_type or args.source_name):
        check_eu_horizon(skip_live=args.skip_live)

    check_keyword_scorer()

    if args.llm:
        check_llm_scorer()
    else:
        print(hdr("7 · LLM Fit Scorer"))
        print(f"  {info('Skipped — pass --llm to test (costs tokens)')}")

    check_beat_schedule()
    check_recent_runs(engine)

    return print_summary()


if __name__ == "__main__":
    sys.exit(main())

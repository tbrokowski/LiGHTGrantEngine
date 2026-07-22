#!/usr/bin/env python3
"""
Source audit harness — stress-tests every source in grant_funding_portals.json
and explains WHY a source yields zero opportunities. No database required.

Tiers:
  1 (default, free)  — HTTP probe of every source URL with real browser headers.
                       Classifies: ok | moved | http_403 | http_404 | http_other |
                       dns_fail | timeout | js_required | zero_anchors
  2 (default, free)  — For dedicated API scraper types, instantiates the real
                       scraper class and calls .fetch(), counting results.
  3 (--llm N, cheap) — Runs the full AIScraper (gpt-4o-mini) on N sampled
                       ai_scraper sources, prioritising Tier-1 failures, to
                       measure real extraction yield.

Repairs (--fix): applies SAFE auto-fixes to the seed JSON:
  - same-host 301/302 moves → url rewritten to the redirect target
  - persistent dns_fail / http_404 / timeout → status: paused (+ audit note)
  - js_required on AI/HTML scraper types → use_playwright: true
(403s need no seed change — the shared fetch layer now auto-escalates.)

Usage (from backend/):
    python scripts/audit_sources.py                 # tiers 1+2, report only
    python scripts/audit_sources.py --fix           # apply safe repairs
    python scripts/audit_sources.py --llm 10        # also LLM-sample 10 sources
    python scripts/audit_sources.py --only "NEFA"   # substring-filter sources
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import sys
import time
from datetime import date
from pathlib import Path
from types import SimpleNamespace

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

_ENV = _BACKEND.parent / ".env"
if _ENV.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(_ENV, override=False)
    except ImportError:
        pass

SEED_PATH = _BACKEND / "data" / "grant_funding_portals.json"
REPORT_PATH = _BACKEND / "data" / "source_audit_report.json"

# Dedicated API scraper types exercised in Tier 2
API_TYPES = {
    "grants_gov", "nih_reporter", "nsf", "sbir", "eu_funding",
    "ukri_gtr", "iati", "three60giving", "openalex", "propublica", "rss", "api",
}
AI_TYPES = {"ai_scraper", "scraper", "html_static", "html_dynamic"}

# link_filter applied to homepage-repointed sources so depth-1 crawling only
# follows funding-related links, not site navigation.
_FUNDING_LINK_FILTER = (
    r"(grant|fund|scheme|fellowship|award|opportunit|scholarship|apply|"
    r"call|prize|bursar|residenc|conference|workshop)"
)


# ── Tier 1: HTTP probe ─────────────────────────────────────────────────────────

def classify_probe(
    *, error: str | None, status_code: int | None,
    redirected: bool, same_host: bool, anchor_count: int, text_chars: int,
) -> str:
    """Pure classification of a probe outcome (unit-testable)."""
    if error:
        low = error.lower()
        if "getaddrinfo" in low or "nodename" in low or "name or service" in low or "no address" in low:
            return "dns_fail"
        if "timeout" in low or "timed out" in low:
            return "timeout"
        return "conn_error"
    if status_code == 403:
        return "http_403"
    if status_code == 404 or status_code == 410:
        return "http_404"
    if status_code is not None and status_code >= 400:
        return "http_other"
    if redirected and not same_host:
        return "moved"
    if anchor_count == 0:
        return "zero_anchors"
    if anchor_count < 15 or text_chars < 2000:
        return "js_required"
    return "ok"


def _hostname(url: str) -> str:
    from urllib.parse import urlparse
    host = (urlparse(url).hostname or "").lower()
    return host.removeprefix("www.")


def probe_source(src: dict, timeout: int = 20) -> dict:
    from app.scrapers.fetch import _fetch_httpx

    url = src.get("url") or ""
    out = {
        "name": src.get("name"), "url": url,
        "source_type": src.get("source_type"), "status": src.get("status"),
    }
    if not url:
        out["class"] = "no_url"
        return out

    r = _fetch_httpx(url, timeout)
    same_host = _hostname(r.final_url or url) == _hostname(url)
    out.update({
        "http_status": r.status_code,
        "final_url": r.final_url,
        "anchor_count": r.anchor_count,
        "text_chars": r.text_chars,
        "error": r.error,
        "class": classify_probe(
            error=r.error, status_code=r.status_code, redirected=r.redirected,
            same_host=same_host, anchor_count=r.anchor_count, text_chars=r.text_chars,
        ),
    })
    return out


def run_tier1(sources: list[dict], workers: int = 16) -> list[dict]:
    results: list[dict] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(probe_source, s): s for s in sources}
        done = 0
        for fut in concurrent.futures.as_completed(futures):
            results.append(fut.result())
            done += 1
            if done % 25 == 0:
                print(f"  … probed {done}/{len(sources)}", file=sys.stderr)
    return results


# ── Tier 2: real API scraper fetch ─────────────────────────────────────────────

def run_tier2(sources: list[dict]) -> list[dict]:
    from app.scrapers import get_scraper

    results = []
    for src in sources:
        if src.get("source_type") not in API_TYPES:
            continue
        fake = SimpleNamespace(
            url=src.get("url"), name=src.get("name"),
            source_type=src.get("source_type"),
            scraper_config=src.get("scraper_config") or {},
            api_endpoint=src.get("api_endpoint"),
        )
        entry = {"name": src.get("name"), "source_type": src.get("source_type")}
        start = time.time()
        try:
            items = get_scraper(fake).fetch()
            entry.update({"results": len(items), "error": None})
        except Exception as exc:
            entry.update({"results": 0, "error": f"{type(exc).__name__}: {exc}"})
        entry["seconds"] = round(time.time() - start, 1)
        print(f"  [tier2] {entry['name']}: {entry['results']} results "
              f"({entry['seconds']}s){' ERROR: ' + str(entry['error']) if entry['error'] else ''}",
              file=sys.stderr)
        results.append(entry)
    return results


# ── Tier 3: LLM extraction sample ──────────────────────────────────────────────

def run_tier3(sources: list[dict], tier1_by_name: dict[str, dict], n: int) -> list[dict]:
    from app.scrapers.ai_scraper import AIScraper

    ai_sources = [s for s in sources if s.get("source_type") in ("ai_scraper", "scraper")
                  and s.get("status") == "active"]
    # Prioritise sources tier 1 flagged as suspicious, then fill with ok ones
    flagged = [s for s in ai_sources
               if tier1_by_name.get(s["name"], {}).get("class") not in ("ok", None)]
    healthy = [s for s in ai_sources
               if tier1_by_name.get(s["name"], {}).get("class") == "ok"]
    sample = (flagged + healthy)[:n]

    results = []
    for src in sample:
        fake = SimpleNamespace(
            url=src.get("url"), name=src.get("name"),
            source_type=src.get("source_type"),
            scraper_config=src.get("scraper_config") or {},
        )
        entry = {
            "name": src.get("name"),
            "tier1_class": tier1_by_name.get(src["name"], {}).get("class"),
        }
        start = time.time()
        try:
            items = AIScraper(fake).fetch()
            urls = {i.get("url") for i in items if i.get("url")}
            entry.update({"results": len(items), "distinct_urls": len(urls), "error": None})
        except Exception as exc:
            entry.update({"results": 0, "distinct_urls": 0, "error": f"{type(exc).__name__}: {exc}"})
        entry["seconds"] = round(time.time() - start, 1)
        print(f"  [tier3] {entry['name']}: {entry.get('results')} extracted "
              f"({entry['seconds']}s){' ERROR: ' + str(entry['error']) if entry['error'] else ''}",
              file=sys.stderr)
        results.append(entry)
    return results


# ── Repairs ───────────────────────────────────────────────────────────────────

def _root_alive(url: str, timeout: int = 15) -> bool:
    """True when the site's homepage responds < 400."""
    from urllib.parse import urlparse
    from app.scrapers.fetch import _fetch_httpx

    parsed = urlparse(url)
    if not parsed.netloc:
        return False
    root = f"{parsed.scheme or 'https'}://{parsed.netloc}/"
    r = _fetch_httpx(root, timeout)
    return r.error is None and (r.status_code or 999) < 400


def apply_fixes(seed: dict, tier1: list[dict]) -> list[str]:
    """Apply safe repairs to the seed dict in place; return change log."""
    from urllib.parse import urlparse

    changes: list[str] = []
    by_name = {r["name"]: r for r in tier1}
    today = date.today().isoformat()

    for src in seed.get("sources", []):
        probe = by_name.get(src.get("name"))
        if not probe:
            continue
        cls = probe.get("class")

        if cls == "moved" and probe.get("final_url"):
            # Cross-host redirect — record for review instead of silently
            # pointing the scraper at a new domain.
            note = f"[audit {today}] redirects to {probe['final_url']} — verify new URL"
            src["notes"] = f"{(src.get('notes') or '')} {note}".strip()
            changes.append(f"NOTE  {src['name']}: cross-host redirect → flagged for review")
            continue

        if cls in ("http_404", "http_other") and src.get("status") == "active":
            # Dead listing path but the site may be alive: repoint at the site
            # root — the AI scraper's depth crawl + sitemap fallback can find
            # the opportunities section from there. Pause only if the whole
            # host is dead.
            url = src.get("url") or ""
            if _root_alive(url):
                parsed = urlparse(url)
                root = f"{parsed.scheme or 'https'}://{parsed.netloc}/"
                note = f"[audit {today}] listing path {cls}; repointed {url} → site root"
                src["url"] = root
                cfg = src.get("scraper_config") or {}
                cfg.setdefault("crawl_depth", 1)
                # From a homepage, depth-1 crawl would otherwise follow nav junk
                # (about/news/donate). Constrain it to funding-related links so
                # the LLM only sees plausible opportunity pages.
                cfg.setdefault("link_filter", _FUNDING_LINK_FILTER)
                src["scraper_config"] = cfg
                src["notes"] = f"{(src.get('notes') or '')} {note}".strip()
                changes.append(f"ROOT  {src['name']}: {cls} → repointed to {root}")
            else:
                src["status"] = "paused"
                note = f"[audit {today}] auto-paused: {cls} and site root dead"
                src["notes"] = f"{(src.get('notes') or '')} {note}".strip()
                changes.append(f"PAUSE {src['name']}: {cls} (root dead)")
            continue

        if cls in ("dns_fail", "conn_error") and src.get("status") == "active":
            src["status"] = "paused"
            note = f"[audit {today}] auto-paused: {cls}"
            src["notes"] = f"{(src.get('notes') or '')} {note}".strip()
            changes.append(f"PAUSE {src['name']}: {cls}")
            continue

        if cls == "timeout":
            # Possibly transient — flag, don't pause.
            note = f"[audit {today}] timeout during probe"
            if note not in (src.get("notes") or ""):
                src["notes"] = f"{(src.get('notes') or '')} {note}".strip()
                changes.append(f"NOTE  {src['name']}: timeout flagged")
            continue

        if cls == "js_required" and src.get("source_type") in AI_TYPES:
            cfg = src.get("scraper_config") or {}
            if not cfg.get("use_playwright"):
                cfg["use_playwright"] = True
                src["scraper_config"] = cfg
                changes.append(f"JS    {src['name']}: use_playwright=true")

        # http_403 needs no seed change: the shared fetch layer now sends
        # browser headers and auto-escalates to Playwright.

    return changes


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--fix", action="store_true", help="apply safe repairs to seed JSON")
    ap.add_argument("--llm", type=int, metavar="N", default=0, help="tier-3 LLM sample size")
    ap.add_argument("--only", metavar="SUBSTR", help="filter sources by name substring")
    ap.add_argument("--skip-tier2", action="store_true")
    args = ap.parse_args()

    seed = json.loads(SEED_PATH.read_text())
    sources = seed.get("sources", [])
    if args.only:
        needle = args.only.lower()
        sources = [s for s in sources if needle in (s.get("name") or "").lower()]
    active = [s for s in sources if s.get("status") == "active"]

    print(f"Auditing {len(active)} active sources (of {len(sources)} selected)…", file=sys.stderr)
    tier1 = run_tier1(active)
    tier1_by_name = {r["name"]: r for r in tier1}

    counts: dict[str, int] = {}
    for r in tier1:
        counts[r["class"]] = counts.get(r["class"], 0) + 1

    tier2 = [] if args.skip_tier2 else run_tier2(active)
    tier3 = run_tier3(active, tier1_by_name, args.llm) if args.llm else []

    report = {
        "audited_at": date.today().isoformat(),
        "total_active": len(active),
        "tier1_counts": dict(sorted(counts.items(), key=lambda kv: -kv[1])),
        "tier1": sorted(tier1, key=lambda r: r["class"]),
        "tier2": tier2,
        "tier3": tier3,
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2))

    print("\n══ Tier 1 classification ══")
    for cls, n in report["tier1_counts"].items():
        print(f"  {cls:<14} {n}")
    bad = [r for r in tier1 if r["class"] not in ("ok",)]
    print(f"\n  {len(bad)} sources need attention; full detail → {REPORT_PATH}")

    if tier2:
        broken = [t for t in tier2 if t["error"] or t["results"] == 0]
        print(f"\n══ Tier 2 (API scrapers): {len(tier2)} run, {len(broken)} returned 0/error ══")
        for t in broken:
            print(f"  {t['name']}: {t['error'] or '0 results'}")

    if tier3:
        print(f"\n══ Tier 3 (LLM extraction sample) ══")
        for t in tier3:
            print(f"  {t['name']} [{t['tier1_class']}]: {t.get('results')} extracted"
                  f"{' — ' + str(t['error']) if t.get('error') else ''}")

    if args.fix:
        changes = apply_fixes(seed, tier1)
        if changes:
            SEED_PATH.write_text(json.dumps(seed, indent=2) + "\n")
            print(f"\n══ Applied {len(changes)} repairs to {SEED_PATH.name} ══")
            for c in changes:
                print(f"  {c}")
        else:
            print("\nNo safe repairs to apply.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

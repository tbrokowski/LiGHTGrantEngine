#!/usr/bin/env python3
"""Fix conference loading: patch the live OpenReview source + rescan conferences.

The OpenReview scraper (source_type="openreview") reliably lists active
conference/workshop calls-for-papers with real submission deadlines, but the
seed loader only *inserts* new sources — it never updates an already-seeded
one — so config changes in grant_funding_portals.json don't reach the live DB.
This script brings the live OpenReview source up to the broadened config and
(re)scans it, so conferences actually populate the opportunity feed.

Usage (from repo root):
    cd backend
    python scripts/refresh_conferences.py [--dry-run] [--sync] [--aggregators]

  --dry-run      show what would change / be scanned, don't touch anything
  --sync         run the scan(s) in-process now (no Celery worker needed)
                 instead of enqueuing them
  --aggregators  also rescan the other "Conferences & Workshops" sources
                 (Nature, ACM, Elsevier, Sciforum, WikiCFP, ...), not just
                 OpenReview
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.source import Source

# Broadened OpenReview config — 400 venues (782+ are active), keep the
# require_deadline filter so only real CFPs with a parseable deadline surface.
_OPENREVIEW_NAME = "OpenReview (AI/ML Conferences & Workshops)"
_OPENREVIEW_CONFIG = {"year_min": 2026, "max_venues": 400, "require_deadline": True}


def main(dry_run: bool = False, sync: bool = False, aggregators: bool = False) -> None:
    settings = get_settings()
    engine = create_engine(settings.database_url)

    with Session(engine) as db:
        openreview = db.execute(
            select(Source).where(Source.name == _OPENREVIEW_NAME)
        ).scalar_one_or_none()

        if openreview is None:
            print(
                f"! OpenReview source not found by name ({_OPENREVIEW_NAME!r}).\n"
                "  Falling back to source_type='openreview'."
            )
            openreview = db.execute(
                select(Source).where(Source.source_type == "openreview")
            ).scalars().first()

        if openreview is None:
            print("! No OpenReview source in the DB. Seed sources first, then rerun.")
            return

        # Bring the live source up to the broadened, high-priority config.
        changes = []
        if openreview.scraper_config != _OPENREVIEW_CONFIG:
            changes.append(f"scraper_config: {openreview.scraper_config} -> {_OPENREVIEW_CONFIG}")
        if not openreview.is_high_priority:
            changes.append("is_high_priority: False -> True")
        if openreview.status != "active":
            changes.append(f"status: {openreview.status} -> active")

        print(f"OpenReview source: {openreview.name} ({openreview.id})")
        if changes:
            for c in changes:
                print(f"  ~ {c}")
        else:
            print("  (config already up to date)")

        # Collect scan targets.
        targets = [openreview]
        if aggregators:
            others = db.execute(
                select(Source).where(
                    Source.category == "Conferences & Workshops",
                    Source.status == "active",
                    Source.id != openreview.id,
                )
            ).scalars().all()
            targets.extend(others)

        print(f"\n{len(targets)} conference source(s) to scan:")
        for s in targets:
            print(f"  - {s.name}")

        if dry_run:
            print("\n[DRY RUN] Rerun without --dry-run to apply + scan.")
            return

        if changes:
            openreview.scraper_config = _OPENREVIEW_CONFIG
            openreview.is_high_priority = True
            openreview.status = "active"
            db.commit()
            print("\nApplied OpenReview config changes.")

        target_ids = [s.id for s in targets]

    if sync:
        # Run in-process — no Celery worker required.
        from app.workers.discovery_tasks import scan_source
        for sid in target_ids:
            print(f"Scanning {sid} ...")
            scan_source.run(sid)
        print(f"\nDone. Scanned {len(target_ids)} source(s) synchronously.")
    else:
        from app.workers.celery_app import celery_app
        for sid in target_ids:
            celery_app.send_task("app.workers.discovery_tasks.scan_source", args=[sid])
        print(f"\nQueued {len(target_ids)} conference scan(s).")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Patch + rescan conference sources (OpenReview)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--sync", action="store_true", help="run scans in-process, no Celery worker")
    ap.add_argument("--aggregators", action="store_true", help="also rescan the other conference sources")
    args = ap.parse_args()
    main(dry_run=args.dry_run, sync=args.sync, aggregators=args.aggregators)

#!/usr/bin/env python3
"""Re-scan every source whose most recent run found 0 opportunities.

With the main-call fallback in discovery_tasks.scan_source, an empty source now
surfaces the funder's own landing page as a single "main call" — so re-scanning
the 0-result sources gives each of them at least one clickable entry.

Usage (from repo root):
    cd backend
    python scripts/rescan_empty_sources.py [--dry-run] [--all-active]

  --dry-run     list what would be re-queued, don't enqueue
  --all-active  also re-scan active sources that have never run
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, select, func
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.source import Source, SourceRun


def main(dry_run: bool = False, all_active: bool = False) -> None:
    settings = get_settings()
    engine = create_engine(settings.database_url)

    with Session(engine) as db:
        sources = db.execute(
            select(Source).where(Source.status == "active")
        ).scalars().all()

        # Latest run per source (by started_at).
        latest_run: dict[str, SourceRun] = {}
        runs = db.execute(select(SourceRun).order_by(SourceRun.started_at.desc())).scalars().all()
        for r in runs:
            latest_run.setdefault(r.source_id, r)

        targets: list[Source] = []
        for s in sources:
            run = latest_run.get(s.id)
            if run is None:
                if all_active:
                    targets.append(s)
                continue
            if (run.records_found or 0) == 0:
                targets.append(s)

    print(f"{len(targets)} source(s) with 0 latest results to re-scan:")
    for s in targets:
        print(f"  - {s.name}")

    if dry_run:
        print("\n[DRY RUN] Re-run without --dry-run to enqueue.")
        return

    from app.workers.celery_app import celery_app
    for s in targets:
        celery_app.send_task("app.workers.discovery_tasks.scan_source", args=[s.id])
    print(f"\nQueued {len(targets)} re-scans.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Re-scan sources that found 0 opportunities")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--all-active", action="store_true", help="also re-scan active sources that never ran")
    args = ap.parse_args()
    main(dry_run=args.dry_run, all_active=args.all_active)

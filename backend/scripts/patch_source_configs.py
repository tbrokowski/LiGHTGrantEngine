#!/usr/bin/env python3
"""
Apply scraper_config patches from grant_funding_portals.json to existing DB rows.

Unlike seed_sources_from_json (which only inserts new rows), this script
updates the scraper_config of sources that already exist by name.

Usage (from repo root):
    cd backend
    python scripts/patch_source_configs.py [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import sys
import os
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from app.config import get_settings
from app.models.source import Source

DATA_DIR = Path(__file__).resolve().parents[1] / "data"


def patch_configs(dry_run: bool = False) -> None:
    path = DATA_DIR / "grant_funding_portals.json"
    payload = json.loads(path.read_text())

    settings = get_settings()
    engine = create_engine(settings.database_url)

    with Session(engine) as db:
        sources_by_name = {
            s.name.lower(): s
            for s in db.execute(select(Source)).scalars().all()
        }

        updated = 0
        skipped = 0
        not_found = 0

        for row in payload.get("sources", []):
            name = row["name"]
            source = sources_by_name.get(name.lower())
            if not source:
                print(f"  NOT FOUND: {name}")
                not_found += 1
                continue

            new_cfg = row.get("scraper_config") or {}
            old_cfg = source.scraper_config or {}

            if new_cfg == old_cfg:
                skipped += 1
                continue

            print(f"  UPDATE: {name}")
            if old_cfg:
                print(f"    old: {json.dumps(old_cfg)}")
            print(f"    new: {json.dumps(new_cfg)}")

            if not dry_run:
                source.scraper_config = new_cfg
            updated += 1

        if not dry_run:
            db.commit()

    mode = "[DRY RUN] " if dry_run else ""
    print(f"\n{mode}Done: {updated} updated, {skipped} unchanged, {not_found} not in DB")
    if dry_run and updated > 0:
        print("Re-run without --dry-run to apply.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Patch source scraper_configs from portals JSON")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without writing")
    args = parser.parse_args()
    patch_configs(dry_run=args.dry_run)

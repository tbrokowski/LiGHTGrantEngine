"""
Backfill funder_logo_url for existing Opportunity rows.

Re-applies the current _get_funder_logo_url() mapping to all opportunities
where funder_logo_url is NULL or still points to the defunct Clearbit CDN.

Usage (from repo root):
    cd backend
    python scripts/backfill_logos.py

    # Dry run (preview changes without writing):
    python scripts/backfill_logos.py --dry-run
"""
import sys
import os
import argparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session
from app.config import get_settings
from app.models.opportunity import Opportunity
from app.workers.discovery_tasks import _get_funder_logo_url

settings = get_settings()


def backfill(dry_run: bool = False) -> None:
    engine = create_engine(settings.database_url)

    with Session(engine) as db:
        # Target rows that are null OR still reference Clearbit
        stmt = select(Opportunity).where(
            (Opportunity.funder_logo_url.is_(None))
            | (Opportunity.funder_logo_url.like("%clearbit.com%"))
        )
        opps = db.scalars(stmt).all()

        print(f"Found {len(opps)} opportunities to process")

        updated = 0
        skipped = 0

        for opp in opps:
            if not opp.funder:
                skipped += 1
                continue

            new_url = _get_funder_logo_url(opp.funder)
            if not new_url:
                skipped += 1
                continue

            if dry_run:
                print(f"  [DRY] {opp.funder[:50]!r:50s} → {new_url}")
            else:
                opp.funder_logo_url = new_url
            updated += 1

        if not dry_run:
            db.commit()
            print(f"\nDone: {updated} updated, {skipped} skipped (no funder name or no match)")
        else:
            print(f"\nDry run complete: {updated} would be updated, {skipped} skipped")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill funder logos for existing opportunities")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without writing to DB")
    args = parser.parse_args()
    backfill(dry_run=args.dry_run)

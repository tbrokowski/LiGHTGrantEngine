"""
Archive opportunities ingested from NIH/NSF award databases (not open calls).

Targets rows from nih_reporter/nsf sources or URLs pointing to RePORTER
project pages / NSF award search.

Usage (from backend/):
    python scripts/archive_award_opportunities.py
    python scripts/archive_award_opportunities.py --dry-run
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.institution_opportunity import InstitutionOpportunity
from app.models.opportunity import Opportunity
from app.models.source import Source


def archive_award_opportunities(dry_run: bool = False) -> dict:
    settings = get_settings()
    engine = create_engine(settings.database_url)

    with Session(engine) as db:
        award_source_ids = {
            row[0]
            for row in db.execute(
                select(Source.id).where(Source.source_type.in_(["nih_reporter", "nsf"]))
            ).all()
        }

        conditions = [
            Opportunity.opportunity_url.ilike("%reporter.nih.gov/project-details%"),
            Opportunity.opportunity_url.ilike("%nsf.gov/awardsearch/showaward%"),
        ]
        if award_source_ids:
            conditions.append(Opportunity.source_id.in_(award_source_ids))

        candidates = db.scalars(
            select(Opportunity).where(
                Opportunity.status.notin_(["archived", "duplicate"]),
                or_(*conditions),
            )
        ).all()

        opp_ids = [o.id for o in candidates]
        io_rows: list[InstitutionOpportunity] = []
        if opp_ids:
            io_rows = db.scalars(
                select(InstitutionOpportunity).where(
                    InstitutionOpportunity.opportunity_id.in_(opp_ids),
                    InstitutionOpportunity.status != "archived",
                )
            ).all()

        print(f"Award sources found: {len(award_source_ids)}")
        print(f"Opportunities to archive: {len(candidates)}")
        print(f"InstitutionOpportunity rows to archive: {len(io_rows)}")

        if dry_run:
            for opp in candidates[:10]:
                print(f"  - {opp.title[:80]} | {opp.opportunity_url}")
            if len(candidates) > 10:
                print(f"  ... and {len(candidates) - 10} more")
            return {
                "dry_run": True,
                "opportunities": len(candidates),
                "institution_opportunities": len(io_rows),
            }

        for opp in candidates:
            opp.status = "archived"
        for io in io_rows:
            io.status = "archived"

        db.commit()
        return {
            "dry_run": False,
            "opportunities": len(candidates),
            "institution_opportunities": len(io_rows),
        }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Archive NIH/NSF award records from opportunity queue")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    args = parser.parse_args()
    result = archive_award_opportunities(dry_run=args.dry_run)
    print("Done:", result)

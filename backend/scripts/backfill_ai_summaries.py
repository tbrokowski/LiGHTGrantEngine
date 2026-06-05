"""
Regenerate AI summaries for all opportunities using the updated org-neutral prompts.

The old summarizer baked LiGHT/EPFL-specific context into the global sections, so
existing summaries need to be cleared and regenerated.  This script:

  1. Clears opportunities.ai_summary (and optionally institution_opportunities.ai_summary)
     for affected rows so the task's skip-if-exists guard doesn't prevent regeneration.
  2. Re-queues generate_ai_summary (with force=True) for each opportunity.

Without --clear-org: only clears the global ai_summary; org summaries are also
  regenerated (force=True bypasses the skip guard without clearing).
With --clear-org: also clears institution_opportunities.ai_summary before regenerating.

Usage (Celery worker must be running):
    cd backend
    python scripts/backfill_ai_summaries.py --dry-run
    python scripts/backfill_ai_summaries.py
    python scripts/backfill_ai_summaries.py --clear-org --limit 50

Options:
    --clear-org   Also clear per-org ai_summary before regenerating
    --limit N     Process at most N opportunities (default: all)
    --dry-run     Print what would be processed without actually doing it
"""
import sys
import os
import argparse

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def main():
    parser = argparse.ArgumentParser(description="Regenerate AI summaries (global + per-org)")
    parser.add_argument("--clear-org", action="store_true", help="Also clear per-org ai_summary")
    parser.add_argument("--limit", type=int, default=None, help="Max opportunities to process")
    parser.add_argument("--dry-run", action="store_true", help="Print count only, don't process")
    args = parser.parse_args()

    from app.config import get_settings
    from app.models.opportunity import Opportunity
    from app.models.institution_opportunity import InstitutionOpportunity
    from sqlalchemy import create_engine, select, update

    settings = get_settings()
    engine = create_engine(settings.database_url)

    from sqlalchemy.orm import Session
    with Session(engine) as db:
        q = select(Opportunity).where(Opportunity.title.isnot(None))
        if args.limit:
            q = q.limit(args.limit)
        opps = db.execute(q).scalars().all()

        with_summary = sum(1 for o in opps if o.ai_summary and len(o.ai_summary) > 200)
        without_summary = len(opps) - with_summary

        print(f"Found {len(opps)} opportunities total")
        print(f"  {with_summary} have an existing ai_summary (will be cleared and regenerated)")
        print(f"  {without_summary} have no summary (will be generated fresh)")

        if args.dry_run:
            print("\nDry run — no changes made.")
            print("\nSample opportunities:")
            for opp in opps[:10]:
                flag = "[HAS SUMMARY]" if opp.ai_summary else "[no summary  ]"
                print(f"  {flag} [{opp.id[:8]}] {opp.title[:80]}")
            if len(opps) > 10:
                print(f"  ... and {len(opps) - 10} more")
            return

        # Step 1: Clear global summaries so the task regenerates them.
        cleared_global = 0
        for opp in opps:
            if opp.ai_summary:
                opp.ai_summary = None
                cleared_global += 1
        db.commit()
        print(f"\nCleared {cleared_global} global ai_summary values.")

        # Step 2: Optionally clear per-org summaries.
        if args.clear_org:
            opp_ids = [o.id for o in opps]
            result = db.execute(
                update(InstitutionOpportunity)
                .where(InstitutionOpportunity.opportunity_id.in_(opp_ids))
                .values(ai_summary=None)
            )
            db.commit()
            print(f"Cleared {result.rowcount} per-org ai_summary values.")

        # Step 3: Queue generate_ai_summary (force=True) for each opportunity.
        from app.workers.celery_app import celery_app

        queued = 0
        for opp in opps:
            celery_app.send_task(
                "app.workers.enrichment_tasks.generate_ai_summary",
                args=[str(opp.id)],
                kwargs={"force": True},
            )
            queued += 1
            if queued % 50 == 0:
                print(f"  Queued {queued}/{len(opps)}…")

        print(f"\nDone. Queued {queued} generate_ai_summary tasks (force=True).")
        print("Monitor with: celery -A app.workers.celery_app inspect active")


if __name__ == "__main__":
    main()

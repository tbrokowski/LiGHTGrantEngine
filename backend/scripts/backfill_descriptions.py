"""
Backfill enrichment for existing opportunities: fetch call website descriptions
and download linked PDF call documents.

Run this after upgrading the enrichment pipeline so existing rows get full
markdown descriptions and stored call PDFs.

Without --force: only processes opportunities with no parsed_text (un-enriched).
With --force:    re-enriches all opportunities, overwriting existing content.

Usage (with Celery worker running):
    cd backend
    python scripts/backfill_descriptions.py --force

Usage (direct, no Celery needed):
    cd backend
    python scripts/backfill_descriptions.py --force --direct

Options:
    --force      Re-enrich even if parsed_text is already set
    --direct     Run DetailPageParser directly in this process instead of queuing Celery tasks
    --skip-pdf   Fetch HTML descriptions only; do not download PDFs
    --limit N    Process at most N opportunities (default: all)
    --dry-run    Print what would be processed without actually doing it
"""
import sys
import os
import argparse
import time

# Allow running from backend/ or project root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def main():
    parser = argparse.ArgumentParser(description="Backfill grant descriptions and call PDFs")
    parser.add_argument("--force", action="store_true", help="Re-enrich even if already enriched")
    parser.add_argument("--direct", action="store_true", help="Run in-process (no Celery required)")
    parser.add_argument("--skip-pdf", action="store_true", help="Skip PDF download; HTML only")
    parser.add_argument("--limit", type=int, default=None, help="Max opportunities to process")
    parser.add_argument("--dry-run", action="store_true", help="Print count only, don't process")
    args = parser.parse_args()

    from app.config import get_settings
    from app.models.opportunity import Opportunity
    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import Session

    settings = get_settings()
    engine = create_engine(settings.database_url)

    with Session(engine) as db:
        q = select(Opportunity).where(Opportunity.opportunity_url.isnot(None))
        if not args.force:
            q = q.where(
                (Opportunity.parsed_text.is_(None)) | (Opportunity.parsed_text == "")
            )
        if args.limit:
            q = q.limit(args.limit)

        opps = db.execute(q).scalars().all()
        print(f"Found {len(opps)} opportunities to {'re-' if args.force else ''}enrich")

        if args.dry_run:
            for opp in opps[:20]:
                print(f"  [{opp.id}] {opp.title[:80]} — {opp.opportunity_url[:60]}")
            if len(opps) > 20:
                print(f"  ... and {len(opps) - 20} more")
            return

        if args.direct:
            _run_direct(db, opps, skip_pdf=args.skip_pdf)
        else:
            _run_via_celery(opps, args.force, skip_pdf=args.skip_pdf)


def _run_direct(db, opps, *, skip_pdf: bool = False):
    """Run enrichment in-process and commit results directly."""
    from app.scrapers.detail_fetcher import DetailPageParser
    from app.models.source import Source
    from app.services.call_document_fetcher import (
        fetch_and_store_call_documents,
        merge_enrichment_text,
    )
    from app.workers.surfacing_tasks import rescore_opportunity_for_institutions

    parser = DetailPageParser()
    total = len(opps)

    for i, opp in enumerate(opps, 1):
        print(f"[{i}/{total}] {opp.title[:70]}…", end=" ", flush=True)

        detail_selectors = None
        use_playwright = False
        if opp.source_id:
            source = db.get(Source, opp.source_id)
            if source and source.scraper_config:
                cfg = source.scraper_config
                cfg_selectors = cfg.get("detail_selectors")
                if cfg_selectors:
                    detail_selectors = cfg_selectors if isinstance(cfg_selectors, list) else [cfg_selectors]
                use_playwright = bool(cfg.get("use_playwright", False))

        try:
            result = parser.fetch_and_parse(
                opp.opportunity_url,
                detail_selectors,
                use_playwright=use_playwright,
            )
        except Exception as e:
            print(f"ERROR: {e}")
            continue

        if result.get("error") and not result.get("pdf_urls"):
            print(f"SKIP ({result['error'][:60]})")
            continue

        pdf_result = fetch_and_store_call_documents(
            db,
            opp,
            result.get("pdf_urls") or [],
            pdf_anchors=result.get("pdf_anchors") or {},
            skip_pdf=skip_pdf,
        )
        merged = merge_enrichment_text(
            result.get("description"),
            result.get("parsed_text"),
            pdf_result.get("merged_pdf_text") or "",
        )

        if merged.get("description"):
            opp.description = merged["description"]
        if merged.get("parsed_text"):
            opp.parsed_text = merged["parsed_text"]
        if merged.get("short_summary"):
            opp.short_summary = merged["short_summary"]

        db.commit()
        pdf_note = f", {pdf_result.get('stored_count', 0)} PDFs" if not skip_pdf else ""
        print(f"OK ({len(opp.description or '')} chars{pdf_note})")

        rescore_opportunity_for_institutions.delay(str(opp.id))
        time.sleep(0.5)

    print(f"\nDone. Processed {total} opportunities.")


def _run_via_celery(opps, force: bool, *, skip_pdf: bool = False):
    """Enqueue Celery enrichment tasks."""
    from app.workers.celery_app import celery_app

    task_name = (
        "app.workers.enrichment_tasks.enrich_opportunity_force"
        if force
        else "app.workers.enrichment_tasks.enrich_opportunity"
    )

    queued = 0
    for opp in opps:
        celery_app.send_task(task_name, args=[str(opp.id)], kwargs={"skip_pdf": skip_pdf})
        queued += 1
        if queued % 50 == 0:
            print(f"  Queued {queued}/{len(opps)}…")

    print(f"Done. Queued {queued} enrichment tasks.")


if __name__ == "__main__":
    main()

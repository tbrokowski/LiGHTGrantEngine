"""
Backfill Phase 2 RAG style corpus for existing archive entries.

Re-runs LLM section splitting, builds document_structure and style_fingerprint,
and queues embedding jobs for each archive with a processed document.

Usage:
    cd backend
    python scripts/backfill_rag_style.py

Options:
    --force       Re-index even if style_fingerprint already exists
    --limit N     Process at most N archives
    --dry-run     Print what would be processed without doing it
    --archive-id  Process a single archive by ID
"""
import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


async def _reindex_one(archive_id: str, document_id: str) -> dict:
    from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
    from sqlalchemy import select
    from app.config import get_settings
    from app.models.archive import GrantArchive
    from app.models.document import Document
    from app.services.archive_ingestion import reindex_archive_style

    settings = get_settings()
    db_url = settings.database_url
    if db_url.startswith("postgresql://"):
        db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    engine = create_async_engine(db_url)
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with Session() as db:
        archive = (await db.execute(select(GrantArchive).where(GrantArchive.id == archive_id))).scalar_one_or_none()
        doc = (await db.execute(select(Document).where(Document.id == document_id))).scalar_one_or_none()
        if not archive or not doc:
            return {"archive_id": archive_id, "status": "skipped", "reason": "missing archive or document"}
        result = await reindex_archive_style(db, archive, doc)
        return {"archive_id": archive_id, "status": "ok", **result}


def main():
    parser = argparse.ArgumentParser(description="Backfill archive RAG style corpus")
    parser.add_argument("--force", action="store_true", help="Re-index even if style_fingerprint exists")
    parser.add_argument("--limit", type=int, default=None, help="Max archives to process")
    parser.add_argument("--dry-run", action="store_true", help="Print plan only")
    parser.add_argument("--archive-id", type=str, default=None, help="Single archive ID")
    args = parser.parse_args()

    from sqlalchemy import create_engine, select, and_
    from app.config import get_settings
    from app.models.archive import GrantArchive
    from app.models.document import Document, ProcessingStatus

    settings = get_settings()
    engine = create_engine(settings.database_url)

    with engine.connect() as conn:
        from sqlalchemy.orm import Session
        db = Session(bind=conn)

        q = (
            select(GrantArchive, Document)
            .join(Document, Document.archive_id == GrantArchive.id)
            .where(
                Document.parsed_text.isnot(None),
                Document.processing_status == ProcessingStatus.PROCESSED,
            )
        )
        if args.archive_id:
            q = q.where(GrantArchive.id == args.archive_id)
        elif not args.force:
            q = q.where(GrantArchive.style_fingerprint.is_(None))

        rows = db.execute(q).all()
        if args.limit:
            rows = rows[: args.limit]

        print(f"Found {len(rows)} archive(s) to process")
        if args.dry_run:
            for archive, doc in rows:
                print(f"  - {archive.id}: {archive.title} (doc {doc.id})")
            return

        ok = 0
        failed = 0
        for archive, doc in rows:
            print(f"Re-indexing: {archive.title} ({archive.id})...")
            try:
                result = asyncio.run(_reindex_one(archive.id, doc.id))
                if result.get("status") == "ok":
                    ok += 1
                    print(f"  -> {result.get('sections_created', 0)} sections, style indexed: {bool(result.get('style_fingerprint'))}")
                else:
                    failed += 1
                    print(f"  -> skipped: {result.get('reason')}")
            except Exception as e:
                failed += 1
                print(f"  -> failed: {e}")

        print(f"\nDone. Success: {ok}, Failed: {failed}")


if __name__ == "__main__":
    main()

"""Embedding and document parsing Celery tasks."""
import asyncio
from app.workers.celery_app import celery_app


def _run_async(coro):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@celery_app.task(name="app.workers.embedding_tasks.parse_and_embed_document")
def parse_and_embed_document(document_id: str):
    """Parse a document and generate embeddings."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from app.config import get_settings
    from app.models.document import Document, ProcessingStatus

    settings = get_settings()
    engine = create_engine(settings.database_url)

    with Session(engine) as db:
        doc = db.get(Document, document_id)
        if not doc:
            return

        doc.processing_status = ProcessingStatus.PROCESSING
        db.commit()

        try:
            # Parse document text
            text = _parse_document(doc)
            doc.parsed_text = text

            # Generate embedding
            if doc.ai_retrieval_allowed and text:
                async def _embed():
                    from app.ai.client import get_embedding
                    return await get_embedding(text[:8000])
                doc.embedding = _run_async(_embed())

            doc.processing_status = ProcessingStatus.PROCESSED
            from datetime import datetime
            doc.last_parsed_at = datetime.utcnow()
            db.commit()

        except Exception as e:
            doc.processing_status = ProcessingStatus.FAILED
            db.commit()
            raise


from app.services.document_parser import parse_bytes_for_document


def _resolve_r2_key(notes: str | None) -> str | None:
    """Return R2 object key from doc.notes (plain key or JSON metadata)."""
    if not notes:
        return None
    if notes.startswith("{"):
        try:
            import json
            meta = json.loads(notes)
            return meta.get("r2_key")
        except (json.JSONDecodeError, TypeError):
            return None
    return notes


def _parse_document(doc) -> str:
    """Extract text from a document. Downloads from R2 using the key in doc.notes."""
    content = b""

    r2_key = None
    if doc.notes:
        from app.services.storage import resolve_storage_key
        r2_key = resolve_storage_key(doc.notes)
    if r2_key:
        try:
            from app.services.storage import download_file
            content = download_file(r2_key)
        except FileNotFoundError:
            pass
        except Exception:
            pass

    if not content and doc.parsed_text:
        return doc.parsed_text

    if not content:
        return ""

    try:
        return parse_bytes_for_document(content, doc.file_format, doc.file_name)
    except Exception:
        return doc.parsed_text or ""


@celery_app.task(name="app.workers.embedding_tasks.embed_language_block")
def embed_language_block(block_id: str):
    """Generate embedding for a reusable language block."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from app.config import get_settings
    from app.models.language import ReusableLanguageBlock

    settings = get_settings()
    engine = create_engine(settings.database_url)

    with Session(engine) as db:
        block = db.get(ReusableLanguageBlock, block_id)
        if not block or not block.text:
            return
        if block.approved_for_reuse and not block.do_not_reuse:
            async def _embed():
                from app.ai.client import get_embedding
                return await get_embedding(block.text[:8000])
            block.embedding = _run_async(_embed())
            db.commit()


@celery_app.task(name="app.workers.embedding_tasks.embed_section")
def embed_section(section_id: str):
    """Generate embedding for a proposal section."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from app.config import get_settings
    from app.models.section import ProposalSection

    settings = get_settings()
    engine = create_engine(settings.database_url)

    with Session(engine) as db:
        section = db.get(ProposalSection, section_id)
        if not section or not section.section_text:
            return
        if section.ai_retrieval_allowed:
            async def _embed():
                from app.ai.client import get_embedding
                return await get_embedding(section.section_text[:8000])
            section.embedding = _run_async(_embed())
            db.commit()


@celery_app.task(name="app.workers.embedding_tasks.embed_style_profile")
def embed_style_profile(archive_id: str):
    """Generate and persist the style fingerprint for an archive."""
    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import Session
    from app.config import get_settings
    from app.models.archive import GrantArchive
    from app.models.section import ProposalSection

    settings = get_settings()
    engine = create_engine(settings.database_url)

    with Session(engine) as db:
        archive = db.get(GrantArchive, archive_id)
        if not archive:
            return

        sections = db.execute(
            select(ProposalSection).where(ProposalSection.archive_id == archive_id)
        ).scalars().all()

        if not sections:
            return

        async def _build():
            from app.services.archive_ingestion import build_archive_style_fingerprint
            return await build_archive_style_fingerprint(archive, list(sections))

        profile = _run_async(_build())
        if profile:
            db.commit()


@celery_app.task(name="app.workers.embedding_tasks.reindex_all")
def reindex_all():
    """Reindex all documents and sections that have no embedding."""
    from sqlalchemy import select, create_engine
    from sqlalchemy.orm import Session
    from app.config import get_settings
    from app.models.section import ProposalSection

    settings = get_settings()
    engine = create_engine(settings.database_url)

    with Session(engine) as db:
        sections = db.execute(
            select(ProposalSection).where(ProposalSection.embedding.is_(None), ProposalSection.ai_retrieval_allowed.is_(True))
        ).scalars().all()
        for s in sections:
            embed_section.delay(str(s.id))

    return {"queued_sections": len(sections)}

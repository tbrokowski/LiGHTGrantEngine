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


def _parse_document(doc) -> str:
    """Extract text from a document based on its format."""
    if not doc.file_url:
        return ""

    try:
        import requests
        response = requests.get(doc.file_url, timeout=30)
        content = response.content

        if doc.file_format in ("pdf",) or (doc.file_name or "").endswith(".pdf"):
            import pdfplumber
            import io
            with pdfplumber.open(io.BytesIO(content)) as pdf:
                return "\n".join(p.extract_text() or "" for p in pdf.pages)
        elif doc.file_format in ("docx",) or (doc.file_name or "").endswith(".docx"):
            import docx
            import io
            document = docx.Document(io.BytesIO(content))
            return "\n".join(p.text for p in document.paragraphs)
        else:
            return content.decode("utf-8", errors="ignore")
    except Exception:
        return ""


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
            select(ProposalSection).where(ProposalSection.embedding == None, ProposalSection.ai_retrieval_allowed == True)
        ).scalars().all()
        for s in sections:
            embed_section.delay(str(s.id))

    return {"queued_sections": len(sections)}

"""Grant archive endpoints."""
import uuid
from typing import Optional
from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.archive import GrantArchive
from app.models.section import ProposalSection
from app.models.document import Document, DocumentType, ProcessingStatus
from app.models.user import User, UserRole
from app.routers.auth import get_current_user
from app.services.archive_ingestion import create_archive_and_ingest, reindex_archive_style
from app.config import get_settings
from app.auth.permissions import require_role

router = APIRouter()


class ArchiveCreate(BaseModel):
    title: str
    funder: Optional[str] = None
    program: Optional[str] = None
    call_year: Optional[int] = None
    lead_pi: Optional[str] = None
    themes: list[str] = []
    geographies: list[str] = []
    submitted: bool = False
    submission_date: Optional[date] = None
    outcome: Optional[str] = None
    requested_amount: Optional[float] = None
    awarded_amount: Optional[float] = None
    currency: Optional[str] = None
    repository_folder_url: Optional[str] = None
    reviewer_feedback: Optional[str] = None
    lessons_learned: Optional[str] = None
    notes: Optional[str] = None


def _archive_dict(archive: GrantArchive, section_count: int = 0) -> dict:
    data = {c.name: getattr(archive, c.name) for c in archive.__table__.columns}
    for f in ("submission_date", "decision_date", "created_at", "updated_at", "style_indexed_at"):
        if data.get(f):
            data[f] = str(data[f])
    data["section_count"] = section_count
    data["style_indexed"] = bool(archive.style_fingerprint)
    return data


@router.get("/")  # all org members can read the archive
async def list_archive(
    funder: Optional[str] = None,
    outcome: Optional[str] = None,
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = select(GrantArchive)
    if funder:
        q = q.where(GrantArchive.funder.ilike(f"%{funder}%"))
    if outcome:
        q = q.where(GrantArchive.outcome == outcome)
    if search:
        q = q.where(or_(GrantArchive.title.ilike(f"%{search}%"), GrantArchive.funder.ilike(f"%{search}%")))
    result = await db.execute(q)
    archives = result.scalars().all()

    counts: dict[str, int] = {}
    if archives:
        archive_ids = [a.id for a in archives]
        count_result = await db.execute(
            select(ProposalSection.archive_id, func.count(ProposalSection.id))
            .where(ProposalSection.archive_id.in_(archive_ids))
            .group_by(ProposalSection.archive_id)
        )
        counts = {row[0]: row[1] for row in count_result.all()}

    return [_archive_dict(a, counts.get(a.id, 0)) for a in archives]


@router.post("/", status_code=201, dependencies=[Depends(require_role(UserRole.GRANT_LEAD))])
async def create_archive_entry(
    data: ArchiveCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    archive = GrantArchive(id=str(uuid.uuid4()), **data.model_dump())
    db.add(archive)
    await db.commit()
    return {"id": archive.id}


@router.post("/create-with-document", status_code=201, dependencies=[Depends(require_role(UserRole.GRANT_LEAD))])
async def create_archive_with_document(
    proposal_file: UploadFile = File(...),
    title: str = Form(...),
    funder: Optional[str] = Form(None),
    program: Optional[str] = Form(None),
    call_year: Optional[int] = Form(None),
    lead_pi: Optional[str] = Form(None),
    submitted: bool = Form(False),
    submission_date: Optional[date] = Form(None),
    outcome: Optional[str] = Form(None),
    requested_amount: Optional[float] = Form(None),
    awarded_amount: Optional[float] = Form(None),
    currency: Optional[str] = Form(None),
    repository_folder_url: Optional[str] = Form(None),
    reviewer_feedback: Optional[str] = Form(None),
    lessons_learned: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    ai_retrieval_allowed: bool = Form(True),
    text_reuse_allowed: bool = Form(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create archive entry and index proposal into RAG corpus in one step."""
    content = await proposal_file.read()
    if not content:
        raise HTTPException(400, "Proposal file is empty")

    settings = get_settings()
    max_mb = settings.parsing.get("max_file_size_mb", 50)
    if len(content) > max_mb * 1024 * 1024:
        raise HTTPException(400, f"File exceeds maximum size of {max_mb}MB")

    archive_fields = {
        "title": title.strip(),
        "funder": funder,
        "program": program,
        "call_year": call_year,
        "lead_pi": lead_pi,
        "submitted": submitted,
        "submission_date": submission_date,
        "outcome": outcome,
        "requested_amount": requested_amount,
        "awarded_amount": awarded_amount,
        "currency": currency,
        "repository_folder_url": repository_folder_url,
        "reviewer_feedback": reviewer_feedback,
        "lessons_learned": lessons_learned,
        "notes": notes,
        "ai_retrieval_allowed": ai_retrieval_allowed,
        "text_reuse_allowed": text_reuse_allowed,
    }

    try:
        result = await create_archive_and_ingest(
            db=db,
            archive_fields=archive_fields,
            file_content=content,
            filename=proposal_file.filename or "proposal.pdf",
            user_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        await db.rollback()
        raise HTTPException(500, f"Failed to create and index archive entry: {e}") from e

    return result


@router.get("/{archive_id}")
async def get_archive(
    archive_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(GrantArchive).where(GrantArchive.id == archive_id))
    archive = result.scalar_one_or_none()
    if not archive:
        raise HTTPException(404, "Archive entry not found")
    sections_q = select(ProposalSection).where(ProposalSection.archive_id == archive_id)
    sections = (await db.execute(sections_q)).scalars().all()
    docs_q = select(Document).where(Document.archive_id == archive_id)
    documents = (await db.execute(docs_q)).scalars().all()
    data = _archive_dict(archive, len(sections))
    data["sections"] = [
        {c.name: getattr(s, c.name) for c in s.__table__.columns if c.name != "embedding"}
        for s in sections
    ]
    data["documents"] = [
        {c.name: getattr(d, c.name) for c in d.__table__.columns if c.name != "embedding"}
        for d in documents
    ]
    return data


@router.patch("/{archive_id}", dependencies=[Depends(require_role(UserRole.GRANT_LEAD))])
async def update_archive(
    archive_id: str,
    data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(GrantArchive).where(GrantArchive.id == archive_id))
    archive = result.scalar_one_or_none()
    if not archive:
        raise HTTPException(404, "Archive entry not found")
    for k, v in data.items():
        if hasattr(archive, k):
            setattr(archive, k, v)
    await db.commit()
    return {"id": archive.id}


class ArchiveIngestRequest(BaseModel):
    document_id: Optional[str] = None
    submitted_text: Optional[str] = None


@router.post("/{archive_id}/ingest", dependencies=[Depends(require_role(UserRole.GRANT_LEAD))])
async def ingest_archive(
    archive_id: str,
    body: ArchiveIngestRequest = ArchiveIngestRequest(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Re-index an existing archive entry into the RAG corpus."""
    result = await db.execute(select(GrantArchive).where(GrantArchive.id == archive_id))
    archive = result.scalar_one_or_none()
    if not archive:
        raise HTTPException(404, "Archive entry not found")

    doc = None
    if body.document_id:
        doc_result = await db.execute(select(Document).where(Document.id == body.document_id))
        doc = doc_result.scalar_one_or_none()
    if not doc:
        docs_result = await db.execute(
            select(Document).where(Document.archive_id == archive_id).limit(1)
        )
        doc = docs_result.scalar_one_or_none()

    if doc and doc.parsed_text:
        return await reindex_archive_style(db, archive, doc)

    text = body.submitted_text or archive.lessons_learned or archive.notes or ""
    if not text:
        raise HTTPException(400, "No document or text available to ingest")

    from app.ai.agents.memory_agent import process_completed_grant

    pseudo = Document(
        id=str(uuid.uuid4()),
        archive_id=archive_id,
        document_type=DocumentType.FULL_PROPOSAL,
        file_name="submitted_text.txt",
        parsed_text=text,
        processing_status=ProcessingStatus.PROCESSED,
    )
    db.add(pseudo)
    await db.commit()
    return await reindex_archive_style(db, archive, pseudo)


@router.post("/{archive_id}/reindex-style", dependencies=[Depends(require_role(UserRole.GRANT_LEAD))])
async def reindex_archive_style_endpoint(
    archive_id: str,
    body: ArchiveIngestRequest = ArchiveIngestRequest(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Force Phase 2 re-index: LLM section split, document structure, style fingerprint."""
    result = await db.execute(select(GrantArchive).where(GrantArchive.id == archive_id))
    archive = result.scalar_one_or_none()
    if not archive:
        raise HTTPException(404, "Archive entry not found")

    doc = None
    if body.document_id:
        doc_result = await db.execute(select(Document).where(Document.id == body.document_id))
        doc = doc_result.scalar_one_or_none()
    if not doc:
        docs_result = await db.execute(
            select(Document).where(Document.archive_id == archive_id).limit(1)
        )
        doc = docs_result.scalar_one_or_none()
    if not doc or not doc.parsed_text:
        raise HTTPException(400, "No processed document found for this archive entry")

    try:
        return await reindex_archive_style(db, archive, doc)
    except Exception as e:
        await db.rollback()
        raise HTTPException(500, f"Re-index failed: {e}") from e

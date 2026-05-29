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
from app.services.archive_ingestion import create_archive_with_files
from app.workers.celery_app import celery_app
from app.config import get_settings
from app.auth.permissions import require_role, has_module_permission

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


_SKIP_COLUMNS = frozenset({"embedding"})


def _archive_dict(archive: GrantArchive, section_count: int = 0) -> dict:
    data = {
        c.name: getattr(archive, c.name)
        for c in archive.__table__.columns
        if c.name not in _SKIP_COLUMNS
    }
    for f in ("submission_date", "decision_date", "created_at", "updated_at", "style_indexed_at"):
        if data.get(f):
            data[f] = str(data[f])
    data["section_count"] = section_count
    data["style_indexed"] = bool(archive.style_fingerprint)
    data["indexing_status"] = archive.indexing_status
    data["indexing_error"] = archive.indexing_error
    return data


@router.get("/")
async def list_archive(
    funder: Optional[str] = None,
    outcome: Optional[str] = None,
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not has_module_permission(current_user, "can_view_archive"):
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(status_code=403, detail="You do not have access to the archive.")
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


@router.get("/graph-data")
async def get_archive_graph_data(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    funder: Optional[str] = None,
    outcome: Optional[str] = None,
    theme: Optional[str] = None,
    year: Optional[int] = None,
):
    """Return nodes, weighted edges, and cluster metadata for the archive graph view.

    Only includes archives that have been clustered (umap_x IS NOT NULL). Edges
    come from the kNN cosine-similarity graph built by cluster_archives and are
    filtered to pairs where both endpoints are in the current result set.
    Capped at 2000 edges (highest-weight first) to stay wire-friendly.
    """
    from app.models.archive_cluster import ArchiveCluster
    from app.models.archive_edge import ArchiveEdge

    q = select(GrantArchive).where(
        GrantArchive.indexing_status == "complete",
        GrantArchive.umap_x.isnot(None),
    )
    if funder:
        q = q.where(GrantArchive.funder.ilike(f"%{funder}%"))
    if outcome:
        q = q.where(GrantArchive.outcome == outcome)
    if theme:
        q = q.where(GrantArchive.themes.contains([theme]))
    if year:
        q = q.where(GrantArchive.call_year == year)
    q = q.limit(500)

    result = await db.execute(q)
    archives = result.scalars().all()

    clusters_result = await db.execute(select(ArchiveCluster))
    clusters = {
        c.id: {"id": c.id, "label": c.label, "color": c.color}
        for c in clusters_result.scalars().all()
    }

    node_ids: set[str] = {a.id for a in archives}

    nodes = [
        {
            "id": a.id,
            "title": a.title,
            "funder": a.funder,
            "outcome": a.outcome,
            "call_year": a.call_year,
            "lead_pi": a.lead_pi,
            "requested_amount": a.requested_amount,
            "awarded_amount": a.awarded_amount,
            "currency": a.currency,
            "themes": a.themes or [],
            "geographies": a.geographies or [],
            "cluster_id": a.cluster_id,
            "umap_x": a.umap_x,
            "umap_y": a.umap_y,
            "indexing_status": a.indexing_status,
        }
        for a in archives
    ]

    edges_result = await db.execute(
        select(ArchiveEdge)
        .where(ArchiveEdge.source_id.in_(node_ids))
        .where(ArchiveEdge.target_id.in_(node_ids))
        .order_by(ArchiveEdge.weight.desc())
        .limit(2000)
    )
    edges = [
        {"source": e.source_id, "target": e.target_id, "weight": e.weight}
        for e in edges_result.scalars().all()
    ]

    return {
        "nodes": nodes,
        "edges": edges,
        "clusters": list(clusters.values()),
        "total": len(nodes),
    }


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


def _check_upload_size(content: bytes, label: str) -> None:
    settings = get_settings()
    max_mb = settings.parsing.get("max_file_size_mb", 50)
    if len(content) > max_mb * 1024 * 1024:
        raise HTTPException(400, f"{label} exceeds maximum size of {max_mb}MB")


@router.post("/create-with-document", status_code=201, dependencies=[Depends(require_role(UserRole.GRANT_LEAD))])
async def create_archive_with_document(
    proposal_file: UploadFile = File(...),
    call_file: Optional[UploadFile] = File(None),
    budget_file: Optional[UploadFile] = File(None),
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
    """Create archive entry with documents; AI indexing runs in the background."""
    proposal_content = await proposal_file.read()
    if not proposal_content:
        raise HTTPException(400, "Submitted proposal file is empty")
    _check_upload_size(proposal_content, "Submitted proposal")

    call_content = None
    call_filename = None
    if call_file and call_file.filename:
        call_content = await call_file.read()
        if call_content:
            _check_upload_size(call_content, "Call document")
            call_filename = call_file.filename

    budget_content = None
    budget_filename = None
    if budget_file and budget_file.filename:
        budget_content = await budget_file.read()
        if budget_content:
            _check_upload_size(budget_content, "Budget file")
            budget_filename = budget_file.filename

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
        return await create_archive_with_files(
            db=db,
            archive_fields=archive_fields,
            proposal_content=proposal_content,
            proposal_filename=proposal_file.filename or "proposal.pdf",
            user_id=current_user.id,
            call_content=call_content,
            call_filename=call_filename,
            budget_content=budget_content,
            budget_filename=budget_filename,
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        await db.rollback()
        raise HTTPException(500, f"Failed to create archive entry: {e}") from e


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

    if doc and (doc.parsed_text or doc.notes):
        archive.indexing_status = "pending"
        archive.indexing_error = None
        await db.commit()
        celery_app.send_task("app.workers.archive_tasks.index_archive", args=[archive_id])
        return {
            "archive_id": archive_id,
            "indexing_status": "pending",
            "message": "Archive indexing queued in the background",
        }

    text = body.submitted_text or archive.lessons_learned or archive.notes or ""
    if not text:
        raise HTTPException(400, "No document or text available to ingest")

    pseudo = Document(
        id=str(uuid.uuid4()),
        archive_id=archive_id,
        document_type=DocumentType.FULL_PROPOSAL,
        file_name="submitted_text.txt",
        parsed_text=text,
        processing_status=ProcessingStatus.PROCESSED,
    )
    db.add(pseudo)
    archive.indexing_status = "pending"
    await db.commit()
    celery_app.send_task("app.workers.archive_tasks.index_archive", args=[archive_id])
    return {
        "archive_id": archive_id,
        "indexing_status": "pending",
        "message": "Archive indexing queued in the background",
    }


@router.post("/{archive_id}/documents", status_code=201, dependencies=[Depends(require_role(UserRole.GRANT_LEAD))])
async def add_archive_document(
    archive_id: str,
    file: UploadFile = File(...),
    document_type: str = Form(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload an additional document (proposal, call doc, or budget) to an existing archive entry."""
    result = await db.execute(select(GrantArchive).where(GrantArchive.id == archive_id))
    archive = result.scalar_one_or_none()
    if not archive:
        raise HTTPException(404, "Archive entry not found")

    valid_types = {"full_proposal", "call_document", "budget"}
    if document_type not in valid_types:
        raise HTTPException(400, f"document_type must be one of: {', '.join(sorted(valid_types))}")

    content = await file.read()
    if not content:
        raise HTTPException(400, "Uploaded file is empty")
    _check_upload_size(content, "File")

    from app.services.archive_ingestion import _store_archive_document

    doc = await _store_archive_document(
        db, archive, content, file.filename or "document", document_type, current_user.id
    )
    await db.commit()

    if document_type == "full_proposal":
        archive.indexing_status = "pending"
        archive.indexing_error = None
        await db.commit()
        celery_app.send_task("app.workers.archive_tasks.index_archive", args=[archive_id])

    return {"id": doc.id, "document_type": document_type, "file_name": doc.file_name}


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
    if not doc or not (doc.parsed_text or doc.notes):
        raise HTTPException(400, "No document found for this archive entry")

    archive.indexing_status = "pending"
    archive.indexing_error = None
    await db.commit()
    celery_app.send_task("app.workers.archive_tasks.index_archive", args=[archive_id])
    return {
        "archive_id": archive_id,
        "indexing_status": "pending",
        "message": "Re-index queued in the background",
    }

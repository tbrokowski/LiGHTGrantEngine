"""Grant archive endpoints."""
import uuid
from typing import Optional
from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select, or_, func, false
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.archive import GrantArchive
from app.models.section import ProposalSection
from app.models.document import Document, DocumentType, ProcessingStatus
from app.models.user import User
from app.routers.auth import get_current_user
from app.services.archive_ingestion import create_archive_with_files, queue_archive_indexing
from app.config import get_settings
from app.auth.permissions import require_archive_editor, has_module_permission

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


class ArchiveUpdate(BaseModel):
    title: Optional[str] = None
    funder: Optional[str] = None
    lead_pi: Optional[str] = None
    call_year: Optional[int] = None
    submission_date: Optional[date] = None
    decision_date: Optional[date] = None
    submitted: Optional[bool] = None
    outcome: Optional[str] = None
    requested_amount: Optional[float] = None
    awarded_amount: Optional[float] = None
    currency: Optional[str] = None
    notes: Optional[str] = None
    lessons_learned: Optional[str] = None
    reviewer_feedback: Optional[str] = None
    ai_retrieval_allowed: Optional[bool] = None
    text_reuse_allowed: Optional[bool] = None


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
    data["outcome_notes"] = archive.reviewer_feedback
    return data


# ── Organization scoping ──────────────────────────────────────────────────────
# Archive entries belong to one organization (GrantArchive.institution_id).
# Members of the active org with can_view_archive see its entries; anyone with
# an ArchiveShare row for an entry may view that one entry, from any org.

def _in_active_org(user: User):
    """WHERE clause: entries owned by the user's active organization."""
    if not user.institution_id:
        return false()
    return GrantArchive.institution_id == user.institution_id


async def _shared_archive_ids(db: AsyncSession, user: User) -> set[str]:
    from app.models.archive_share import ArchiveShare
    return set((await db.execute(
        select(ArchiveShare.archive_id).where(ArchiveShare.user_id == user.id)
    )).scalars().all())


def _owned_by_active_org(archive: GrantArchive, user: User) -> bool:
    return bool(user.institution_id) and archive.institution_id == user.institution_id


async def _get_archive_for(
    db: AsyncSession, archive_id: str, user: User, *, allow_shared: bool = False
) -> GrantArchive:
    """The entry, if the user may see it; 404 otherwise (so other orgs' ids
    don't leak). Without `allow_shared`, only the owning org's members pass —
    use that for edits and share management."""
    archive = (await db.execute(select(GrantArchive).where(GrantArchive.id == archive_id))).scalar_one_or_none()
    if archive:
        if _owned_by_active_org(archive, user) and (
            not allow_shared or has_module_permission(user, "can_view_archive")
        ):
            return archive
        if allow_shared and archive_id in await _shared_archive_ids(db, user):
            return archive
    raise HTTPException(404, "Archive entry not found")


@router.get("/")
async def list_archive(
    funder: Optional[str] = None,
    outcome: Optional[str] = None,
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    shared_ids = await _shared_archive_ids(db, current_user)
    q = select(GrantArchive)
    if has_module_permission(current_user, "can_view_archive"):
        q = q.where(or_(_in_active_org(current_user), GrantArchive.id.in_(shared_ids)))
    else:
        # No archive access of their own: only what was shared with them.
        if not shared_ids:
            raise HTTPException(status_code=403, detail="You do not have access to the archive.")
        q = q.where(GrantArchive.id.in_(shared_ids))
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

    return [{**_archive_dict(a, counts.get(a.id, 0)), "shared_with_me": a.id in shared_ids} for a in archives]


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

    _require_archive_viewer(current_user)
    q = select(GrantArchive).where(
        _in_active_org(current_user),
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

    # Clustering runs over every org's entries; only return clusters this
    # org's nodes are in, so other orgs' cluster labels don't show.
    cluster_ids = {a.cluster_id for a in archives if a.cluster_id is not None}
    clusters_result = await db.execute(select(ArchiveCluster).where(ArchiveCluster.id.in_(cluster_ids)))
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


@router.post("/", status_code=201, dependencies=[Depends(require_archive_editor())])
async def create_archive_entry(
    data: ArchiveCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    archive = GrantArchive(id=str(uuid.uuid4()), institution_id=current_user.institution_id, **data.model_dump())
    db.add(archive)
    await db.commit()
    return {"id": archive.id}


def _check_upload_size(content: bytes, label: str) -> None:
    settings = get_settings()
    max_mb = settings.parsing.get("max_file_size_mb", 50)
    if len(content) > max_mb * 1024 * 1024:
        raise HTTPException(400, f"{label} exceeds maximum size of {max_mb}MB")


@router.post("/create-with-document", status_code=201, dependencies=[Depends(require_archive_editor())])
async def create_archive_with_document(
    proposal_file: UploadFile = File(...),
    call_file: Optional[UploadFile] = File(None),
    budget_file: Optional[UploadFile] = File(None),
    feedback_file: Optional[UploadFile] = File(None),
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
    text_reuse_allowed: bool = Form(True),
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

    feedback_content = None
    feedback_filename = None
    if feedback_file and feedback_file.filename:
        feedback_content = await feedback_file.read()
        if feedback_content:
            _check_upload_size(feedback_content, "Reviewer feedback file")
            feedback_filename = feedback_file.filename

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
        "institution_id": current_user.institution_id,
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
            feedback_content=feedback_content,
            feedback_filename=feedback_filename,
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        await db.rollback()
        raise HTTPException(500, f"Failed to create archive entry: {e}") from e


# ── Sharing ───────────────────────────────────────────────────────────────────
# Share an archived grant with one person: someone from Partners, an org
# colleague, or any email. Each recipient is tagged internal (already in the
# sharer's organization) or external, and gets an email with a link.

class ArchiveShareCreate(BaseModel):
    email: Optional[str] = None
    partner_id: Optional[str] = None
    note: Optional[str] = None


async def _internal_emails(db: AsyncSession, institution_id: Optional[str], emails: list[str]) -> dict[str, User]:
    """Lower-cased email → user, for those of `emails` who belong to the org."""
    if not institution_id or not emails:
        return {}
    from app.models.institution_membership import InstitutionMembership
    rows = (await db.execute(
        select(User)
        .join(InstitutionMembership, InstitutionMembership.user_id == User.id)
        .where(
            InstitutionMembership.institution_id == institution_id,
            func.lower(User.email).in_([e.lower() for e in emails]),
        )
    )).scalars().all()
    return {u.email.lower(): u for u in rows}


def _require_archive_viewer(user: User) -> None:
    if not has_module_permission(user, "can_view_archive"):
        raise HTTPException(403, "You do not have access to the archive.")


@router.get("/share-targets")
async def archive_share_targets(
    q: str = "",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """People to share with: org colleagues and partners with an email, each
    marked internal/external. With no matching person, `q` is classified as a
    typed email address."""
    _require_archive_viewer(current_user)
    from app.models.institution_membership import InstitutionMembership
    from app.models.partner import Partner

    term = q.strip()
    like = f"%{term}%"
    out: list[dict] = []
    seen: set[str] = set()

    if current_user.institution_id:
        mq = (
            select(User)
            .join(InstitutionMembership, InstitutionMembership.user_id == User.id)
            .where(
                InstitutionMembership.institution_id == current_user.institution_id,
                User.is_active == True,  # noqa: E712
                User.id != current_user.id,
            )
        )
        if term:
            mq = mq.where(or_(User.name.ilike(like), User.email.ilike(like)))
        for u in (await db.execute(mq.limit(8))).scalars().all():
            seen.add(u.email.lower())
            out.append({"kind": "member", "email": u.email, "name": u.name, "organization": None,
                        "partner_id": None, "is_internal": True})

    from app.routers.partners import partner_org_filter
    pq = select(Partner).where(partner_org_filter(current_user), Partner.email.is_not(None), Partner.email != "")
    if term:
        pq = pq.where(or_(Partner.name.ilike(like), Partner.email.ilike(like), Partner.organization.ilike(like)))
    partners = [p for p in (await db.execute(pq.order_by(Partner.name).limit(12))).scalars().all()
                if p.email.strip().lower() not in seen]
    internal = await _internal_emails(db, current_user.institution_id, [p.email.strip() for p in partners])
    for p in partners:
        e = p.email.strip()
        seen.add(e.lower())
        out.append({"kind": "partner", "email": e, "name": p.name, "organization": p.organization,
                    "partner_id": p.id, "is_internal": e.lower() in internal})

    if "@" in term and term.lower() not in seen:
        internal = await _internal_emails(db, current_user.institution_id, [term])
        u = internal.get(term.lower())
        out.insert(0, {"kind": "email", "email": term, "name": u.name if u else None, "organization": None,
                       "partner_id": None, "is_internal": u is not None})
    return out


@router.get("/shared-with-me")
async def archive_shared_with_me(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.models.archive_share import ArchiveShare
    rows = (await db.execute(
        select(GrantArchive, ArchiveShare)
        .join(ArchiveShare, ArchiveShare.archive_id == GrantArchive.id)
        .where(ArchiveShare.user_id == current_user.id)
    )).all()
    return [{**_archive_dict(a), "shared_with_me": True, "share_is_internal": sh.is_internal} for a, sh in rows]


@router.get("/{archive_id}")
async def get_archive(
    archive_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    archive = await _get_archive_for(db, archive_id, current_user, allow_shared=True)
    sections_q = select(ProposalSection).where(ProposalSection.archive_id == archive_id)
    sections = (await db.execute(sections_q)).scalars().all()
    docs_q = select(Document).where(Document.archive_id == archive_id)
    documents = (await db.execute(docs_q)).scalars().all()
    data = _archive_dict(archive, len(sections))
    data["sections"] = [
        {c.name: getattr(s, c.name) for c in s.__table__.columns if c.name != "embedding"}
        for s in sections
    ]
    from app.services.storage import resolve_storage_key
    data["documents"] = [
        {
            **{c.name: getattr(d, c.name) for c in d.__table__.columns if c.name != "embedding"},
            # stored = a file in storage the viewer can open; otherwise file_url
            # may be an external link (e.g. Google Drive), or there's text only.
            "has_file": bool(resolve_storage_key(d.notes)),
        }
        for d in documents
    ]
    return data


@router.get("/sections/{section_id}")
async def get_archive_section(
    section_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Fetch a single archive section's full text + metadata — used by the editor's
    archive-source pane when a user clicks through a RAG-derived citation."""
    result = await db.execute(select(ProposalSection).where(ProposalSection.id == section_id))
    section = result.scalar_one_or_none()
    if not section:
        raise HTTPException(404, "Archive section not found")

    if not section.archive_id:
        # Not an archive section (e.g. a grant workspace reference doc).
        raise HTTPException(404, "Archive section not found")
    try:
        archive = await _get_archive_for(db, section.archive_id, current_user, allow_shared=True)
    except HTTPException:
        raise HTTPException(404, "Archive section not found")
    archive_title = archive.title

    return {
        "id": section.id,
        "archive_id": section.archive_id,
        "archive_title": archive_title,
        "grant_title": section.grant_title,
        "funder": section.funder,
        "year": section.year,
        "outcome": section.outcome,
        "section_type": section.section_type,
        "section_title": section.section_title,
        "section_text": section.section_text,
        "word_count": section.word_count,
    }


@router.delete("/{archive_id}", status_code=204, dependencies=[Depends(require_archive_editor())])
async def delete_archive(
    archive_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete an archive entry and everything indexed from it: its sections,
    their retrieval chunks and reusable language, and the files uploaded to it.

    Files that also belong to a grant's workspace stay with the grant — they
    are only unlinked from the archive."""
    from sqlalchemy import delete as sa_delete
    from app.models.language import ReusableLanguageBlock
    from app.models.section_chunk import SectionChunk
    from app.services.storage import delete_file, resolve_storage_key

    archive = await _get_archive_for(db, archive_id, current_user)

    documents = (await db.execute(select(Document).where(Document.archive_id == archive_id))).scalars().all()
    # The archive's own documents: its uploads, the files copied from a grant's
    # workspace on submit, and the editor-text snapshot. Anything else linked
    # here is a grant's document and only gets unlinked.
    owned_docs = [d for d in documents if not d.grant_id or d.file_name == "workspace_proposal.txt"]
    owned_ids = {d.id for d in owned_docs}
    owned_doc_ids = [d.id for d in owned_docs]

    section_filter = ProposalSection.archive_id == archive_id
    if owned_doc_ids:
        section_filter = or_(section_filter, ProposalSection.document_id.in_(owned_doc_ids))
    section_ids = list((await db.execute(select(ProposalSection.id).where(section_filter))).scalars().all())

    block_filter = ReusableLanguageBlock.archive_id == archive_id
    if section_ids:
        block_filter = or_(block_filter, ReusableLanguageBlock.source_section_id.in_(section_ids))
        await db.execute(sa_delete(SectionChunk).where(SectionChunk.section_id.in_(section_ids)))
    await db.execute(sa_delete(ReusableLanguageBlock).where(block_filter))
    if section_ids:
        await db.execute(sa_delete(ProposalSection).where(ProposalSection.id.in_(section_ids)))

    storage_keys = {k for k in (resolve_storage_key(d.notes) for d in owned_docs) if k}
    for d in documents:
        if d.id in owned_ids:
            await db.delete(d)
        else:
            d.archive_id = None
    await db.flush()
    await db.delete(archive)
    await db.commit()

    # Remove stored files no other document still points at (a file can be
    # shared, e.g. a call document linked into a grant).
    for key in storage_keys:
        still_used = (await db.execute(
            select(func.count()).select_from(Document).where(Document.notes.contains(key))
        )).scalar_one()
        if not still_used:
            try:
                delete_file(key)
            except Exception:
                pass


@router.patch("/{archive_id}", dependencies=[Depends(require_archive_editor())])
async def update_archive(
    archive_id: str,
    data: ArchiveUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    archive = await _get_archive_for(db, archive_id, current_user)
    for k, v in data.model_dump(exclude_unset=True).items():
        if hasattr(archive, k):
            setattr(archive, k, v)
    await db.commit()
    return {"id": archive.id}


class ArchiveIngestRequest(BaseModel):
    document_id: Optional[str] = None
    submitted_text: Optional[str] = None


@router.post("/{archive_id}/ingest", dependencies=[Depends(require_archive_editor())])
async def ingest_archive(
    archive_id: str,
    body: ArchiveIngestRequest = ArchiveIngestRequest(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Re-index an existing archive entry into the RAG corpus."""
    archive = await _get_archive_for(db, archive_id, current_user)

    doc = None
    if body.document_id:
        doc_result = await db.execute(select(Document).where(
            Document.id == body.document_id, Document.archive_id == archive_id,
        ))
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
        queue_archive_indexing(archive_id)
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
    queue_archive_indexing(archive_id)
    return {
        "archive_id": archive_id,
        "indexing_status": "pending",
        "message": "Archive indexing queued in the background",
    }


@router.post("/{archive_id}/documents", status_code=201, dependencies=[Depends(require_archive_editor())])
async def add_archive_document(
    archive_id: str,
    file: UploadFile = File(...),
    document_type: str = Form(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload an additional document to an existing archive entry."""
    archive = await _get_archive_for(db, archive_id, current_user)

    valid_types = {"full_proposal", "call_document", "budget", "review_feedback"}
    if document_type not in valid_types:
        raise HTTPException(400, f"document_type must be one of: {', '.join(sorted(valid_types))}")

    content = await file.read()
    if not content:
        raise HTTPException(400, "Uploaded file is empty")
    _check_upload_size(content, "File")

    from app.services.archive_ingestion import _store_archive_document

    try:
        doc = await _store_archive_document(
            db, archive, content, file.filename or "document", document_type, current_user.id
        )
    except RuntimeError as e:
        raise HTTPException(503, str(e)) from e
    except Exception as e:
        raise HTTPException(500, f"Failed to store document: {e}") from e
    await db.commit()

    if document_type == "full_proposal":
        archive.indexing_status = "pending"
        archive.indexing_error = None
        await db.commit()
        queue_archive_indexing(archive_id)

    return {"id": doc.id, "document_type": document_type, "file_name": doc.file_name}


@router.post("/{archive_id}/reindex-style", dependencies=[Depends(require_archive_editor())])
async def reindex_archive_style_endpoint(
    archive_id: str,
    body: ArchiveIngestRequest = ArchiveIngestRequest(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Force Phase 2 re-index: LLM section split, document structure, style fingerprint."""
    archive = await _get_archive_for(db, archive_id, current_user)

    doc = None
    if body.document_id:
        doc_result = await db.execute(select(Document).where(
            Document.id == body.document_id, Document.archive_id == archive_id,
        ))
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
    queue_archive_indexing(archive_id)
    return {
        "archive_id": archive_id,
        "indexing_status": "pending",
        "message": "Re-index queued in the background",
    }


def _share_dict(sh, user: Optional[User], sharer: Optional[User]) -> dict:
    return {
        "id": sh.id, "email": sh.email, "partner_id": sh.partner_id,
        "is_internal": sh.is_internal, "note": sh.note,
        "name": user.name if user else None, "has_account": user is not None,
        "shared_by": sharer.name if sharer else None,
        "created_at": str(sh.created_at) if sh.created_at else None,
    }


@router.get("/{archive_id}/shares")
async def list_archive_shares(
    archive_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_archive_viewer(current_user)
    await _get_archive_for(db, archive_id, current_user)
    from app.models.archive_share import ArchiveShare
    shares = (await db.execute(
        select(ArchiveShare).where(ArchiveShare.archive_id == archive_id).order_by(ArchiveShare.created_at)
    )).scalars().all()
    ids = {i for sh in shares for i in (sh.user_id, sh.shared_by_id) if i}
    users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all()} if ids else {}
    return [_share_dict(sh, users.get(sh.user_id), users.get(sh.shared_by_id)) for sh in shares]


@router.post("/{archive_id}/shares", status_code=201)
async def share_archive(
    archive_id: str,
    body: ArchiveShareCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_archive_viewer(current_user)
    from app.models.archive_share import ArchiveShare
    from app.models.partner import Partner
    from app.services.sharing import send_archive_share_email

    archive = await _get_archive_for(db, archive_id, current_user)

    partner = None
    if body.partner_id:
        from app.routers.partners import partner_org_filter
        partner = (await db.execute(select(Partner).where(
            Partner.id == body.partner_id, partner_org_filter(current_user),
        ))).scalar_one_or_none()
        if not partner or not partner.email:
            raise HTTPException(400, "That partner has no email address on file")
        email = partner.email.strip()
    else:
        email = (body.email or "").strip()
    if "@" not in email:
        raise HTTPException(400, "Enter a valid email address")
    if email.lower() == (current_user.email or "").lower():
        raise HTTPException(400, "You can't share with yourself")

    dup = (await db.execute(select(ArchiveShare).where(
        ArchiveShare.archive_id == archive_id, func.lower(ArchiveShare.email) == email.lower(),
    ))).scalar_one_or_none()
    if dup:
        raise HTTPException(400, f"Already shared with {email}")

    recipient = (await db.execute(select(User).where(func.lower(User.email) == email.lower()))).scalar_one_or_none()
    internal = await _internal_emails(db, current_user.institution_id, [email])
    share = ArchiveShare(
        id=str(uuid.uuid4()),
        archive_id=archive_id,
        email=email,
        user_id=recipient.id if recipient else None,
        partner_id=partner.id if partner else None,
        institution_id=current_user.institution_id,
        is_internal=email.lower() in internal,
        note=(body.note or "").strip() or None,
        shared_by_id=current_user.id,
    )
    db.add(share)
    await db.commit()

    import asyncio
    asyncio.create_task(send_archive_share_email(
        to=email, sharer_name=current_user.name, archive_title=archive.title,
        archive_id=archive_id, has_account=recipient is not None, note=share.note,
    ))
    return _share_dict(share, recipient, current_user)


@router.delete("/{archive_id}/shares/{share_id}", status_code=204)
async def unshare_archive(
    archive_id: str,
    share_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_archive_viewer(current_user)
    await _get_archive_for(db, archive_id, current_user)
    from app.models.archive_share import ArchiveShare
    share = (await db.execute(select(ArchiveShare).where(
        ArchiveShare.id == share_id, ArchiveShare.archive_id == archive_id,
    ))).scalar_one_or_none()
    if not share:
        raise HTTPException(404, "Share not found")
    await db.delete(share)
    await db.commit()

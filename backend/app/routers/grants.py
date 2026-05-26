"""Active grants workspace endpoints."""
import uuid
import logging
from typing import Optional
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, desc, delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.active_grant import ActiveGrant, ActiveGrantStatus
from app.models.archive import GrantArchive
from app.models.task import Task, TaskStatus, TaskPriority, TaskType
from app.models.milestone import Milestone
from app.models.gantt_item import GanttItem
from app.models.checklist_item import ChecklistItem
from app.models.workspace_section import WorkspaceSection
from app.models.workspace_file import WorkspaceFile
from app.models.workspace_partner import WorkspacePartner, PartnerMaterial
from app.models.budget_tracker import BudgetTracker
from app.models.activity_log import GrantActivityLog
from app.models.grant_writing import GrantWritingConversation, GrantCitation
from app.models.document import Document, DocumentType, ProcessingStatus
from app.models.user import User, InstitutionRole
from app.models.grant_member import GrantMember
from app.routers.auth import get_current_user
from app.ai.context.grant_context import strip_html
from app.services.archive_ingestion import reindex_archive_style

router = APIRouter()
logger = logging.getLogger(__name__)

INACTIVE_STATUSES = ["closed", "withdrawn"]

STATUS_TO_ARCHIVE_OUTCOME = {
    "awarded": "awarded",
    "rejected": "rejected",
    "submitted": "pending",
    "under_review": "pending",
    "withdrawn": "withdrawn",
    "deferred": "deferred",
}


class GrantCreate(BaseModel):
    title: str
    funder: Optional[str] = None
    program: Optional[str] = None
    call_url: Optional[str] = None
    opportunity_id: Optional[str] = None
    pi_name: Optional[str] = None
    external_deadline: Optional[date] = None
    internal_deadline: Optional[date] = None
    requested_amount: Optional[float] = None
    currency: Optional[str] = None
    themes: list[str] = []
    geographies: list[str] = []


class GrantUpdate(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    pi_name: Optional[str] = None
    internal_lead_id: Optional[str] = None
    external_deadline: Optional[date] = None
    internal_deadline: Optional[date] = None
    drive_folder_url: Optional[str] = None
    proposal_draft_url: Optional[str] = None
    budget_url: Optional[str] = None
    submission_portal_url: Optional[str] = None
    decision_outcome: Optional[str] = None
    award_amount: Optional[float] = None
    notes: Optional[str] = None
    call_requirements: Optional[str] = None


class SectionUpsert(BaseModel):
    """Create or update a single editor section."""
    title: str
    section_type: str = "other"
    content_html: str = ""
    content_text: str = ""
    word_count: int = 0
    order: int = 0


class TaskCreateBody(BaseModel):
    title: str
    description: Optional[str] = None
    owner_id: Optional[str] = None
    due_date: Optional[date] = None
    priority: str = "medium"
    task_type: str = "other"
    document_url: Optional[str] = None


FULL_PROPOSAL_TEMPLATE = [
    ("Confirm eligibility", "eligibility_check", "high"),
    ("Create Google Drive folder", "other", "high"),
    ("Analyze call requirements", "call_analysis", "high"),
    ("Draft proposal outline", "narrative_writing", "high"),
    ("Assign section leads", "other", "medium"),
    ("Prepare budget shell", "budget", "medium"),
    ("Request partner letters", "partner_letter", "medium"),
    ("Draft abstract", "narrative_writing", "medium"),
    ("Draft background", "background", "medium"),
    ("Draft aims/objectives", "specific_aims", "medium"),
    ("Draft methods", "methods", "medium"),
    ("Draft implementation plan", "implementation_plan", "medium"),
    ("Draft MEL/evaluation section", "mel_evaluation", "medium"),
    ("Draft ethics section", "ethics", "medium"),
    ("Draft data management section", "data_management", "medium"),
    ("Prepare budget justification", "budget_justification", "medium"),
    ("Internal review", "other", "high"),
    ("PI review", "other", "critical"),
    ("Final formatting", "formatting", "high"),
    ("Submission portal upload", "submission_portal", "critical"),
    ("Final compliance check", "compliance_check", "critical"),
    ("Submit", "final_upload", "critical"),
    ("Archive submitted package", "post_submission_archive", "high"),
]


@router.get("/")
async def list_grants(
    status: Optional[str] = None,
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from sqlalchemy import or_, cast, String
    from sqlalchemy.dialects.postgresql import JSONB

    q = select(ActiveGrant)
    if status:
        q = q.where(ActiveGrant.status == status)
    elif not include_inactive:
        q = q.where(ActiveGrant.status.notin_(INACTIVE_STATUSES))

    # Institution admins and system admins see all grants in their institution
    is_admin = (
        current_user.role == "admin"
        or current_user.institution_role == InstitutionRole.ADMIN
    )

    if not is_admin:
        # Regular members see: grants they lead, are on the team, or are invited to
        member_grant_ids_q = select(GrantMember.grant_id).where(
            GrantMember.user_id == current_user.id
        )
        member_grant_ids = (await db.execute(member_grant_ids_q)).scalars().all()

        q = q.where(
            or_(
                ActiveGrant.internal_lead_id == current_user.id,
                ActiveGrant.id.in_(member_grant_ids),
                # proposal_team is a JSON array of user IDs
                ActiveGrant.proposal_team.cast(String).contains(current_user.id),
            )
        )

    q = q.order_by(desc(ActiveGrant.external_deadline))
    result = await db.execute(q)
    return [_grant_summary(g) for g in result.scalars().all()]


@router.post("/", status_code=201)
async def create_grant(
    data: GrantCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    grant = ActiveGrant(id=str(uuid.uuid4()), internal_lead_id=current_user.id, **data.model_dump())
    db.add(grant)
    await db.commit()
    await db.refresh(grant)
    return {"id": grant.id}


@router.get("/{grant_id}")
async def get_grant(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    grant = await _get_grant_or_404(grant_id, db)
    tasks_q = select(Task).where(Task.grant_id == grant_id)
    tasks = (await db.execute(tasks_q)).scalars().all()
    return {**_grant_full(grant), "tasks": [_task_dict(t) for t in tasks]}


@router.patch("/{grant_id}")
async def update_grant(
    grant_id: str,
    data: GrantUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    grant = await _get_grant_or_404(grant_id, db)
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(grant, k, v)
    await db.commit()
    return {"id": grant.id, "status": grant.status}


@router.post("/{grant_id}/archive")
async def archive_grant(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Move an active grant to the archive and close the workspace."""
    grant = await _get_grant_or_404(grant_id, db)

    existing = (
        await db.execute(select(GrantArchive).where(GrantArchive.grant_id == grant_id))
    ).scalar_one_or_none()
    if existing:
        grant.status = ActiveGrantStatus.CLOSED.value
        await db.commit()
        return {"archive_id": existing.id, "grant_id": grant.id, "message": "Grant already archived"}

    submitted_statuses = {"submitted", "under_review", "awarded", "rejected"}
    archive = GrantArchive(
        id=str(uuid.uuid4()),
        grant_id=grant.id,
        opportunity_id=grant.opportunity_id,
        title=grant.title,
        funder=grant.funder,
        program=grant.program,
        lead_pi=grant.pi_name,
        co_pis=grant.co_pis or [],
        team_members=grant.proposal_team or [],
        partner_institutions=grant.partner_institutions or [],
        themes=grant.themes or [],
        geographies=grant.geographies or [],
        submitted=grant.status in submitted_statuses,
        outcome=STATUS_TO_ARCHIVE_OUTCOME.get(grant.status, "not_submitted"),
        requested_amount=grant.requested_amount,
        awarded_amount=grant.award_amount,
        currency=grant.currency,
        project_duration=grant.project_duration,
        repository_folder_url=grant.drive_folder_url or grant.final_package_url,
        notes=grant.notes,
    )
    db.add(archive)
    grant.status = ActiveGrantStatus.CLOSED.value
    await db.commit()
    await db.refresh(archive)

    ingest_message = None
    proposal_text = _extract_grant_text(grant)
    if proposal_text.strip():
        try:
            document = Document(
                id=str(uuid.uuid4()),
                grant_id=grant.id,
                archive_id=archive.id,
                document_type=DocumentType.FULL_PROPOSAL,
                file_name="workspace_proposal.txt",
                parsed_text=proposal_text,
                processing_status=ProcessingStatus.PROCESSED,
            )
            db.add(document)
            await db.commit()
            await reindex_archive_style(db, archive, document)
            ingest_message = "Proposal content indexed into archive"
        except Exception as exc:
            await db.rollback()
            logger.warning("Archive ingest failed for grant %s: %s", grant_id, exc)
            ingest_message = "Archived without indexing proposal content"

    return {
        "archive_id": archive.id,
        "grant_id": grant.id,
        "message": ingest_message or "Grant moved to archive",
    }


@router.delete("/{grant_id}", status_code=204)
async def delete_grant(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Permanently delete a grant workspace and all related data."""
    await _get_grant_or_404(grant_id, db)
    await _delete_grant_data(db, grant_id)
    await db.commit()


@router.post("/{grant_id}/tasks", status_code=201)
async def create_task(
    grant_id: str,
    data: TaskCreateBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_grant_or_404(grant_id, db)
    task = Task(id=str(uuid.uuid4()), grant_id=grant_id, created_by_id=current_user.id, **data.model_dump())
    db.add(task)
    await db.commit()
    return {"id": task.id}


@router.post("/{grant_id}/apply-template")
async def apply_task_template(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_grant_or_404(grant_id, db)
    created = []
    for title, task_type, priority in FULL_PROPOSAL_TEMPLATE:
        task = Task(
            id=str(uuid.uuid4()),
            grant_id=grant_id,
            title=title,
            task_type=task_type,
            priority=priority,
            created_by_id=current_user.id,
        )
        db.add(task)
        created.append(title)
    await db.commit()
    return {"created_tasks": len(created), "tasks": created}


@router.get("/{grant_id}/sections")
async def get_sections(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return all editor sections for a grant as an ordered list."""
    grant = await _get_grant_or_404(grant_id, db)
    sections = grant.editor_sections or {}
    ordered = sorted(sections.values(), key=lambda s: s.get("order", 0))
    return {"sections": ordered, "grant_id": grant_id}


@router.put("/{grant_id}/sections/{section_id}")
async def upsert_section(
    grant_id: str,
    section_id: str,
    data: SectionUpsert,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create or update a single section in the editor."""
    grant = await _get_grant_or_404(grant_id, db)
    sections = dict(grant.editor_sections or {})
    sections[section_id] = {
        "id": section_id,
        **data.model_dump(),
    }
    grant.editor_sections = sections
    await db.commit()
    return {"id": section_id, "grant_id": grant_id}


@router.delete("/{grant_id}/sections/{section_id}", status_code=204)
async def delete_section(
    grant_id: str,
    section_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove a section from the editor."""
    grant = await _get_grant_or_404(grant_id, db)
    sections = dict(grant.editor_sections or {})
    sections.pop(section_id, None)
    grant.editor_sections = sections
    await db.commit()


@router.put("/{grant_id}/sections")
async def replace_all_sections(
    grant_id: str,
    data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Bulk-replace all editor sections (used for reorder / full save)."""
    grant = await _get_grant_or_404(grant_id, db)
    grant.editor_sections = data.get("sections", {})
    await db.commit()
    return {"grant_id": grant_id, "section_count": len(grant.editor_sections)}


@router.patch("/{grant_id}/tasks/{task_id}")
async def update_task(
    grant_id: str,
    task_id: str,
    data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Task).where(Task.id == task_id, Task.grant_id == grant_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, "Task not found")
    for k, v in data.items():
        if hasattr(task, k):
            setattr(task, k, v)
    await db.commit()
    return _task_dict(task)


async def _get_grant_or_404(grant_id: str, db: AsyncSession) -> ActiveGrant:
    result = await db.execute(select(ActiveGrant).where(ActiveGrant.id == grant_id))
    g = result.scalar_one_or_none()
    if not g:
        raise HTTPException(404, "Grant not found")
    return g


def _extract_grant_text(grant: ActiveGrant) -> str:
    if grant.editor_document:
        return strip_html(grant.editor_document)
    sections = grant.editor_sections or {}
    parts: list[str] = []
    for sec in sorted(sections.values(), key=lambda s: s.get("order", 0)):
        text = sec.get("content_text") or strip_html(sec.get("content_html", ""))
        if text and text.strip():
            parts.append(text.strip())
    return "\n\n".join(parts)


async def _delete_grant_data(db: AsyncSession, grant_id: str) -> None:
    await db.execute(
        update(GrantArchive).where(GrantArchive.grant_id == grant_id).values(grant_id=None)
    )
    await db.execute(delete(PartnerMaterial).where(PartnerMaterial.grant_id == grant_id))
    await db.execute(delete(WorkspacePartner).where(WorkspacePartner.grant_id == grant_id))
    await db.execute(delete(WorkspaceFile).where(WorkspaceFile.grant_id == grant_id))
    await db.execute(delete(WorkspaceSection).where(WorkspaceSection.grant_id == grant_id))
    await db.execute(delete(ChecklistItem).where(ChecklistItem.grant_id == grant_id))
    await db.execute(delete(GanttItem).where(GanttItem.grant_id == grant_id))
    await db.execute(delete(Milestone).where(Milestone.grant_id == grant_id))
    await db.execute(delete(Task).where(Task.grant_id == grant_id))
    await db.execute(delete(GrantActivityLog).where(GrantActivityLog.grant_id == grant_id))
    await db.execute(delete(BudgetTracker).where(BudgetTracker.grant_id == grant_id))
    await db.execute(delete(GrantWritingConversation).where(GrantWritingConversation.grant_id == grant_id))
    await db.execute(delete(GrantCitation).where(GrantCitation.grant_id == grant_id))
    await db.execute(delete(Document).where(Document.grant_id == grant_id))
    await db.execute(delete(ActiveGrant).where(ActiveGrant.id == grant_id))


def _grant_summary(g: ActiveGrant) -> dict:
    return {
        "id": g.id, "title": g.title, "funder": g.funder,
        "status": g.status, "priority": g.priority,
        "external_deadline": str(g.external_deadline) if g.external_deadline else None,
        "internal_deadline": str(g.internal_deadline) if g.internal_deadline else None,
        "pi_name": g.pi_name, "themes": g.themes,
    }


def _grant_full(g: ActiveGrant) -> dict:
    d = {c.name: getattr(g, c.name) for c in g.__table__.columns}
    for f in ["external_deadline", "internal_deadline", "concept_note_deadline",
              "budget_deadline", "partner_doc_deadline", "created_at", "updated_at"]:
        if d.get(f):
            d[f] = str(d[f])
    return d


def _task_dict(t: Task) -> dict:
    d = {c.name: getattr(t, c.name) for c in t.__table__.columns}
    for f in ["due_date", "created_at", "completed_at"]:
        if d.get(f):
            d[f] = str(d[f])
    return d

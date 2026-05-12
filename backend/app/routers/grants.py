"""Active grants workspace endpoints."""
import uuid
from typing import Optional
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.active_grant import ActiveGrant, ActiveGrantStatus
from app.models.task import Task, TaskStatus, TaskPriority, TaskType
from app.models.user import User
from app.routers.auth import get_current_user

router = APIRouter()


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
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = select(ActiveGrant)
    if status:
        q = q.where(ActiveGrant.status == status)
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

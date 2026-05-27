"""Grant Management Workspace sub-resource endpoints."""
import uuid
from typing import Optional
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.active_grant import ActiveGrant
from app.models.task import Task, TaskStatus, TaskPriority, TaskType
from app.models.milestone import Milestone, MilestoneStatus
from app.models.gantt_item import GanttItem, GanttItemType
from app.models.workspace_section import WorkspaceSection, WorkspaceSectionStatus
from app.models.checklist_item import ChecklistItem, ChecklistStatus, ChecklistCategory
from app.models.workspace_file import WorkspaceFile, FileCategory, FileSourceType
from app.models.workspace_partner import WorkspacePartner, PartnerMaterial, PartnerStatus
from app.models.budget_tracker import BudgetTracker, BudgetStatus
from app.models.activity_log import GrantActivityLog
from app.models.user import User
from app.models.grant_member import GrantMember, GrantMemberRole, GrantMemberStatus
from app.routers.auth import get_current_user
from app.auth.permissions import grant_access, invalidate_permission_cache, get_redis
import redis.asyncio as aioredis

# All workspace routes require at minimum read membership on the grant
router = APIRouter(dependencies=[Depends(grant_access())])


# ── Shared helpers ─────────────────────────────────────────────────────────────

async def _get_grant_or_404(grant_id: str, db: AsyncSession) -> ActiveGrant:
    result = await db.execute(select(ActiveGrant).where(ActiveGrant.id == grant_id))
    g = result.scalar_one_or_none()
    if not g:
        raise HTTPException(404, "Grant not found")
    return g


async def log_activity(
    db: AsyncSession,
    grant_id: str,
    action: str,
    actor_id: str,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    description: Optional[str] = None,
) -> None:
    entry = GrantActivityLog(
        id=str(uuid.uuid4()),
        grant_id=grant_id,
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        actor_id=actor_id,
        description=description,
    )
    db.add(entry)


def _serialize(obj, date_fields: list[str] = [], dt_fields: list[str] = []) -> dict:
    d = {c.name: getattr(obj, c.name) for c in obj.__table__.columns}
    for f in date_fields:
        if d.get(f):
            d[f] = str(d[f])
    for f in dt_fields:
        if d.get(f):
            d[f] = d[f].isoformat() if hasattr(d[f], "isoformat") else str(d[f])
    return d


# ── Tasks (extended) ───────────────────────────────────────────────────────────

class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    parent_task_id: Optional[str] = None
    owner_id: Optional[str] = None
    reviewer_id: Optional[str] = None
    assignee_ids: list[str] = []
    start_date: Optional[date] = None
    due_date: Optional[date] = None
    priority: str = TaskPriority.MEDIUM
    status: str = TaskStatus.NOT_STARTED
    task_type: str = TaskType.OTHER
    estimated_effort: Optional[float] = None
    linked_section_id: Optional[str] = None
    linked_milestone_id: Optional[str] = None
    dependencies: list[str] = []
    document_url: Optional[str] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    parent_task_id: Optional[str] = None
    owner_id: Optional[str] = None
    reviewer_id: Optional[str] = None
    assignee_ids: Optional[list[str]] = None
    start_date: Optional[date] = None
    due_date: Optional[date] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    task_type: Optional[str] = None
    estimated_effort: Optional[float] = None
    linked_section_id: Optional[str] = None
    linked_milestone_id: Optional[str] = None
    dependencies: Optional[list[str]] = None
    document_url: Optional[str] = None


def _task_dict(t: Task) -> dict:
    d = _serialize(t, date_fields=["due_date", "start_date"], dt_fields=["created_at", "completed_at"])
    return d


@router.get("/{grant_id}/tasks")
async def list_tasks(
    grant_id: str,
    parent_only: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_grant_or_404(grant_id, db)
    q = select(Task).where(Task.grant_id == grant_id)
    if parent_only:
        q = q.where(Task.parent_task_id.is_(None))
    result = await db.execute(q)
    tasks = result.scalars().all()
    return [_task_dict(t) for t in tasks]


@router.post("/{grant_id}/tasks", status_code=201)
async def create_task(
    grant_id: str,
    data: TaskCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    await _get_grant_or_404(grant_id, db)
    task = Task(id=str(uuid.uuid4()), grant_id=grant_id, created_by_id=current_user.id, **data.model_dump())
    db.add(task)
    await log_activity(db, grant_id, "task_created", current_user.id, "task", task.id, f"Task created: {data.title}")
    await db.commit()
    return _task_dict(task)


@router.patch("/{grant_id}/tasks/{task_id}")
async def update_task(
    grant_id: str,
    task_id: str,
    data: TaskUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    result = await db.execute(select(Task).where(Task.id == task_id, Task.grant_id == grant_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, "Task not found")
    updates = data.model_dump(exclude_none=True)
    for k, v in updates.items():
        setattr(task, k, v)
    if updates.get("status") == TaskStatus.COMPLETE and not task.completed_at:
        task.completed_at = datetime.utcnow()
    await log_activity(db, grant_id, "task_updated", current_user.id, "task", task_id, f"Task updated: {task.title}")
    await db.commit()
    return _task_dict(task)


@router.delete("/{grant_id}/tasks/{task_id}", status_code=204)
async def delete_task(
    grant_id: str,
    task_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    result = await db.execute(select(Task).where(Task.id == task_id, Task.grant_id == grant_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, "Task not found")
    await log_activity(db, grant_id, "task_deleted", current_user.id, "task", task_id, f"Task deleted: {task.title}")
    await db.delete(task)
    await db.commit()


# ── Grant Members ──────────────────────────────────────────────────────────────

class GrantMemberInvite(BaseModel):
    email: str
    role: str = GrantMemberRole.EDITOR


@router.get("/{grant_id}/members")
async def list_grant_members(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_grant_or_404(grant_id, db)
    result = await db.execute(
        select(GrantMember).where(GrantMember.grant_id == grant_id)
    )
    members = result.scalars().all()
    out = []
    for m in members:
        row = {
            "id": m.id,
            "grant_id": m.grant_id,
            "user_id": m.user_id,
            "email": m.email,
            "role": m.role,
            "status": m.status,
            "invited_by_id": m.invited_by_id,
            "created_at": m.created_at.isoformat() if m.created_at else None,
            "name": None,
        }
        if m.user_id:
            ur = await db.execute(select(User).where(User.id == m.user_id))
            u = ur.scalar_one_or_none()
            if u:
                row["name"] = u.name
        out.append(row)
    return out


@router.post("/{grant_id}/members", status_code=201)
async def invite_grant_member(
    grant_id: str,
    data: GrantMemberInvite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    redis: aioredis.Redis = Depends(get_redis),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    grant = await _get_grant_or_404(grant_id, db)

    # Auto-promote personal grant to org portfolio when a collaborator is invited
    if grant.is_personal:
        if not current_user.institution_id:
            raise HTTPException(
                400,
                "You must belong to an organization before inviting collaborators to a grant. "
                "The grant will be promoted to your organization's portfolio.",
            )
        grant.institution_id = current_user.institution_id
        grant.is_personal = False
        await db.flush()
        await invalidate_permission_cache(current_user.id, redis)

    # Check if this email is already a member of this grant
    existing = await db.execute(
        select(GrantMember).where(
            GrantMember.grant_id == grant_id,
            GrantMember.email == data.email,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(400, "This person is already a member of the grant")

    # Look up existing user by email
    user_result = await db.execute(select(User).where(User.email == data.email))
    user = user_result.scalar_one_or_none()

    member = GrantMember(
        id=str(uuid.uuid4()),
        grant_id=grant_id,
        user_id=user.id if user else None,
        email=data.email,
        role=data.role,
        status=GrantMemberStatus.ACCEPTED if user else GrantMemberStatus.PENDING,
        invited_by_id=current_user.id,
    )
    db.add(member)
    await log_activity(
        db, grant_id, "member_invited", current_user.id, "grant_member", member.id,
        f"Invited {data.email} as {data.role}"
    )
    await db.commit()
    if user:
        await invalidate_permission_cache(user.id, redis)

    return {
        "id": member.id,
        "grant_id": member.grant_id,
        "user_id": member.user_id,
        "email": member.email,
        "role": member.role,
        "status": member.status,
        "name": user.name if user else None,
    }


@router.patch("/{grant_id}/members/{member_id}")
async def update_grant_member(
    grant_id: str,
    member_id: str,
    data: GrantMemberInvite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    redis: aioredis.Redis = Depends(get_redis),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    result = await db.execute(
        select(GrantMember).where(
            GrantMember.id == member_id,
            GrantMember.grant_id == grant_id,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(404, "Member not found")
    if member.role == GrantMemberRole.OWNER:
        raise HTTPException(400, "Cannot change the role of the grant owner.")
    member.role = data.role
    await db.commit()
    if member.user_id:
        await invalidate_permission_cache(member.user_id, redis)
    return {"id": member.id, "role": member.role}


@router.delete("/{grant_id}/members/{member_id}", status_code=204)
async def remove_grant_member(
    grant_id: str,
    member_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    redis: aioredis.Redis = Depends(get_redis),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    result = await db.execute(
        select(GrantMember).where(
            GrantMember.id == member_id,
            GrantMember.grant_id == grant_id,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(404, "Member not found")
    if member.role == GrantMemberRole.OWNER:
        raise HTTPException(400, "Cannot remove the grant owner.")
    user_id = member.user_id
    await log_activity(
        db, grant_id, "member_removed", current_user.id, "grant_member", member_id,
        f"Removed member {member.email}"
    )
    await db.delete(member)
    await db.commit()
    if user_id:
        await invalidate_permission_cache(user_id, redis)


# ── Milestones ─────────────────────────────────────────────────────────────────

class MilestoneCreate(BaseModel):
    title: str
    description: Optional[str] = None
    owner_id: Optional[str] = None
    target_date: Optional[date] = None
    status: str = MilestoneStatus.UPCOMING
    linked_tasks: list[str] = []
    notes: Optional[str] = None


class MilestoneUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    owner_id: Optional[str] = None
    target_date: Optional[date] = None
    completion_date: Optional[date] = None
    status: Optional[str] = None
    linked_tasks: Optional[list[str]] = None
    notes: Optional[str] = None


def _milestone_dict(m: Milestone) -> dict:
    return _serialize(m, date_fields=["target_date", "completion_date"], dt_fields=["created_at", "updated_at"])


@router.get("/{grant_id}/milestones")
async def list_milestones(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_grant_or_404(grant_id, db)
    result = await db.execute(select(Milestone).where(Milestone.grant_id == grant_id).order_by(Milestone.target_date))
    return [_milestone_dict(m) for m in result.scalars().all()]


@router.post("/{grant_id}/milestones", status_code=201)
async def create_milestone(
    grant_id: str,
    data: MilestoneCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    await _get_grant_or_404(grant_id, db)
    m = Milestone(id=str(uuid.uuid4()), grant_id=grant_id, **data.model_dump())
    db.add(m)
    await log_activity(db, grant_id, "milestone_created", current_user.id, "milestone", m.id, f"Milestone created: {data.title}")
    await db.commit()
    return _milestone_dict(m)


@router.patch("/{grant_id}/milestones/{milestone_id}")
async def update_milestone(
    grant_id: str,
    milestone_id: str,
    data: MilestoneUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    result = await db.execute(select(Milestone).where(Milestone.id == milestone_id, Milestone.grant_id == grant_id))
    m = result.scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Milestone not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(m, k, v)
    await log_activity(db, grant_id, "milestone_updated", current_user.id, "milestone", milestone_id)
    await db.commit()
    return _milestone_dict(m)


@router.delete("/{grant_id}/milestones/{milestone_id}", status_code=204)
async def delete_milestone(
    grant_id: str,
    milestone_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    result = await db.execute(select(Milestone).where(Milestone.id == milestone_id, Milestone.grant_id == grant_id))
    m = result.scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Milestone not found")
    await db.delete(m)
    await db.commit()


# ── Gantt items ────────────────────────────────────────────────────────────────

class GanttItemCreate(BaseModel):
    title: str
    item_type: str = GanttItemType.TASK
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: str = "not_started"
    owner_id: Optional[str] = None
    linked_task_id: Optional[str] = None
    linked_milestone_id: Optional[str] = None
    dependency_ids: list[str] = []
    display_order: int = 0
    color_category: Optional[str] = None


class GanttItemUpdate(BaseModel):
    title: Optional[str] = None
    item_type: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: Optional[str] = None
    owner_id: Optional[str] = None
    linked_task_id: Optional[str] = None
    linked_milestone_id: Optional[str] = None
    dependency_ids: Optional[list[str]] = None
    display_order: Optional[int] = None
    color_category: Optional[str] = None


def _gantt_dict(g: GanttItem) -> dict:
    return _serialize(g, date_fields=["start_date", "end_date"], dt_fields=["created_at", "updated_at"])


@router.get("/{grant_id}/gantt")
async def list_gantt_items(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_grant_or_404(grant_id, db)
    result = await db.execute(
        select(GanttItem).where(GanttItem.grant_id == grant_id).order_by(GanttItem.display_order, GanttItem.start_date)
    )
    return [_gantt_dict(g) for g in result.scalars().all()]


@router.post("/{grant_id}/gantt", status_code=201)
async def create_gantt_item(
    grant_id: str,
    data: GanttItemCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    await _get_grant_or_404(grant_id, db)
    item = GanttItem(id=str(uuid.uuid4()), grant_id=grant_id, **data.model_dump())
    db.add(item)
    await db.commit()
    return _gantt_dict(item)


@router.post("/{grant_id}/gantt/generate")
async def generate_gantt(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    """Generate a default Gantt timeline from grant deadlines and tasks."""
    grant = await _get_grant_or_404(grant_id, db)
    tasks_result = await db.execute(
        select(Task).where(Task.grant_id == grant_id, Task.parent_task_id.is_(None))
    )
    tasks = tasks_result.scalars().all()

    existing = await db.execute(select(GanttItem).where(GanttItem.grant_id == grant_id))
    for item in existing.scalars().all():
        await db.delete(item)

    created = []
    for i, task in enumerate(tasks):
        item = GanttItem(
            id=str(uuid.uuid4()),
            grant_id=grant_id,
            linked_task_id=task.id,
            title=task.title,
            item_type=GanttItemType.TASK,
            start_date=task.start_date or task.due_date,
            end_date=task.due_date,
            status=task.status,
            owner_id=task.owner_id,
            display_order=i,
            color_category=task.task_type,
        )
        db.add(item)
        created.append(item.id)

    if grant.external_deadline:
        deadline_item = GanttItem(
            id=str(uuid.uuid4()),
            grant_id=grant_id,
            title="External Submission Deadline",
            item_type=GanttItemType.DEADLINE,
            start_date=grant.external_deadline,
            end_date=grant.external_deadline,
            status="upcoming",
            display_order=len(tasks),
            color_category="deadline",
        )
        db.add(deadline_item)
        created.append(deadline_item.id)

    if grant.internal_deadline:
        internal_item = GanttItem(
            id=str(uuid.uuid4()),
            grant_id=grant_id,
            title="Internal Review Deadline",
            item_type=GanttItemType.DEADLINE,
            start_date=grant.internal_deadline,
            end_date=grant.internal_deadline,
            status="upcoming",
            display_order=len(tasks) + 1,
            color_category="internal_deadline",
        )
        db.add(internal_item)
        created.append(internal_item.id)

    await log_activity(db, grant_id, "gantt_generated", current_user.id, description=f"Generated {len(created)} Gantt items")
    await db.commit()
    return {"generated": len(created), "item_ids": created}


@router.patch("/{grant_id}/gantt/{item_id}")
async def update_gantt_item(
    grant_id: str,
    item_id: str,
    data: GanttItemUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    result = await db.execute(select(GanttItem).where(GanttItem.id == item_id, GanttItem.grant_id == grant_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Gantt item not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(item, k, v)
    await db.commit()
    return _gantt_dict(item)


@router.delete("/{grant_id}/gantt/{item_id}", status_code=204)
async def delete_gantt_item(
    grant_id: str,
    item_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    result = await db.execute(select(GanttItem).where(GanttItem.id == item_id, GanttItem.grant_id == grant_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Gantt item not found")
    await db.delete(item)
    await db.commit()


# ── Workspace sections ─────────────────────────────────────────────────────────

class WorkspaceSectionCreate(BaseModel):
    title: str
    section_type: str = "other"
    requirement_text: Optional[str] = None
    word_limit: Optional[int] = None
    page_limit: Optional[float] = None
    owner_id: Optional[str] = None
    reviewer_id: Optional[str] = None
    status: str = WorkspaceSectionStatus.NOT_STARTED
    due_date: Optional[date] = None
    linked_document_url: Optional[str] = None
    notes: Optional[str] = None
    display_order: int = 0


class WorkspaceSectionUpdate(BaseModel):
    title: Optional[str] = None
    section_type: Optional[str] = None
    requirement_text: Optional[str] = None
    word_limit: Optional[int] = None
    page_limit: Optional[float] = None
    owner_id: Optional[str] = None
    reviewer_id: Optional[str] = None
    status: Optional[str] = None
    due_date: Optional[date] = None
    linked_document_url: Optional[str] = None
    current_word_count: Optional[int] = None
    compliance_status: Optional[str] = None
    notes: Optional[str] = None
    display_order: Optional[int] = None


def _section_dict(s: WorkspaceSection) -> dict:
    return _serialize(s, date_fields=["due_date"], dt_fields=["created_at", "updated_at"])


@router.get("/{grant_id}/workspace-sections")
async def list_workspace_sections(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_grant_or_404(grant_id, db)
    result = await db.execute(
        select(WorkspaceSection).where(WorkspaceSection.grant_id == grant_id).order_by(WorkspaceSection.display_order)
    )
    return [_section_dict(s) for s in result.scalars().all()]


@router.post("/{grant_id}/workspace-sections", status_code=201)
async def create_workspace_section(
    grant_id: str,
    data: WorkspaceSectionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    await _get_grant_or_404(grant_id, db)
    s = WorkspaceSection(id=str(uuid.uuid4()), grant_id=grant_id, **data.model_dump())
    db.add(s)
    await log_activity(db, grant_id, "section_created", current_user.id, "workspace_section", s.id, f"Section created: {data.title}")
    await db.commit()
    return _section_dict(s)


@router.patch("/{grant_id}/workspace-sections/{section_id}")
async def update_workspace_section(
    grant_id: str,
    section_id: str,
    data: WorkspaceSectionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    result = await db.execute(select(WorkspaceSection).where(WorkspaceSection.id == section_id, WorkspaceSection.grant_id == grant_id))
    s = result.scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Section not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(s, k, v)
    await log_activity(db, grant_id, "section_updated", current_user.id, "workspace_section", section_id)
    await db.commit()
    return _section_dict(s)


@router.delete("/{grant_id}/workspace-sections/{section_id}", status_code=204)
async def delete_workspace_section(
    grant_id: str,
    section_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    result = await db.execute(select(WorkspaceSection).where(WorkspaceSection.id == section_id, WorkspaceSection.grant_id == grant_id))
    s = result.scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Section not found")
    await db.delete(s)
    await db.commit()


# ── Checklist items ────────────────────────────────────────────────────────────

DEFAULT_CHECKLIST_ITEMS = [
    ("Final narrative complete", ChecklistCategory.NARRATIVE, True),
    ("Abstract complete", ChecklistCategory.NARRATIVE, True),
    ("Budget complete", ChecklistCategory.BUDGET, True),
    ("Budget justification complete", ChecklistCategory.BUDGET, True),
    ("Budget cap verified", ChecklistCategory.BUDGET, True),
    ("PI biosketch uploaded", ChecklistCategory.CVS, True),
    ("Partner letters uploaded", ChecklistCategory.LETTERS, True),
    ("Data management plan complete", ChecklistCategory.DATA_MANAGEMENT, True),
    ("Ethics section complete", ChecklistCategory.ETHICS, True),
    ("Indirect cost rate verified", ChecklistCategory.COMPLIANCE, True),
    ("Page limits checked", ChecklistCategory.FORMATTING, True),
    ("PDF formatting checked", ChecklistCategory.FORMATTING, True),
    ("Submission portal account active", ChecklistCategory.SUBMISSION_PORTAL, True),
    ("All required attachments uploaded", ChecklistCategory.SUBMISSION_PORTAL, True),
    ("Final PI approval received", ChecklistCategory.COMPLIANCE, True),
    ("Submission confirmation saved", ChecklistCategory.SUBMISSION_PORTAL, True),
]


class ChecklistItemCreate(BaseModel):
    title: str
    description: Optional[str] = None
    category: str = ChecklistCategory.GENERAL
    required: bool = True
    owner_id: Optional[str] = None
    due_date: Optional[date] = None
    status: str = ChecklistStatus.NOT_STARTED
    linked_document_url: Optional[str] = None
    evidence_url: Optional[str] = None
    notes: Optional[str] = None
    display_order: int = 0


class ChecklistItemUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    required: Optional[bool] = None
    owner_id: Optional[str] = None
    due_date: Optional[date] = None
    status: Optional[str] = None
    linked_document_url: Optional[str] = None
    evidence_url: Optional[str] = None
    notes: Optional[str] = None
    display_order: Optional[int] = None


def _checklist_dict(c: ChecklistItem) -> dict:
    return _serialize(c, date_fields=["due_date"], dt_fields=["created_at", "updated_at"])


@router.get("/{grant_id}/checklist")
async def list_checklist(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_grant_or_404(grant_id, db)
    result = await db.execute(
        select(ChecklistItem).where(ChecklistItem.grant_id == grant_id).order_by(ChecklistItem.display_order, ChecklistItem.category)
    )
    return [_checklist_dict(c) for c in result.scalars().all()]


@router.post("/{grant_id}/checklist", status_code=201)
async def create_checklist_item(
    grant_id: str,
    data: ChecklistItemCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    await _get_grant_or_404(grant_id, db)
    item = ChecklistItem(id=str(uuid.uuid4()), grant_id=grant_id, **data.model_dump())
    db.add(item)
    await log_activity(db, grant_id, "checklist_item_created", current_user.id, "checklist_item", item.id, f"Checklist item: {data.title}")
    await db.commit()
    return _checklist_dict(item)


@router.post("/{grant_id}/checklist/generate")
async def generate_checklist(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    """Generate a default submission checklist."""
    await _get_grant_or_404(grant_id, db)
    created = []
    for i, (title, category, required) in enumerate(DEFAULT_CHECKLIST_ITEMS):
        item = ChecklistItem(
            id=str(uuid.uuid4()),
            grant_id=grant_id,
            title=title,
            category=category,
            required=required,
            display_order=i,
        )
        db.add(item)
        created.append(title)
    await log_activity(db, grant_id, "checklist_generated", current_user.id, description=f"Generated {len(created)} checklist items")
    await db.commit()
    return {"generated": len(created), "items": created}


@router.patch("/{grant_id}/checklist/{item_id}")
async def update_checklist_item(
    grant_id: str,
    item_id: str,
    data: ChecklistItemUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    result = await db.execute(select(ChecklistItem).where(ChecklistItem.id == item_id, ChecklistItem.grant_id == grant_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Checklist item not found")
    updates = data.model_dump(exclude_none=True)
    for k, v in updates.items():
        setattr(item, k, v)
    if updates.get("status") == ChecklistStatus.COMPLETE:
        await log_activity(db, grant_id, "checklist_item_completed", current_user.id, "checklist_item", item_id, f"Completed: {item.title}")
    await db.commit()
    return _checklist_dict(item)


@router.delete("/{grant_id}/checklist/{item_id}", status_code=204)
async def delete_checklist_item(
    grant_id: str,
    item_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    result = await db.execute(select(ChecklistItem).where(ChecklistItem.id == item_id, ChecklistItem.grant_id == grant_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Checklist item not found")
    await db.delete(item)
    await db.commit()


# ── Workspace files ────────────────────────────────────────────────────────────

class WorkspaceFileCreate(BaseModel):
    file_name: str
    file_url: str
    file_type: Optional[str] = None
    file_category: str = FileCategory.OTHER
    source_type: str = FileSourceType.UPLOADED
    version: str = "1"
    owner_id: Optional[str] = None
    access_level: str = "team"
    ai_retrieval_allowed: bool = True
    description: Optional[str] = None
    tags: list[str] = []
    related_task_id: Optional[str] = None
    related_section_id: Optional[str] = None


class WorkspaceFileUpdate(BaseModel):
    file_name: Optional[str] = None
    file_url: Optional[str] = None
    file_type: Optional[str] = None
    file_category: Optional[str] = None
    source_type: Optional[str] = None
    version: Optional[str] = None
    owner_id: Optional[str] = None
    access_level: Optional[str] = None
    ai_retrieval_allowed: Optional[bool] = None
    description: Optional[str] = None
    tags: Optional[list[str]] = None
    related_task_id: Optional[str] = None
    related_section_id: Optional[str] = None


def _file_dict(f: WorkspaceFile) -> dict:
    return _serialize(f, dt_fields=["uploaded_at", "updated_at"])


@router.get("/{grant_id}/files")
async def list_files(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_grant_or_404(grant_id, db)
    result = await db.execute(
        select(WorkspaceFile).where(WorkspaceFile.grant_id == grant_id).order_by(desc(WorkspaceFile.uploaded_at))
    )
    return [_file_dict(f) for f in result.scalars().all()]


@router.post("/{grant_id}/files", status_code=201)
async def add_file(
    grant_id: str,
    data: WorkspaceFileCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    await _get_grant_or_404(grant_id, db)
    f = WorkspaceFile(id=str(uuid.uuid4()), grant_id=grant_id, uploaded_by=current_user.id, **data.model_dump())
    db.add(f)
    await log_activity(db, grant_id, "file_added", current_user.id, "workspace_file", f.id, f"File added: {data.file_name}")
    await db.commit()
    return _file_dict(f)


@router.patch("/{grant_id}/files/{file_id}")
async def update_file(
    grant_id: str,
    file_id: str,
    data: WorkspaceFileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    result = await db.execute(select(WorkspaceFile).where(WorkspaceFile.id == file_id, WorkspaceFile.grant_id == grant_id))
    f = result.scalar_one_or_none()
    if not f:
        raise HTTPException(404, "File not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(f, k, v)
    await db.commit()
    return _file_dict(f)


@router.delete("/{grant_id}/files/{file_id}", status_code=204)
async def delete_file(
    grant_id: str,
    file_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    result = await db.execute(select(WorkspaceFile).where(WorkspaceFile.id == file_id, WorkspaceFile.grant_id == grant_id))
    f = result.scalar_one_or_none()
    if not f:
        raise HTTPException(404, "File not found")
    await db.delete(f)
    await db.commit()


# ── Workspace partners ─────────────────────────────────────────────────────────

class PartnerCreate(BaseModel):
    institution_name: str
    contact_person: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    status: str = PartnerStatus.NOT_CONTACTED
    notes: Optional[str] = None


class PartnerUpdate(BaseModel):
    institution_name: Optional[str] = None
    contact_person: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class PartnerMaterialCreate(BaseModel):
    material_type: str
    title: str
    due_date: Optional[date] = None
    status: str = "not_requested"
    linked_file_url: Optional[str] = None
    notes: Optional[str] = None


class PartnerMaterialUpdate(BaseModel):
    material_type: Optional[str] = None
    title: Optional[str] = None
    due_date: Optional[date] = None
    status: Optional[str] = None
    linked_file_url: Optional[str] = None
    notes: Optional[str] = None


def _partner_dict(p: WorkspacePartner) -> dict:
    d = _serialize(p, dt_fields=["created_at", "updated_at"])
    d["materials"] = [_material_dict(m) for m in (p.materials or [])]
    return d


def _material_dict(m: PartnerMaterial) -> dict:
    return _serialize(m, date_fields=["due_date"], dt_fields=["created_at", "updated_at"])


@router.get("/{grant_id}/workspace-partners")
async def list_partners(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_grant_or_404(grant_id, db)
    result = await db.execute(select(WorkspacePartner).where(WorkspacePartner.grant_id == grant_id))
    partners = result.scalars().all()
    # Load materials for each partner
    for p in partners:
        materials_result = await db.execute(select(PartnerMaterial).where(PartnerMaterial.partner_id == p.id))
        p.materials = materials_result.scalars().all()
    return [_partner_dict(p) for p in partners]


@router.post("/{grant_id}/workspace-partners", status_code=201)
async def create_partner(
    grant_id: str,
    data: PartnerCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    await _get_grant_or_404(grant_id, db)
    p = WorkspacePartner(id=str(uuid.uuid4()), grant_id=grant_id, **data.model_dump())
    db.add(p)
    await log_activity(db, grant_id, "partner_added", current_user.id, "workspace_partner", p.id, f"Partner added: {data.institution_name}")
    await db.commit()
    p.materials = []
    return _partner_dict(p)


@router.patch("/{grant_id}/workspace-partners/{partner_id}")
async def update_partner(
    grant_id: str,
    partner_id: str,
    data: PartnerUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    result = await db.execute(select(WorkspacePartner).where(WorkspacePartner.id == partner_id, WorkspacePartner.grant_id == grant_id))
    p = result.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Partner not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(p, k, v)
    await log_activity(db, grant_id, "partner_updated", current_user.id, "workspace_partner", partner_id)
    await db.commit()
    materials_result = await db.execute(select(PartnerMaterial).where(PartnerMaterial.partner_id == partner_id))
    p.materials = materials_result.scalars().all()
    return _partner_dict(p)


@router.delete("/{grant_id}/workspace-partners/{partner_id}", status_code=204)
async def delete_partner(
    grant_id: str,
    partner_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    result = await db.execute(select(WorkspacePartner).where(WorkspacePartner.id == partner_id, WorkspacePartner.grant_id == grant_id))
    p = result.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Partner not found")
    await db.delete(p)
    await db.commit()


@router.post("/{grant_id}/workspace-partners/{partner_id}/materials", status_code=201)
async def add_partner_material(
    grant_id: str,
    partner_id: str,
    data: PartnerMaterialCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    result = await db.execute(select(WorkspacePartner).where(WorkspacePartner.id == partner_id, WorkspacePartner.grant_id == grant_id))
    if not result.scalar_one_or_none():
        raise HTTPException(404, "Partner not found")
    m = PartnerMaterial(id=str(uuid.uuid4()), partner_id=partner_id, grant_id=grant_id, **data.model_dump())
    db.add(m)
    await db.commit()
    return _material_dict(m)


@router.patch("/{grant_id}/workspace-partners/{partner_id}/materials/{material_id}")
async def update_partner_material(
    grant_id: str,
    partner_id: str,
    material_id: str,
    data: PartnerMaterialUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    result = await db.execute(select(PartnerMaterial).where(PartnerMaterial.id == material_id, PartnerMaterial.partner_id == partner_id))
    m = result.scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Material not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(m, k, v)
    await db.commit()
    return _material_dict(m)


@router.delete("/{grant_id}/workspace-partners/{partner_id}/materials/{material_id}", status_code=204)
async def delete_partner_material(
    grant_id: str,
    partner_id: str,
    material_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    result = await db.execute(select(PartnerMaterial).where(PartnerMaterial.id == material_id, PartnerMaterial.partner_id == partner_id))
    m = result.scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Material not found")
    await db.delete(m)
    await db.commit()


# ── Budget tracker ─────────────────────────────────────────────────────────────

class BudgetUpdate(BaseModel):
    requested_amount: Optional[float] = None
    maximum_amount: Optional[float] = None
    currency: Optional[str] = None
    budget_owner_id: Optional[str] = None
    status: Optional[str] = None
    spreadsheet_url: Optional[str] = None
    justification_url: Optional[str] = None
    indirect_cost_rule: Optional[str] = None
    cost_share_required: Optional[bool] = None
    notes: Optional[str] = None


def _budget_dict(b: BudgetTracker) -> dict:
    return _serialize(b, dt_fields=["created_at", "updated_at"])


@router.get("/{grant_id}/budget")
async def get_budget(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_grant_or_404(grant_id, db)
    result = await db.execute(select(BudgetTracker).where(BudgetTracker.grant_id == grant_id))
    b = result.scalar_one_or_none()
    if not b:
        b = BudgetTracker(id=str(uuid.uuid4()), grant_id=grant_id)
        db.add(b)
        await db.commit()
    return _budget_dict(b)


@router.patch("/{grant_id}/budget")
async def update_budget(
    grant_id: str,
    data: BudgetUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    await _get_grant_or_404(grant_id, db)
    result = await db.execute(select(BudgetTracker).where(BudgetTracker.grant_id == grant_id))
    b = result.scalar_one_or_none()
    if not b:
        b = BudgetTracker(id=str(uuid.uuid4()), grant_id=grant_id)
        db.add(b)
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(b, k, v)
    await log_activity(db, grant_id, "budget_updated", current_user.id, "budget_tracker", b.id)
    await db.commit()
    return _budget_dict(b)


# ── Gantt PDF export ───────────────────────────────────────────────────────────

@router.get("/{grant_id}/gantt/export-pdf")
async def export_gantt_pdf(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Render the Gantt chart as a landscape A4 PDF and stream it to the client."""
    grant = await _get_grant_or_404(grant_id, db)
    result = await db.execute(
        select(GanttItem)
        .where(GanttItem.grant_id == grant_id)
        .order_by(GanttItem.display_order, GanttItem.start_date)
    )
    items = result.scalars().all()

    from app.services.pdf_export import generate_gantt_pdf

    try:
        pdf_bytes = await generate_gantt_pdf(grant.title, items)
    except Exception as exc:
        raise HTTPException(500, f"PDF generation failed: {exc}") from exc

    import io
    filename = f"gantt-{grant_id[:8]}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Budget spreadsheet parsing ─────────────────────────────────────────────────

class BudgetLineItem(BaseModel):
    description: str
    category: Optional[str] = None
    quantity: Optional[float] = None
    unit_cost: Optional[float] = None
    total: Optional[float] = None


@router.post("/{grant_id}/budget/parse-spreadsheet")
async def parse_budget_spreadsheet(
    grant_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    """Parse an uploaded XLSX/CSV budget spreadsheet and return line items."""
    await _get_grant_or_404(grant_id, db)

    allowed_extensions = {"xlsx", "xls", "csv"}
    ext = (file.filename or "").rsplit(".", 1)[-1].lower()
    if ext not in allowed_extensions:
        raise HTTPException(400, f"Unsupported file type '.{ext}'. Use XLSX or CSV.")

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 10 MB).")

    from app.services.budget_parser import parse_budget_file

    try:
        items = parse_budget_file(content, file.filename or "budget.xlsx")
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    return {"items": items, "count": len(items)}


@router.post("/{grant_id}/budget/generate-line-items")
async def generate_budget_line_items(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    """Use AI to generate call-aligned budget line items from grant call requirements and tasks."""
    from sqlalchemy import select as sa_select
    grant = await _get_grant_or_404(grant_id, db)

    # Gather context
    call_requirements = getattr(grant, "call_requirements", None) or ""
    call_analysis = getattr(grant, "call_analysis", None) or {}
    requested_amount = getattr(grant, "requested_amount", None)
    currency = getattr(grant, "currency", "USD") or "USD"

    # Fetch tasks for effort-based cost anchoring
    tasks_result = await db.execute(
        sa_select(Task).where(Task.grant_id == grant_id)
    )
    tasks = tasks_result.scalars().all()
    task_summaries = [
        f"- {t.title} (type: {t.task_type}, effort: {t.estimated_effort}h, status: {t.status})"
        for t in tasks
        if t.title
    ]

    # Fetch budget tracker for cap info
    budget_result = await db.execute(
        sa_select(BudgetTracker).where(BudgetTracker.grant_id == grant_id)
    )
    budget = budget_result.scalar_one_or_none()
    max_amount = getattr(budget, "maximum_amount", None) if budget else None

    system_prompt = (
        "You are an expert grant budget analyst. "
        "Generate a detailed, call-aligned budget in JSON format based on the provided grant information. "
        "Return ONLY valid JSON with the structure: "
        '{"items": [...], "total": <number>, "compliance_summary": "<string>"}. '
        "Each item must have: description, category, quantity, unit_cost, total, "
        "call_requirement_ref (the specific call section or requirement this line satisfies, or null), "
        "compliance_note (brief note on alignment with call rules, or null). "
        "Use the funder's own budget category names if inferable from the call. "
        "Respect any stated budget caps or allowable cost rules."
    )

    amount_ctx = f"Requested amount: {currency} {requested_amount:,.0f}" if requested_amount else ""
    cap_ctx = f"Maximum allowed: {currency} {max_amount:,.0f}" if max_amount else ""
    call_analysis_text = str(call_analysis)[:2000] if call_analysis else ""

    user_message = f"""Grant: {grant.title}
Funder: {getattr(grant, 'funder', '') or ''}
Currency: {currency}
{amount_ctx}
{cap_ctx}

Call Requirements:
{call_requirements[:3000] if call_requirements else 'Not provided.'}

Call Analysis Summary:
{call_analysis_text if call_analysis_text else 'Not available.'}

Tasks (for effort-based cost estimation):
{chr(10).join(task_summaries[:40]) if task_summaries else 'No tasks defined.'}

Generate a realistic, detailed budget with line items aligned to the call's requirements and budget categories."""

    from app.ai.client import chat_complete
    import json

    try:
        response_text = await chat_complete(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            temperature=0.2,
            max_tokens=4096,
            agent_name="budget_generator",
            json_mode=True,
        )
        data = json.loads(response_text)
        items = data.get("items", [])
        total = data.get("total", sum(i.get("total") or 0 for i in items))
        compliance_summary = data.get("compliance_summary", "")
    except Exception as exc:
        raise HTTPException(500, f"AI generation failed: {exc}") from exc

    # Normalise item fields
    normalised = []
    for item in items:
        normalised.append({
            "description": str(item.get("description", "")),
            "category": item.get("category"),
            "quantity": item.get("quantity"),
            "unit_cost": item.get("unit_cost"),
            "total": item.get("total"),
            "call_requirement_ref": item.get("call_requirement_ref"),
            "compliance_note": item.get("compliance_note"),
        })

    return {"items": normalised, "total": total, "compliance_summary": compliance_summary}


# ── Google Drive folder creation ───────────────────────────────────────────────

@router.post("/{grant_id}/drive/create-folder")
async def create_drive_folder(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    """Create a structured Google Drive folder tree for this grant and store the URL."""
    grant = await _get_grant_or_404(grant_id, db)

    from app.config import get_settings

    settings = get_settings()
    drive_cfg = settings.google_drive
    svc_account_file = drive_cfg.service_account_file
    parent_folder_id = drive_cfg.parent_folder_id

    if not svc_account_file or not parent_folder_id:
        raise HTTPException(
            503,
            "Google Drive is not configured. Set google_drive.service_account_file "
            "and google_drive.parent_folder_id in config.yaml.",
        )

    from app.services.google_drive import create_grant_folder_tree

    try:
        result = create_grant_folder_tree(grant.title, svc_account_file, parent_folder_id)
    except Exception as exc:
        raise HTTPException(502, f"Google Drive API error: {exc}") from exc

    # Persist the folder URL on the grant record
    grant.drive_folder_url = result["root_folder_url"]
    await log_activity(
        db,
        grant_id,
        "drive_folder_created",
        current_user.id,
        description=f"Drive folder created: {result['root_folder_url']}",
    )
    await db.commit()

    return {
        "root_folder_id": result["root_folder_id"],
        "root_folder_url": result["root_folder_url"],
    }


# ── Unified editor-document ────────────────────────────────────────────────────

class EditorDocumentUpdate(BaseModel):
    content_html: str
    sync_sections: bool = True  # auto-upsert WorkspaceSection rows from headings


@router.patch("/{grant_id}/editor-document")
async def save_editor_document(
    grant_id: str,
    body: EditorDocumentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    """Save the unified grant document HTML and optionally sync workspace sections."""
    grant = await _get_grant_or_404(grant_id, db)
    grant.editor_document = body.content_html

    if body.sync_sections:
        headings = _extract_headings_from_html(body.content_html)
        await _sync_workspace_sections_from_headings(grant_id, headings, db)

    await db.commit()
    return {"ok": True}


def _extract_headings_from_html(html: str) -> list[str]:
    """Return ordered list of H2 heading text values from HTML."""
    from html.parser import HTMLParser

    class _HeadingParser(HTMLParser):
        def __init__(self) -> None:
            super().__init__()
            self.headings: list[str] = []
            self._in_h2 = False
            self._buf = ""

        def handle_starttag(self, tag: str, attrs: list) -> None:
            if tag.lower() == "h2":
                self._in_h2 = True
                self._buf = ""

        def handle_endtag(self, tag: str) -> None:
            if tag.lower() == "h2" and self._in_h2:
                self._in_h2 = False
                text = self._buf.strip()
                if text:
                    self.headings.append(text)

        def handle_data(self, data: str) -> None:
            if self._in_h2:
                self._buf += data

    parser = _HeadingParser()
    parser.feed(html or "")
    return parser.headings


async def _sync_workspace_sections_from_headings(
    grant_id: str,
    headings: list[str],
    db: AsyncSession,
) -> None:
    """Upsert WorkspaceSection rows to match the current H2 headings."""
    result = await db.execute(
        select(WorkspaceSection).where(WorkspaceSection.grant_id == grant_id)
    )
    existing = {s.title: s for s in result.scalars().all()}

    for order, title in enumerate(headings):
        if title in existing:
            existing[title].display_order = order
        else:
            db.add(
                WorkspaceSection(
                    id=str(uuid.uuid4()),
                    grant_id=grant_id,
                    title=title,
                    section_type="other",
                    display_order=order,
                )
            )


# ── Google Docs sync ───────────────────────────────────────────────────────────

def _get_drive_config():
    import os
    from app.config import get_settings
    settings = get_settings()
    cfg = settings.google_drive

    if not cfg.enabled:
        raise HTTPException(
            503,
            "Google Drive/Docs integration is disabled. "
            "Set google_drive.enabled: true and configure service_account_file in config.yaml.",
        )
    placeholder = "/path/to/service-account.json"
    if not cfg.service_account_file or cfg.service_account_file == placeholder:
        raise HTTPException(
            503,
            "Google Drive service account not configured. "
            "Set google_drive.service_account_file to a valid path in config.yaml.",
        )
    if not os.path.exists(cfg.service_account_file):
        raise HTTPException(
            503,
            f"Google Drive service account file not found at: {cfg.service_account_file}",
        )
    return cfg


@router.get("/{grant_id}/docs/status")
async def get_docs_status(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    grant = await _get_grant_or_404(grant_id, db)
    return {
        "doc_id": grant.google_doc_id,
        "doc_url": grant.google_doc_url,
        "last_synced": grant.google_doc_last_synced.isoformat() if grant.google_doc_last_synced else None,
        "linked": bool(grant.google_doc_id),
    }


@router.post("/{grant_id}/docs/create")
async def create_google_doc(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    """Create a Google Doc for this grant (or return existing) and link it."""
    grant = await _get_grant_or_404(grant_id, db)

    if grant.google_doc_id:
        return {
            "doc_id": grant.google_doc_id,
            "doc_url": grant.google_doc_url,
            "created": False,
        }

    cfg = _get_drive_config()
    from app.services.google_docs import create_grant_doc

    # Use the grant's Drive folder id if available (extract from folder URL)
    parent_folder_id: str | None = None
    if grant.drive_folder_url and "folders/" in grant.drive_folder_url:
        parent_folder_id = grant.drive_folder_url.split("folders/")[-1].split("?")[0]

    try:
        result = create_grant_doc(
            title=grant.title,
            content_html=grant.editor_document or "",
            service_account_file=cfg.service_account_file,
            parent_folder_id=parent_folder_id,
        )
    except Exception as exc:
        raise HTTPException(502, f"Google Docs API error: {exc}") from exc

    now = datetime.utcnow()
    grant.google_doc_id = result["doc_id"]
    grant.google_doc_url = result["doc_url"]
    grant.google_doc_last_synced = now

    await log_activity(
        db, grant_id, "google_doc_created", current_user.id,
        description=f"Google Doc created: {result['doc_url']}",
    )
    await db.commit()

    return {
        "doc_id": result["doc_id"],
        "doc_url": result["doc_url"],
        "created": True,
    }


@router.post("/{grant_id}/docs/link")
async def link_google_doc(
    grant_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    """Link an existing Google Doc URL to this grant."""
    doc_url: str = body.get("doc_url", "").strip()
    if not doc_url:
        raise HTTPException(400, "doc_url is required")

    # Extract doc ID from URL if present
    doc_id: str | None = None
    if "/d/" in doc_url:
        doc_id = doc_url.split("/d/")[1].split("/")[0]

    grant = await _get_grant_or_404(grant_id, db)
    grant.google_doc_id = doc_id
    grant.google_doc_url = doc_url
    grant.google_doc_last_synced = datetime.utcnow()

    await log_activity(
        db, grant_id, "google_doc_linked", current_user.id,
        description=f"Google Doc linked: {doc_url}",
    )
    await db.commit()
    return {"doc_id": doc_id, "doc_url": doc_url, "linked": True}


@router.delete("/{grant_id}/docs/unlink")
async def unlink_google_doc(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    """Remove the Google Doc link from this grant."""
    grant = await _get_grant_or_404(grant_id, db)
    grant.google_doc_id = None
    grant.google_doc_url = None
    grant.google_doc_last_synced = None
    await db.commit()
    return {"unlinked": True}


@router.post("/{grant_id}/docs/push")
async def push_to_google_doc(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    """Push current editor_document HTML to the linked Google Doc."""
    grant = await _get_grant_or_404(grant_id, db)

    if not grant.google_doc_id:
        raise HTTPException(400, "No Google Doc linked. Create one first via POST /docs/create.")
    if not grant.editor_document:
        raise HTTPException(400, "No document content to push.")

    cfg = _get_drive_config()
    from app.services.google_docs import push_to_doc

    try:
        push_to_doc(
            doc_id=grant.google_doc_id,
            content_html=grant.editor_document,
            service_account_file=cfg.service_account_file,
        )
    except Exception as exc:
        raise HTTPException(502, f"Google Docs API error: {exc}") from exc

    now = datetime.utcnow()
    grant.google_doc_last_synced = now
    await log_activity(
        db, grant_id, "google_doc_pushed", current_user.id,
        description="Document pushed to Google Docs",
    )
    await db.commit()

    return {"ok": True, "last_synced": now.isoformat()}


@router.post("/{grant_id}/docs/pull")
async def pull_from_google_doc(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    """Pull content from the linked Google Doc and update editor_document."""
    grant = await _get_grant_or_404(grant_id, db)

    if not grant.google_doc_id:
        raise HTTPException(400, "No Google Doc linked. Create one first via POST /docs/create.")

    cfg = _get_drive_config()
    from app.services.google_docs import pull_from_doc

    try:
        html = pull_from_doc(
            doc_id=grant.google_doc_id,
            service_account_file=cfg.service_account_file,
        )
    except Exception as exc:
        raise HTTPException(502, f"Google Docs API error: {exc}") from exc

    grant.editor_document = html
    now = datetime.utcnow()
    grant.google_doc_last_synced = now

    # Sync workspace sections from updated headings
    headings = _extract_headings_from_html(html)
    await _sync_workspace_sections_from_headings(grant_id, headings, db)

    await log_activity(
        db, grant_id, "google_doc_pulled", current_user.id,
        description="Document pulled from Google Docs",
    )
    await db.commit()

    return {"ok": True, "content_html": html, "last_synced": now.isoformat()}


@router.get("/{grant_id}/docs/content")
async def get_google_doc_content(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the linked Google Doc content as plain text (for AI context or preview)."""
    grant = await _get_grant_or_404(grant_id, db)

    if not grant.google_doc_id:
        raise HTTPException(400, "No Google Doc linked.")

    cfg = _get_drive_config()
    from app.services.google_docs import read_document_as_text

    try:
        text = read_document_as_text(
            doc_id=grant.google_doc_id,
            service_account_file=cfg.service_account_file,
        )
    except Exception as exc:
        raise HTTPException(502, f"Google Docs API error: {exc}") from exc

    return {"text": text, "word_count": len(text.split()), "google_doc_url": grant.google_doc_url}


# ── Activity log ───────────────────────────────────────────────────────────────

@router.get("/{grant_id}/activity")
async def get_activity(
    grant_id: str,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_grant_or_404(grant_id, db)
    result = await db.execute(
        select(GrantActivityLog)
        .where(GrantActivityLog.grant_id == grant_id)
        .order_by(desc(GrantActivityLog.timestamp))
        .limit(limit)
    )
    entries = result.scalars().all()
    return [_serialize(e, dt_fields=["timestamp"]) for e in entries]


# ── Workspace summary (for dashboard) ─────────────────────────────────────────

@router.get("/{grant_id}/workspace-summary")
async def get_workspace_summary(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return aggregated counts for the workspace dashboard."""
    grant = await _get_grant_or_404(grant_id, db)

    tasks_result = await db.execute(select(Task).where(Task.grant_id == grant_id, Task.parent_task_id.is_(None)))
    tasks = tasks_result.scalars().all()

    from datetime import date as date_type
    today = date_type.today()

    total_tasks = len(tasks)
    complete_tasks = sum(1 for t in tasks if t.status == TaskStatus.COMPLETE)
    overdue_tasks = sum(1 for t in tasks if t.due_date and t.due_date < today and t.status != TaskStatus.COMPLETE)
    blocked_tasks = sum(1 for t in tasks if t.status == TaskStatus.BLOCKED)
    due_this_week_tasks = sum(1 for t in tasks if t.due_date and 0 <= (t.due_date - today).days <= 7 and t.status != TaskStatus.COMPLETE)

    sections_result = await db.execute(select(WorkspaceSection).where(WorkspaceSection.grant_id == grant_id))
    sections = sections_result.scalars().all()
    total_sections = len(sections)
    complete_sections = sum(1 for s in sections if s.status in (WorkspaceSectionStatus.FINALIZED, WorkspaceSectionStatus.SUBMITTED, WorkspaceSectionStatus.APPROVED))

    checklist_result = await db.execute(select(ChecklistItem).where(ChecklistItem.grant_id == grant_id, ChecklistItem.required == True))
    checklist = checklist_result.scalars().all()
    total_checklist = len(checklist)
    complete_checklist = sum(1 for c in checklist if c.status == ChecklistStatus.COMPLETE)

    milestones_result = await db.execute(select(Milestone).where(Milestone.grant_id == grant_id))
    milestones = milestones_result.scalars().all()
    upcoming_milestones = [_milestone_dict(m) for m in milestones if m.status == MilestoneStatus.UPCOMING and m.target_date]

    partners_result = await db.execute(select(WorkspacePartner).where(WorkspacePartner.grant_id == grant_id))
    partners = partners_result.scalars().all()
    pending_partners = sum(1 for p in partners if p.status not in (PartnerStatus.COMPLETE, PartnerStatus.DROPPED))

    budget_result = await db.execute(select(BudgetTracker).where(BudgetTracker.grant_id == grant_id))
    budget = budget_result.scalar_one_or_none()

    days_to_external = (grant.external_deadline - today).days if grant.external_deadline else None
    days_to_internal = (grant.internal_deadline - today).days if grant.internal_deadline else None

    completion_pct = 0
    if total_tasks > 0:
        completion_pct = round((complete_tasks / total_tasks) * 100)

    return {
        "grant_id": grant_id,
        "title": grant.title,
        "funder": grant.funder,
        "status": grant.status,
        "external_deadline": str(grant.external_deadline) if grant.external_deadline else None,
        "internal_deadline": str(grant.internal_deadline) if grant.internal_deadline else None,
        "days_to_external_deadline": days_to_external,
        "days_to_internal_deadline": days_to_internal,
        "total_tasks": total_tasks,
        "complete_tasks": complete_tasks,
        "overdue_tasks": overdue_tasks,
        "blocked_tasks": blocked_tasks,
        "due_this_week_tasks": due_this_week_tasks,
        "completion_percentage": completion_pct,
        "total_sections": total_sections,
        "complete_sections": complete_sections,
        "total_checklist_items": total_checklist,
        "complete_checklist_items": complete_checklist,
        "pending_partners": pending_partners,
        "upcoming_milestones": upcoming_milestones[:3],
        "budget_status": budget.status if budget else BudgetStatus.NOT_STARTED,
    }

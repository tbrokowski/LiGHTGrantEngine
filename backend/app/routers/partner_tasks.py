"""Partner Tasks — CRUD for the partner task system."""
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, desc, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.routers.auth import get_current_user

router = APIRouter()
# Tasks across every partner and group — mounted at /partner-tasks.
board_router = APIRouter()


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    priority: str = "normal"
    due_date: Optional[datetime] = None
    assigned_to: Optional[str] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    due_date: Optional[datetime] = None
    assigned_to: Optional[str] = None


def _task_dict(t, assignee_name: str | None = None) -> dict:
    return {
        "id": t.id,
        "partner_id": t.partner_id,
        "group_id": t.group_id,
        "title": t.title,
        "description": t.description,
        "priority": t.priority,
        "status": t.status,
        "due_date": str(t.due_date) if t.due_date else None,
        "assigned_to": t.assigned_to,
        "assignee_name": assignee_name,
        "created_by": t.created_by,
        "completed_at": str(t.completed_at) if t.completed_at else None,
        "created_at": str(t.created_at) if t.created_at else None,
        "updated_at": str(t.updated_at) if t.updated_at else None,
    }


async def task_dicts(tasks, db: AsyncSession) -> list[dict]:
    """Serialize tasks with assignee, partner and group names resolved in bulk."""
    from app.models.partner import Partner
    from app.models.partner_group import PartnerGroup
    from app.models.user import User as UserModel

    tasks = list(tasks)
    uids = {t.assigned_to for t in tasks if t.assigned_to}
    pids = {t.partner_id for t in tasks if t.partner_id}
    gids = {t.group_id for t in tasks if t.group_id}
    users = dict((await db.execute(select(UserModel.id, UserModel.name).where(UserModel.id.in_(uids)))).all()) if uids else {}
    partners = dict((await db.execute(select(Partner.id, Partner.name).where(Partner.id.in_(pids)))).all()) if pids else {}
    groups = {gid: (name, color) for gid, name, color in (await db.execute(
        select(PartnerGroup.id, PartnerGroup.name, PartnerGroup.color).where(PartnerGroup.id.in_(gids))
    )).all()} if gids else {}
    out = []
    for t in tasks:
        d = _task_dict(t, users.get(t.assigned_to or ""))
        d["partner_name"] = partners.get(t.partner_id or "")
        g = groups.get(t.group_id or "")
        d["group_name"], d["group_color"] = (g if g else (None, None))
        out.append(d)
    return out


@router.get("/{partner_id}/tasks")
async def list_tasks(
    partner_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.models.partner_task import PartnerTask
    from app.models.user import User as UserModel

    tasks = (await db.execute(
        select(PartnerTask)
        .where(PartnerTask.partner_id == partner_id)
        .order_by(PartnerTask.status, PartnerTask.due_date.asc().nullslast(), desc(PartnerTask.created_at))
    )).scalars().all()

    # Resolve assignee names in one query
    assignee_ids = list({t.assigned_to for t in tasks if t.assigned_to})
    name_map: dict[str, str] = {}
    if assignee_ids:
        users = (await db.execute(
            select(UserModel).where(UserModel.id.in_(assignee_ids))
        )).scalars().all()
        name_map = {u.id: u.name for u in users}

    return [_task_dict(t, name_map.get(t.assigned_to or "")) for t in tasks]


@router.post("/{partner_id}/tasks", status_code=201)
async def create_task(
    partner_id: str,
    data: TaskCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.models.partner_task import PartnerTask
    from app.models.partner import Partner

    partner = (await db.execute(select(Partner).where(Partner.id == partner_id))).scalar_one_or_none()
    if not partner:
        raise HTTPException(404, "Partner not found")

    task = PartnerTask(
        id=str(uuid.uuid4()),
        partner_id=partner_id,
        created_by=current_user.id,
        institution_id=getattr(current_user, "institution_id", None),
        **data.model_dump(),
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return _task_dict(task)


@router.patch("/{partner_id}/tasks/{task_id}")
async def update_task(
    partner_id: str,
    task_id: str,
    data: TaskUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.models.partner_task import PartnerTask

    task = (await db.execute(
        select(PartnerTask).where(PartnerTask.id == task_id, PartnerTask.partner_id == partner_id)
    )).scalar_one_or_none()
    if not task:
        raise HTTPException(404, "Task not found")

    for k, v in data.model_dump(exclude_none=True).items():
        setattr(task, k, v)
    await db.commit()
    await db.refresh(task)
    return _task_dict(task)


@router.post("/{partner_id}/tasks/{task_id}/complete")
async def complete_task(
    partner_id: str,
    task_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.models.partner_task import PartnerTask

    task = (await db.execute(
        select(PartnerTask).where(PartnerTask.id == task_id, PartnerTask.partner_id == partner_id)
    )).scalar_one_or_none()
    if not task:
        raise HTTPException(404, "Task not found")

    task.status = "done"
    task.completed_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(task)
    return _task_dict(task)


@router.delete("/{partner_id}/tasks/{task_id}", status_code=204)
async def delete_task(
    partner_id: str,
    task_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.models.partner_task import PartnerTask

    task = (await db.execute(
        select(PartnerTask).where(PartnerTask.id == task_id, PartnerTask.partner_id == partner_id)
    )).scalar_one_or_none()
    if not task:
        raise HTTPException(404, "Task not found")

    await db.delete(task)
    await db.commit()


# ── Task board: every partner and group task ───────────────────────────────────

class BoardTaskCreate(TaskCreate):
    partner_id: Optional[str] = None
    group_id: Optional[str] = None


async def _board_task(task_id: str, db: AsyncSession):
    from app.models.partner_task import PartnerTask
    t = (await db.execute(select(PartnerTask).where(PartnerTask.id == task_id))).scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Task not found")
    return t


@board_router.get("/")
async def list_all_tasks(
    scope: Literal["mine", "team", "unassigned"] = "mine",
    include_done: bool = False,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Open tasks on any partner or group: assigned to me, to anyone, or to no one.
    Overdue first, then by due date; recently completed ones follow when asked."""
    from app.models.partner_task import PartnerTask

    stmt = select(PartnerTask)
    if scope == "mine":
        stmt = stmt.where(PartnerTask.assigned_to == current_user.id)
    elif scope == "unassigned":
        stmt = stmt.where(PartnerTask.assigned_to.is_(None))
    if include_done:
        since = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        stmt = stmt.where(or_(PartnerTask.status.in_(["open", "in_progress"]), PartnerTask.completed_at >= since))
    else:
        stmt = stmt.where(PartnerTask.status.in_(["open", "in_progress"]))
    stmt = stmt.order_by(PartnerTask.due_date.asc().nullslast(), desc(PartnerTask.created_at)).limit(min(limit, 200))
    tasks = (await db.execute(stmt)).scalars().all()
    # Done tasks sink below open ones.
    tasks.sort(key=lambda t: t.status == "done")
    return await task_dicts(tasks, db)


@board_router.post("/", status_code=201)
async def create_board_task(
    data: BoardTaskCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user),
):
    """Create a task on a partner or a group (exactly one)."""
    from app.models.partner import Partner
    from app.models.partner_group import PartnerGroup
    from app.models.partner_task import PartnerTask

    if bool(data.partner_id) == bool(data.group_id):
        raise HTTPException(400, "Pick either a partner or a group for this task.")
    if data.partner_id and not (await db.execute(select(Partner.id).where(Partner.id == data.partner_id))).scalar():
        raise HTTPException(404, "Partner not found")
    if data.group_id and not (await db.execute(select(PartnerGroup.id).where(PartnerGroup.id == data.group_id))).scalar():
        raise HTTPException(404, "Group not found")
    t = PartnerTask(
        id=str(uuid.uuid4()), created_by=current_user.id,
        institution_id=getattr(current_user, "institution_id", None), **data.model_dump(),
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return (await task_dicts([t], db))[0]


@board_router.patch("/{task_id}")
async def update_board_task(
    task_id: str, data: TaskUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user),
):
    t = await _board_task(task_id, db)
    fields = data.model_dump(exclude_unset=True)
    for k, v in fields.items():
        setattr(t, k, v)
    if "status" in fields:
        t.completed_at = datetime.now(timezone.utc) if t.status == "done" else None
    await db.commit()
    await db.refresh(t)
    return (await task_dicts([t], db))[0]


@board_router.delete("/{task_id}", status_code=204)
async def delete_board_task(
    task_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user),
):
    t = await _board_task(task_id, db)
    await db.delete(t)
    await db.commit()

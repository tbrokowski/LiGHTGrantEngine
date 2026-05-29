"""Partner Tasks — CRUD for the partner task system."""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.routers.auth import get_current_user

router = APIRouter()


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

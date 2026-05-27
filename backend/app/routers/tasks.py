"""Cross-grant task endpoints (my tasks, overdue, etc.) — scoped to institution."""
from typing import Optional
from datetime import date, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.task import Task
from app.models.active_grant import ActiveGrant
from app.models.grant_member import GrantMember, GrantMemberStatus
from app.models.user import User
from app.routers.auth import get_current_user
from app.auth.permissions import is_org_admin

router = APIRouter()

@router.get("/my-tasks")
async def my_tasks(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = (
        select(Task, ActiveGrant.title.label("grant_title"))
        .join(ActiveGrant, Task.grant_id == ActiveGrant.id)
        .where(
            or_(Task.owner_id == current_user.id, Task.assignee_ids.cast(str).contains(current_user.id)),
            Task.status.notin_(["complete", "dropped"]),
        )
    )
    result = await db.execute(q)
    rows = result.all()
    return [{**_task_dict(t), "grant_title": grant_title} for t, grant_title in rows]

@router.get("/overdue")
async def overdue_tasks(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    today = date.today()
    # Build accessible grant filter
    accessible_grant_ids = await _get_accessible_grant_ids(current_user, db)
    q = select(Task).where(
        Task.grant_id.in_(accessible_grant_ids),
        Task.due_date < today,
        Task.status.notin_(["complete","dropped"]),
    )
    result = await db.execute(q)
    return [_task_dict(t) for t in result.scalars().all()]

@router.get("/due-soon")
async def tasks_due_soon(days: int = 7, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    today = date.today()
    cutoff = today + timedelta(days=days)
    accessible_grant_ids = await _get_accessible_grant_ids(current_user, db)
    q = select(Task).where(
        Task.grant_id.in_(accessible_grant_ids),
        Task.due_date >= today,
        Task.due_date <= cutoff,
        Task.status.notin_(["complete","dropped"]),
    )
    result = await db.execute(q)
    return [_task_dict(t) for t in result.scalars().all()]


async def _get_accessible_grant_ids(user: User, db: AsyncSession) -> list[str]:
    """Return grant IDs the user can see, scoped to their institution."""
    inst_id = user.institution_id
    q = select(ActiveGrant.id)
    if inst_id:
        q = q.where(ActiveGrant.institution_id == inst_id)
    if not is_org_admin(user):
        member_ids = (await db.execute(
            select(GrantMember.grant_id).where(
                GrantMember.user_id == user.id,
                GrantMember.status == GrantMemberStatus.ACCEPTED,
            )
        )).scalars().all()
        q = q.where(ActiveGrant.id.in_(member_ids))
    return list((await db.execute(q)).scalars().all())

def _task_dict(t: Task) -> dict:
    d = {c.name: getattr(t, c.name) for c in t.__table__.columns}
    for f in ["due_date", "created_at", "completed_at"]:
        if d.get(f):
            d[f] = str(d[f])
    return d

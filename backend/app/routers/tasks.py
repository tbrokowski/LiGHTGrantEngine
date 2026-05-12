"""Cross-grant task endpoints (my tasks, overdue, etc.)."""
from typing import Optional
from datetime import date
from fastapi import APIRouter, Depends
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.task import Task
from app.models.user import User
from app.routers.auth import get_current_user

router = APIRouter()

@router.get("/my-tasks")
async def my_tasks(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = select(Task).where(Task.owner_id == current_user.id, Task.status.notin_(["complete","dropped"]))
    result = await db.execute(q)
    tasks = result.scalars().all()
    return [_task_dict(t) for t in tasks]

@router.get("/overdue")
async def overdue_tasks(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    from datetime import date as date_cls
    today = date_cls.today()
    q = select(Task).where(and_(Task.due_date < today, Task.status.notin_(["complete","dropped"])))
    result = await db.execute(q)
    return [_task_dict(t) for t in result.scalars().all()]

@router.get("/due-soon")
async def tasks_due_soon(days: int = 7, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    from datetime import date as date_cls, timedelta
    today = date_cls.today()
    cutoff = today + timedelta(days=days)
    q = select(Task).where(and_(Task.due_date >= today, Task.due_date <= cutoff, Task.status.notin_(["complete","dropped"])))
    result = await db.execute(q)
    return [_task_dict(t) for t in result.scalars().all()]

def _task_dict(t: Task) -> dict:
    d = {c.name: getattr(t, c.name) for c in t.__table__.columns}
    for f in ["due_date", "created_at", "completed_at"]:
        if d.get(f):
            d[f] = str(d[f])
    return d

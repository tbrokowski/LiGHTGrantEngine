"""Notification endpoints."""
from fastapi import APIRouter, Depends
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.notification import Notification
from app.models.user import User
from app.routers.auth import get_current_user

router = APIRouter()

@router.get("/")
async def my_notifications(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = select(Notification).where(Notification.user_id == current_user.id).order_by(Notification.created_at.desc()).limit(50)
    result = await db.execute(q)
    return [{c.name: str(getattr(n, c.name)) if c.name in ["created_at","sent_at"] else getattr(n, c.name) for c in n.__table__.columns} for n in result.scalars().all()]

@router.post("/{notification_id}/read")
async def mark_read(notification_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await db.execute(update(Notification).where(Notification.id == notification_id, Notification.user_id == current_user.id).values(status="read"))
    await db.commit()
    return {"ok": True}

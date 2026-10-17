"""Notification endpoints — the inbox behind the dashboard bell and /messages."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, update, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.database import get_db
from app.models.notification import Notification, NotificationChannel, NotificationStatus
from app.models.task import Task
from app.models.user import User
from app.routers.auth import get_current_user

router = APIRouter()

# Rows that belong in the inbox: in-app notices, plus email notices (deadline
# reminders and the like) once they've been sent — marking a still-pending
# email read would otherwise suppress the email.
_INBOX = and_(
    Notification.status != NotificationStatus.FAILED,
    or_(
        Notification.channel == NotificationChannel.IN_APP,
        and_(
            Notification.channel == NotificationChannel.EMAIL,
            Notification.status != NotificationStatus.PENDING,
        ),
    ),
)


def _link(n: Notification, task_grant: dict[str, str]) -> str | None:
    t, eid = n.entity_type, n.entity_id
    if not eid:
        return None
    if t == "grant":
        return f"/grants/{eid}"
    if t == "task":
        gid = task_grant.get(eid)
        return f"/grants/{gid}" if gid else None
    if t == "opportunity":
        return f"/opportunities/{eid}"
    if t == "conversation":
        return f"/messages?c={eid}"
    if t == "partner":
        return f"/partners/{eid}"
    if t == "organization":
        return "/settings?tab=organizations"
    if t == "org_invite":
        return f"/invite/{eid}"
    if t == "ledger_category":
        return "/finance"
    return None


@router.get("/")
async def my_notifications(
    unread_only: bool = False,
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    actor = aliased(User)
    q = (
        select(Notification, actor.name)
        .outerjoin(actor, actor.id == Notification.actor_id)
        .where(Notification.user_id == current_user.id, _INBOX)
        .order_by(Notification.created_at.desc())
        .limit(limit)
    )
    if unread_only:
        q = q.where(Notification.status != NotificationStatus.READ)
    rows = (await db.execute(q)).all()

    task_ids = [n.entity_id for n, _ in rows if n.entity_type == "task" and n.entity_id]
    task_grant: dict[str, str] = {}
    if task_ids:
        task_grant = dict((await db.execute(
            select(Task.id, Task.grant_id).where(Task.id.in_(task_ids))
        )).all())

    return [
        {
            "id": n.id,
            "notification_type": n.notification_type,
            "entity_type": n.entity_type,
            "entity_id": n.entity_id,
            "message": n.message,
            "channel": n.channel,
            "status": n.status,
            "is_read": n.status == NotificationStatus.READ,
            "actor_id": n.actor_id,
            "actor_name": actor_name,
            "link": _link(n, task_grant),
            "created_at": n.created_at.isoformat() if n.created_at else None,
            "sent_at": n.sent_at.isoformat() if n.sent_at else None,
        }
        for n, actor_name in rows
    ]


@router.get("/unread-count")
async def unread_count(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    n = (await db.execute(
        select(func.count(Notification.id)).where(
            Notification.user_id == current_user.id,
            Notification.status != NotificationStatus.READ,
            _INBOX,
        )
    )).scalar_one()
    return {"unread": n}


@router.post("/read-all")
async def mark_all_read(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await db.execute(
        update(Notification)
        .where(Notification.user_id == current_user.id, Notification.status != NotificationStatus.READ, _INBOX)
        .values(status=NotificationStatus.READ)
    )
    await db.commit()
    return {"ok": True}


@router.post("/{notification_id}/read")
async def mark_read(notification_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await db.execute(update(Notification).where(Notification.id == notification_id, Notification.user_id == current_user.id).values(status="read"))
    await db.commit()
    return {"ok": True}

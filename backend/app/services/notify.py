"""In-app notifications created from request handlers.

Callers add to the session; the caller's own commit persists them. The actor
never notifies themselves.
"""
from collections.abc import Iterable
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification, NotificationChannel, NotificationStatus


async def notify(
    db: AsyncSession,
    user_ids: Iterable[str | None],
    notification_type: str,
    message: str,
    *,
    entity_type: str | None = None,
    entity_id: str | None = None,
    actor_id: str | None = None,
    collapse: bool = False,
) -> None:
    """Notify each of ``user_ids`` (deduplicated, minus the actor).

    ``collapse`` folds a new notice into the recipient's existing unread one
    for the same entity (e.g. a busy conversation stays a single inbox row
    showing the latest message) instead of adding another row.
    """
    recipients = {u for u in user_ids if u and u != actor_id}
    if not recipients:
        return
    existing: dict[str, Notification] = {}
    if collapse and entity_id:
        rows = await db.execute(
            select(Notification).where(
                Notification.user_id.in_(recipients),
                Notification.notification_type == notification_type,
                Notification.entity_id == entity_id,
                Notification.status != NotificationStatus.READ,
            )
        )
        existing = {n.user_id: n for n in rows.scalars().all()}
    now = datetime.now(timezone.utc)
    for uid in recipients:
        n = existing.get(uid)
        if n:
            n.message = message
            n.actor_id = actor_id
            n.created_at = now
            continue
        db.add(Notification(
            user_id=uid,
            notification_type=notification_type,
            entity_type=entity_type,
            entity_id=entity_id,
            message=message,
            actor_id=actor_id,
            channel=NotificationChannel.IN_APP,
            status=NotificationStatus.SENT,
            sent_at=now,
        ))

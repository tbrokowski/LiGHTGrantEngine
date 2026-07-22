"""Partner CRM background tasks — reminders, meeting prep, enrichment."""
import asyncio
from app.db_sync import get_sync_engine
import logging
from datetime import datetime, timezone, timedelta

from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


def _run_async(coro):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@celery_app.task(name="app.workers.partner_tasks.send_partner_reminders")
def send_partner_reminders():
    """
    Daily task: scan partner_reminders for due items and fire in-app notifications.
    Also checks for partners with overdue follow-up dates.
    """
    from sqlalchemy import create_engine, select, and_
    from sqlalchemy.orm import Session
    from app.config import get_settings
    from app.models.partner_reminder import PartnerReminder
    from app.models.partner import Partner, PartnerUpdate
    from app.models.notification import Notification, NotificationType, NotificationStatus

    settings = get_settings()
    engine = get_sync_engine()
    now = datetime.now(timezone.utc)

    with Session(engine) as db:
        # 1. Fire pending reminders
        due_reminders = db.execute(
            select(PartnerReminder).where(
                and_(
                    PartnerReminder.scheduled_for <= now,
                    PartnerReminder.sent_at.is_(None),
                    PartnerReminder.dismissed_at.is_(None),
                )
            )
        ).scalars().all()

        for reminder in due_reminders:
            partner = db.get(Partner, reminder.partner_id)
            partner_name = partner.name if partner else "a partner"

            notif = Notification(
                id=str(__import__("uuid").uuid4()),
                user_id=reminder.user_id,
                notification_type=NotificationType.GENERAL if hasattr(NotificationType, "GENERAL") else "reminder",
                title=reminder.title,
                message=f"Reminder about {partner_name}: {reminder.description or reminder.title}",
                status=NotificationStatus.UNREAD if hasattr(NotificationStatus, "UNREAD") else "unread",
                channel="in_app",
            )
            db.add(notif)
            reminder.sent_at = now

        # 2. Create reminders for overdue follow-ups (partners not contacted in 60+ days)
        cutoff_stale = now - timedelta(days=60)
        overdue_partners = db.execute(
            select(Partner).where(Partner.status == "active")
        ).scalars().all()

        for partner in overdue_partners:
            latest_update = db.execute(
                select(PartnerUpdate)
                .where(PartnerUpdate.partner_id == partner.id)
                .order_by(PartnerUpdate.created_at.desc())
                .limit(1)
            ).scalar_one_or_none()

            if latest_update and latest_update.created_at:
                last_contact = latest_update.created_at
                if last_contact.tzinfo is None:
                    last_contact = last_contact.replace(tzinfo=timezone.utc)
                if last_contact < cutoff_stale:
                    # Check if reminder already exists this week
                    week_ago = now - timedelta(days=7)
                    existing = db.execute(
                        select(PartnerReminder).where(
                            and_(
                                PartnerReminder.partner_id == partner.id,
                                PartnerReminder.reminder_type == "follow_up",
                                PartnerReminder.created_at >= week_ago,
                            )
                        )
                    ).scalar_one_or_none()

                    if not existing and partner.created_by:
                        days_silent = (now - last_contact).days
                        reminder = PartnerReminder(
                            id=str(__import__("uuid").uuid4()),
                            partner_id=partner.id,
                            user_id=partner.created_by,
                            institution_id=partner.institution_id or "",
                            reminder_type="follow_up",
                            title=f"Follow up with {partner.name}",
                            description=f"No contact logged for {days_silent} days",
                            scheduled_for=now,
                        )
                        db.add(reminder)

        db.commit()
        logger.info("partner_reminders: processed %d due reminders", len(due_reminders))


@celery_app.task(name="app.workers.partner_tasks.generate_pre_meeting_preps")
def generate_pre_meeting_preps():
    """
    Daily task: generate AI meeting preps for meetings scheduled in the next 24 hours
    that don't have a prep yet.
    """
    from sqlalchemy import create_engine, select, and_
    from sqlalchemy.orm import Session
    from app.config import get_settings
    from app.models.partner_meeting import PartnerMeeting
    from app.models.partner import Partner, PartnerUpdate

    settings = get_settings()
    engine = get_sync_engine()
    now = datetime.now(timezone.utc)
    tomorrow = now + timedelta(hours=24)

    with Session(engine) as db:
        upcoming = db.execute(
            select(PartnerMeeting).where(
                and_(
                    PartnerMeeting.scheduled_at >= now,
                    PartnerMeeting.scheduled_at <= tomorrow,
                    PartnerMeeting.meeting_prep.is_(None),
                    PartnerMeeting.completed_at.is_(None),
                )
            )
        ).scalars().all()

        for meeting in upcoming:
            partner = db.get(Partner, meeting.partner_id)
            if not partner:
                continue

            recent_updates = db.execute(
                select(PartnerUpdate)
                .where(PartnerUpdate.partner_id == partner.id)
                .order_by(PartnerUpdate.created_at.desc())
                .limit(5)
            ).scalars().all()

            partner_data = {
                "name": partner.name,
                "title": partner.title,
                "organization": partner.organization,
                "tags": partner.tags,
                "notes": partner.notes,
                "h_index": partner.h_index,
            }
            recent_logs = [
                {"type": u.update_type, "date": str(u.created_at), "notes": u.content[:300]}
                for u in recent_updates
            ]
            grant_ctx = None
            if meeting.grant_context_entity_id:
                grant_ctx = f"{meeting.grant_context_entity_type}:{meeting.grant_context_entity_id}"

            try:
                from app.ai.agents.meeting_prep_agent import generate_meeting_prep
                prep = _run_async(generate_meeting_prep(
                    partner=partner_data,
                    meeting_title=meeting.title,
                    agenda=meeting.agenda or [],
                    recent_logs=recent_logs,
                    grant_context=grant_ctx,
                ))
                meeting.meeting_prep = prep
                meeting.meeting_prep_generated_at = datetime.now(timezone.utc)
                db.commit()
                logger.info("Generated prep for meeting %s", meeting.id)
            except Exception as e:
                logger.warning("Failed to generate prep for meeting %s: %s", meeting.id, e)

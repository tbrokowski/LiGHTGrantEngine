"""Notification Celery tasks — deadline reminders and alerts."""
from datetime import datetime, timedelta, date
from app.workers.celery_app import celery_app


@celery_app.task(name="app.workers.notification_tasks.send_deadline_reminders")
def send_deadline_reminders():
    """Send daily deadline reminders based on configured schedule."""
    from sqlalchemy import select, create_engine, and_
    from sqlalchemy.orm import Session
    from app.config import get_settings
    from app.models.active_grant import ActiveGrant
    from app.models.task import Task
    from app.models.notification import Notification, NotificationType, NotificationStatus

    settings = get_settings()
    engine = create_engine(settings.database_url)
    today = date.today()
    notif_cfg = settings.notifications

    with Session(engine) as db:
        notifications_created = 0

        # External deadline reminders
        for days_ahead in notif_cfg.reminders.get("external_deadline", [60, 30, 14, 7, 3, 1]):
            target_date = today + timedelta(days=days_ahead)
            grants = db.execute(
                select(ActiveGrant).where(
                    ActiveGrant.external_deadline == target_date,
                    ActiveGrant.status.notin_(["submitted", "closed", "withdrawn"]),
                )
            ).scalars().all()
            for grant in grants:
                if grant.internal_lead_id:
                    notif = Notification(
                        id=str(__import__("uuid").uuid4()),
                        user_id=grant.internal_lead_id,
                        notification_type=NotificationType.GRANT_EXTERNAL_DEADLINE,
                        entity_type="grant",
                        entity_id=grant.id,
                        message=f"External deadline in {days_ahead} day(s): {grant.title} ({grant.funder})",
                        channel="email",
                        status=NotificationStatus.PENDING,
                    )
                    db.add(notif)
                    notifications_created += 1

        # Task deadline reminders
        for days_ahead in notif_cfg.reminders.get("task_deadline", [7, 3, 1, 0]):
            target_date = today + timedelta(days=days_ahead)
            tasks = db.execute(
                select(Task).where(
                    Task.due_date == target_date,
                    Task.status.notin_(["complete", "dropped"]),
                    Task.owner_id != None,
                )
            ).scalars().all()
            for task in tasks:
                notif = Notification(
                    id=str(__import__("uuid").uuid4()),
                    user_id=task.owner_id,
                    notification_type=NotificationType.TASK_DUE_SOON if days_ahead > 0 else NotificationType.TASK_ASSIGNED,
                    entity_type="task",
                    entity_id=task.id,
                    message=f"Task due in {days_ahead} day(s): {task.title}",
                    channel="in_app",
                    status=NotificationStatus.PENDING,
                )
                db.add(notif)
                notifications_created += 1

        db.commit()

    # Send pending email notifications
    send_pending_emails.delay()
    return {"notifications_created": notifications_created}


@celery_app.task(name="app.workers.notification_tasks.send_pending_emails")
def send_pending_emails():
    """Process and send pending email notifications."""
    from sqlalchemy import select, create_engine
    from sqlalchemy.orm import Session
    from app.config import get_settings
    from app.models.notification import Notification, NotificationStatus, NotificationChannel
    from app.models.user import User

    settings = get_settings()
    notif_cfg = settings.notifications
    if not notif_cfg.email.get("enabled", False):
        return {"skipped": "email disabled"}

    engine = create_engine(settings.database_url)
    with Session(engine) as db:
        pending = db.execute(
            select(Notification).where(
                Notification.status == NotificationStatus.PENDING,
                Notification.channel == NotificationChannel.EMAIL,
            ).limit(100)
        ).scalars().all()

        sent = 0
        for notif in pending:
            try:
                user = db.get(User, notif.user_id)
                if user and user.email:
                    _send_email(user.email, user.name, notif.message, notif_cfg)
                    notif.status = NotificationStatus.SENT
                    notif.sent_at = datetime.utcnow()
                    sent += 1
            except Exception as e:
                notif.status = NotificationStatus.FAILED

        db.commit()
    return {"sent": sent}


def _send_email(to_email: str, to_name: str, message: str, notif_cfg: dict):
    """Send a single email via SMTP."""
    import smtplib
    from email.mime.text import MIMEText
    from app.config import get_settings

    settings = get_settings()
    email_cfg = notif_cfg.get("email", {})
    smtp_host = email_cfg.get("smtp_host", "smtp.gmail.com")
    smtp_port = email_cfg.get("smtp_port", 587)
    from_addr = email_cfg.get("from_address", "")

    if not from_addr or not settings.smtp_password:
        return

    msg = MIMEText(message)
    msg["Subject"] = f"[{settings.app_name}] Reminder"
    msg["From"] = from_addr
    msg["To"] = to_email

    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.starttls()
        server.login(from_addr, settings.smtp_password)
        server.send_message(msg)

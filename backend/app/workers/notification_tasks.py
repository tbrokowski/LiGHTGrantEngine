"""Notification Celery tasks — deadline reminders and alerts."""
from datetime import datetime, timedelta, date, timezone
from app.db_sync import get_sync_engine
from app.workers.celery_app import celery_app


# ── Slack helper ───────────────────────────────────────────────────────────────

def _send_slack(message: str, webhook_url: str) -> None:
    """POST a plain-text message to a Slack incoming webhook."""
    import httpx

    payload = {"text": message}
    resp = httpx.post(webhook_url, json=payload, timeout=10)
    resp.raise_for_status()


# ── Email helper ───────────────────────────────────────────────────────────────

def _send_email(to_email: str, to_name: str, message: str, notif_cfg) -> None:
    """Send a single email via SMTP."""
    import smtplib
    from email.mime.text import MIMEText
    from app.config import get_settings

    settings = get_settings()
    email_cfg = notif_cfg.email if hasattr(notif_cfg, "email") else notif_cfg.get("email", {})
    if hasattr(email_cfg, "get"):
        smtp_host = email_cfg.get("smtp_host", "smtp.gmail.com")
        smtp_port = email_cfg.get("smtp_port", 587)
        from_addr = email_cfg.get("from_address", "")
    else:
        smtp_host = "smtp.gmail.com"
        smtp_port = 587
        from_addr = ""

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


# ── Main reminder task ─────────────────────────────────────────────────────────

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
    engine = get_sync_engine()
    today = date.today()
    notif_cfg = settings.notifications

    slack_cfg = notif_cfg.slack if hasattr(notif_cfg, "slack") else notif_cfg.get("slack", {})
    slack_enabled = (
        slack_cfg.get("enabled", False) if hasattr(slack_cfg, "get") else False
    )
    slack_webhook = (
        slack_cfg.get("webhook_url", "") if hasattr(slack_cfg, "get") else ""
    ) or settings.slack_webhook_url or ""

    reminders = notif_cfg.reminders if hasattr(notif_cfg, "reminders") else notif_cfg.get("reminders", {})

    with Session(engine) as db:
        notifications_created = 0

        # ── External deadline reminders ───────────────────────────────────────
        for days_ahead in reminders.get("external_deadline", [60, 30, 14, 7, 3, 1]):
            target_date = today + timedelta(days=days_ahead)
            grants = db.execute(
                select(ActiveGrant).where(
                    ActiveGrant.external_deadline == target_date,
                    ActiveGrant.status.notin_(["submitted", "closed", "withdrawn"]),
                )
            ).scalars().all()
            for grant in grants:
                msg = (
                    f"External deadline in {days_ahead} day(s): "
                    f"{grant.title} ({grant.funder})"
                )

                # In-app / email notification
                if grant.internal_lead_id:
                    notif = Notification(
                        id=str(__import__("uuid").uuid4()),
                        user_id=grant.internal_lead_id,
                        notification_type=NotificationType.GRANT_EXTERNAL_DEADLINE,
                        entity_type="grant",
                        entity_id=grant.id,
                        message=msg,
                        channel="email",
                        status=NotificationStatus.PENDING,
                    )
                    db.add(notif)
                    notifications_created += 1

                # Slack direct notification
                if slack_enabled and slack_webhook:
                    try:
                        _send_slack(f":alarm_clock: {msg}", slack_webhook)
                    except Exception as exc:
                        import logging
                        logging.getLogger(__name__).warning("Slack send failed: %s", exc)

        # ── Internal deadline reminders ───────────────────────────────────────
        for days_ahead in reminders.get("internal_deadline", [14, 7, 3, 1]):
            target_date = today + timedelta(days=days_ahead)
            grants_int = db.execute(
                select(ActiveGrant).where(
                    ActiveGrant.internal_deadline == target_date,
                    ActiveGrant.status.notin_(["submitted", "closed", "withdrawn"]),
                )
            ).scalars().all()
            for grant in grants_int:
                msg = (
                    f"Internal deadline in {days_ahead} day(s): "
                    f"{grant.title} ({grant.funder})"
                )
                if slack_enabled and slack_webhook:
                    try:
                        _send_slack(f":calendar: {msg}", slack_webhook)
                    except Exception as exc:
                        import logging
                        logging.getLogger(__name__).warning("Slack send failed: %s", exc)

        # ── Task deadline reminders ───────────────────────────────────────────
        for days_ahead in reminders.get("task_deadline", [7, 3, 1, 0]):
            target_date = today + timedelta(days=days_ahead)
            tasks = db.execute(
                select(Task).where(
                    Task.due_date == target_date,
                    Task.status.notin_(["complete", "dropped"]),
                    Task.owner_id != None,
                )
            ).scalars().all()
            for task in tasks:
                msg = f"Task due in {days_ahead} day(s): {task.title}"
                notif = Notification(
                    id=str(__import__("uuid").uuid4()),
                    user_id=task.owner_id,
                    notification_type=(
                        NotificationType.TASK_DUE_SOON
                        if days_ahead > 0
                        else NotificationType.TASK_ASSIGNED
                    ),
                    entity_type="task",
                    entity_id=task.id,
                    message=msg,
                    channel="in_app",
                    status=NotificationStatus.PENDING,
                )
                db.add(notif)
                notifications_created += 1

                if slack_enabled and slack_webhook:
                    try:
                        _send_slack(f":pencil2: {msg}", slack_webhook)
                    except Exception as exc:
                        import logging
                        logging.getLogger(__name__).warning("Slack send failed: %s", exc)

        # ── Opportunity workspace task reminders ──────────────────────────────
        # User-created tasks on an opportunity card, before it becomes a grant.
        # org-scope tasks -> org Slack channel; user-scope tasks -> in-app to the
        # owner (a private task must not leak to the shared org channel). Each
        # task drives its own reminder offsets via remind_days_before.
        try:
            from app.models.opportunity_task import OpportunityTask
            from app.models.opportunity import Opportunity as _Opp

            opp_tasks = db.execute(
                select(OpportunityTask).where(
                    OpportunityTask.due_date != None,
                    OpportunityTask.status != "done",
                )
            ).scalars().all()
            opp_title_cache: dict[str, str] = {}
            for otask in opp_tasks:
                offsets = otask.remind_days_before or [7, 3, 1, 0]
                due = otask.due_date
                days_ahead = (due - today).days
                if days_ahead not in offsets:
                    continue
                if otask.opportunity_id not in opp_title_cache:
                    opp_row = db.get(_Opp, otask.opportunity_id)
                    opp_title_cache[otask.opportunity_id] = opp_row.title if opp_row else "opportunity"
                opp_title = opp_title_cache.get(otask.opportunity_id, "opportunity")
                when = "today" if days_ahead == 0 else f"in {days_ahead} day(s)"
                msg = f"Task '{otask.title}' for {opp_title} is due {when}"

                if otask.scope == "org":
                    if slack_enabled and slack_webhook:
                        try:
                            _send_slack(f":dart: {msg}", slack_webhook)
                        except Exception as exc:
                            import logging
                            logging.getLogger(__name__).warning("Slack send failed: %s", exc)
                else:  # user-scope -> private in-app notification to the owner
                    db.add(Notification(
                        id=str(__import__("uuid").uuid4()),
                        user_id=otask.owner_id,
                        notification_type=(
                            NotificationType.TASK_DUE_SOON if days_ahead > 0 else NotificationType.TASK_ASSIGNED
                        ),
                        entity_type="opportunity_task",
                        entity_id=otask.id,
                        message=msg,
                        channel="in_app",
                        status=NotificationStatus.PENDING,
                    ))
                    notifications_created += 1
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning("Opportunity task reminders failed: %s", exc)

        # ── Opportunity deadline reminders (shortlisted / actively-pursuing
        #    only — scoped this way to avoid notifying on the entire global
        #    opportunity pool, which every institution shares) ───────────────
        try:
            from app.models.institution_opportunity import InstitutionOpportunity
            from app.models.opportunity import Opportunity
            from app.models.user_opportunity_state import UserOpportunityState
            from app.models.user import User

            OPP_TRACKED_STATUSES = ["potential_fit", "actively_pursuing"]
            for days_ahead in reminders.get("opportunity_deadline", [30, 14, 7, 3, 1]):
                target_date = today + timedelta(days=days_ahead)
                rows = db.execute(
                    select(InstitutionOpportunity, Opportunity)
                    .join(Opportunity, Opportunity.id == InstitutionOpportunity.opportunity_id)
                    .where(
                        Opportunity.deadline == target_date,
                        InstitutionOpportunity.status.in_(OPP_TRACKED_STATUSES),
                    )
                ).all()
                for io, opp in rows:
                    msg = (
                        f"Grant opportunity deadline in {days_ahead} day(s): "
                        f"{opp.title} ({opp.funder or 'Unknown funder'})"
                    )

                    recipient_ids: list[str] = []
                    if io.assigned_reviewer_id:
                        recipient_ids.append(io.assigned_reviewer_id)
                    else:
                        # Fall back to whichever of this institution's users
                        # personally shortlisted the opportunity.
                        recipient_ids.extend(db.execute(
                            select(UserOpportunityState.user_id)
                            .join(User, User.id == UserOpportunityState.user_id)
                            .where(
                                UserOpportunityState.opportunity_id == opp.id,
                                UserOpportunityState.saved_at.isnot(None),
                                User.institution_id == io.institution_id,
                            )
                        ).scalars().all())

                    for uid in recipient_ids:
                        notif = Notification(
                            id=str(__import__("uuid").uuid4()),
                            user_id=uid,
                            notification_type=NotificationType.OPPORTUNITY_DEADLINE,
                            entity_type="opportunity",
                            entity_id=opp.id,
                            message=msg,
                            channel="email",
                            status=NotificationStatus.PENDING,
                        )
                        db.add(notif)
                        notifications_created += 1

                    if slack_enabled and slack_webhook and recipient_ids:
                        try:
                            _send_slack(f":rotating_light: {msg}", slack_webhook)
                        except Exception as exc:
                            import logging
                            logging.getLogger(__name__).warning("Slack send failed: %s", exc)
        except Exception:
            pass  # opportunity models may not be available in all environments

        # ── Partner material due reminders ────────────────────────────────────
        try:
            from app.models.workspace_partner import PartnerMaterial

            for days_ahead in [7, 3, 1]:
                target_date = today + timedelta(days=days_ahead)
                materials = db.execute(
                    select(PartnerMaterial).where(
                        PartnerMaterial.due_date == target_date,
                        PartnerMaterial.status.notin_(["received", "complete"]),
                    )
                ).scalars().all()
                for mat in materials:
                    msg = (
                        f"Partner material due in {days_ahead} day(s): "
                        f"{mat.title} (grant {mat.grant_id[:8]})"
                    )
                    if slack_enabled and slack_webhook:
                        try:
                            _send_slack(f":handshake: {msg}", slack_webhook)
                        except Exception as exc:
                            import logging
                            logging.getLogger(__name__).warning("Slack send failed: %s", exc)
        except Exception:
            pass  # PartnerMaterial may not be available in all environments

        db.commit()

    # Process pending email notifications
    send_pending_emails.delay()
    return {"notifications_created": notifications_created}


# ── Email dispatch task ────────────────────────────────────────────────────────

@celery_app.task(name="app.workers.notification_tasks.send_pending_emails")
def send_pending_emails():
    """Process and dispatch pending email notifications."""
    from sqlalchemy import select, create_engine
    from sqlalchemy.orm import Session
    from app.config import get_settings
    from app.models.notification import Notification, NotificationStatus, NotificationChannel
    from app.models.user import User

    settings = get_settings()
    notif_cfg = settings.notifications
    email_cfg = notif_cfg.email if hasattr(notif_cfg, "email") else notif_cfg.get("email", {})
    if not (email_cfg.get("enabled", False) if hasattr(email_cfg, "get") else False):
        return {"skipped": "email disabled"}

    engine = get_sync_engine()
    with Session(engine) as db:
        pending = db.execute(
            select(Notification)
            .where(
                Notification.status == NotificationStatus.PENDING,
                Notification.channel == NotificationChannel.EMAIL,
            )
            .limit(100)
        ).scalars().all()

        sent = 0
        for notif in pending:
            try:
                user = db.get(User, notif.user_id)
                if user and user.email:
                    _send_email(user.email, user.name, notif.message, notif_cfg)
                    notif.status = NotificationStatus.SENT
                    notif.sent_at = datetime.now(timezone.utc)
                    sent += 1
            except Exception:
                notif.status = NotificationStatus.FAILED

        db.commit()
    return {"sent": sent}


# ── Slack dispatch task (for channel="slack" notifications) ───────────────────

@celery_app.task(name="app.workers.notification_tasks.send_pending_slack")
def send_pending_slack():
    """Dispatch pending Slack-channel notifications from the notification queue."""
    from sqlalchemy import select, create_engine
    from sqlalchemy.orm import Session
    from app.config import get_settings
    from app.models.notification import Notification, NotificationStatus

    settings = get_settings()
    notif_cfg = settings.notifications
    slack_cfg = notif_cfg.slack if hasattr(notif_cfg, "slack") else notif_cfg.get("slack", {})
    webhook_url = (
        slack_cfg.get("webhook_url", "") if hasattr(slack_cfg, "get") else ""
    ) or settings.slack_webhook_url or ""

    if not (slack_cfg.get("enabled", False) if hasattr(slack_cfg, "get") else False) or not webhook_url:
        return {"skipped": "Slack disabled or webhook not configured"}

    engine = get_sync_engine()
    with Session(engine) as db:
        pending = db.execute(
            select(Notification).where(
                Notification.status == NotificationStatus.PENDING,
                Notification.channel == "slack",
            ).limit(100)
        ).scalars().all()

        sent = 0
        for notif in pending:
            try:
                _send_slack(notif.message, webhook_url)
                notif.status = NotificationStatus.SENT
                notif.sent_at = datetime.now(timezone.utc)
                sent += 1
            except Exception:
                notif.status = NotificationStatus.FAILED

        db.commit()
    return {"sent": sent}


@celery_app.task(name="app.workers.notification_tasks.check_finance_overspend")
def check_finance_overspend():
    """Alert grant leads when ledger categories exceed 80% or 100% utilization."""
    from sqlalchemy import select, create_engine, func
    from sqlalchemy.orm import Session
    from app.config import get_settings
    from app.models.active_grant import ActiveGrant
    from app.models.grant_ledger import GrantLedger, LedgerCategory, FundRequest, FundRequestStatus, Expenditure
    from app.models.notification import Notification, NotificationType, NotificationStatus, NotificationChannel
    from app.models.grant_member import GrantMember, GrantMemberRole

    settings = get_settings()
    engine = get_sync_engine()
    COMMITTED = (
        FundRequestStatus.PENDING.value,
        FundRequestStatus.UNDER_REVIEW.value,
        FundRequestStatus.APPROVED.value,
    )

    with Session(engine) as db:
        grants = db.execute(
            select(ActiveGrant).where(ActiveGrant.grant_stage.in_(["active", "awarded"]))
        ).scalars().all()
        alerts_created = 0
        for grant in grants:
            ledger = db.execute(
                select(GrantLedger).where(GrantLedger.grant_id == grant.id)
            ).scalar_one_or_none()
            if not ledger:
                continue
            categories = db.execute(
                select(LedgerCategory).where(LedgerCategory.ledger_id == ledger.id)
            ).scalars().all()
            for cat in categories:
                approved = float(cat.approved_amount or 0)
                if approved <= 0:
                    continue
                spent = db.execute(
                    select(func.coalesce(func.sum(Expenditure.amount), 0)).where(
                        Expenditure.category_id == cat.id
                    )
                ).scalar() or 0
                committed = db.execute(
                    select(func.coalesce(func.sum(FundRequest.amount), 0)).where(
                        FundRequest.category_id == cat.id,
                        FundRequest.status.in_(COMMITTED),
                    )
                ).scalar() or 0
                util = (float(spent) + float(committed)) / approved * 100
                notif_type = None
                if util >= 100:
                    notif_type = NotificationType.FINANCE_OVERSPEND_CRITICAL
                elif util >= 80:
                    notif_type = NotificationType.FINANCE_OVERSPEND_WARNING
                if not notif_type:
                    continue
                members = db.execute(
                    select(GrantMember).where(
                        GrantMember.grant_id == grant.id,
                        GrantMember.role.in_([GrantMemberRole.OWNER.value, GrantMemberRole.EDITOR.value]),
                    )
                ).scalars().all()
                member_ids = [m.user_id for m in members]
                if not member_ids and grant.internal_lead_id:
                    member_ids = [grant.internal_lead_id]
                msg = (
                    f"Grant '{grant.title}': category '{cat.name}' is at {util:.0f}% "
                    f"({settings.base_url}/finance/{grant.id})"
                )
                for uid in member_ids:
                    db.add(Notification(
                        user_id=uid,
                        notification_type=notif_type.value,
                        entity_type="ledger_category",
                        entity_id=cat.id,
                        message=msg,
                        channel=NotificationChannel.IN_APP.value,
                        status=NotificationStatus.PENDING,
                    ))
                    alerts_created += 1
        db.commit()
    return {"alerts_created": alerts_created}

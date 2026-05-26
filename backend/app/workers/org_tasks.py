"""Organization lifecycle Celery tasks."""
import logging
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.workers.org_tasks.scaffold_new_organization", bind=True, max_retries=3)
def scaffold_new_organization(self, institution_id: str, admin_user_id: str) -> dict:
    """
    Run after a new organization is created.
    Seeds default Sources and sends a welcome email to the org admin.
    """
    import asyncio
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

    from app.config import get_settings
    from app.models.user import User
    from app.models.institution import Institution
    from app.models.source import Source
    import uuid
    from sqlalchemy import select

    settings = get_settings()

    async def _run():
        engine = create_async_engine(settings.database_url, echo=False)
        async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        async with async_session() as db:
            # Load institution and admin user
            inst = (await db.execute(
                select(Institution).where(Institution.id == institution_id)
            )).scalar_one_or_none()
            user = (await db.execute(
                select(User).where(User.id == admin_user_id)
            )).scalar_one_or_none()

            if not inst or not user:
                logger.warning("scaffold_new_organization: institution or user not found")
                return {"status": "skipped"}

            # Seed default grant opportunity sources scoped to this institution
            default_sources = [
                {
                    "name": "NIH Grants",
                    "url": "https://grants.nih.gov/funding/searchGuide/search_guide.cfm",
                    "source_type": "html_static",
                    "category": "health_research",
                    "refresh_frequency": "weekly",
                },
                {
                    "name": "Wellcome Trust",
                    "url": "https://wellcome.org/grant-funding",
                    "source_type": "html_static",
                    "category": "global_health",
                    "refresh_frequency": "weekly",
                },
                {
                    "name": "Gates Foundation",
                    "url": "https://www.gatesfoundation.org/about/how-we-work/grant-opportunities",
                    "source_type": "html_static",
                    "category": "global_health",
                    "refresh_frequency": "weekly",
                },
            ]

            for src_data in default_sources:
                source = Source(
                    id=str(uuid.uuid4()),
                    owner_id=admin_user_id,
                    status="active",
                    **src_data,
                )
                db.add(source)

            await db.commit()

            # Send welcome email
            try:
                _send_welcome_email(user.email, user.name, inst.name)
            except Exception as e:
                logger.warning("Welcome email failed for %s: %s", inst.name, e)

        await engine.dispose()
        return {"status": "ok", "institution_id": institution_id}

    try:
        return asyncio.run(_run())
    except Exception as exc:
        logger.error("scaffold_new_organization failed: %s", exc)
        raise self.retry(exc=exc, countdown=60)


def _send_welcome_email(to_email: str, to_name: str, org_name: str) -> None:
    """Send a welcome email to the new org admin using SMTP."""
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    from app.config import get_settings

    settings = get_settings()
    if not settings.smtp_password:
        logger.info("SMTP not configured — skipping welcome email to %s", to_email)
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"Welcome to LiGHT Grant Engine — {org_name} is ready"
    msg["From"] = settings.smtp_from
    msg["To"] = to_email

    html = f"""
    <p>Hi {to_name},</p>
    <p>Your organization <strong>{org_name}</strong> has been set up on LiGHT Grant Engine.</p>
    <p>Here's what to do next:</p>
    <ul>
      <li>Invite your team members from the <strong>Settings → Organization</strong> tab</li>
      <li>Share your access code or send email invites</li>
      <li>Upload past grant proposals to build your archive</li>
      <li>Configure funding sources for your opportunity pipeline</li>
    </ul>
    <p>Best of luck with your grants!</p>
    <p>— The LiGHT Grant Engine team</p>
    """
    msg.attach(MIMEText(html, "html"))

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
            server.ehlo()
            server.starttls()
            server.login(settings.smtp_from, settings.smtp_password)
            server.sendmail(settings.smtp_from, to_email, msg.as_string())
    except Exception as e:
        logger.error("Failed to send welcome email: %s", e)
        raise

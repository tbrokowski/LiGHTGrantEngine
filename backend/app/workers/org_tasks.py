"""Organization lifecycle Celery tasks."""
import asyncio
import logging

from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.workers.org_tasks.scaffold_new_organization", bind=True, max_retries=3)
def scaffold_new_organization(self, institution_id: str, admin_user_id: str) -> dict:
    """
    Run after a new organization is created.
    Fans out global sources and preseeds the grant feed.
    """
    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import Session
    from app.config import get_settings
    from app.models.user import User
    from app.models.institution import Institution
    from app.services.email import send_email

    settings = get_settings()
    engine = create_engine(settings.database_url)

    try:
        with Session(engine) as db:
            inst = db.execute(
                select(Institution).where(Institution.id == institution_id)
            ).scalar_one_or_none()
            user = db.execute(
                select(User).where(User.id == admin_user_id)
            ).scalar_one_or_none()

            if not inst or not user:
                logger.warning("scaffold_new_organization: institution or user not found")
                return {"status": "skipped"}

            try:
                html = f"""
                <p>Hi {user.name},</p>
                <p>Your organization <strong>{inst.name}</strong> has been set up on LiGHT Grant Engine.</p>
                <p>Your grant feed is being prepared from the global pool. Configure keywords in
                <strong>Settings → Data Sources</strong> to surface the most relevant opportunities.</p>
                <p>Best of luck with your grants!</p>
                <p>— The LiGHT Grant Engine team</p>
                """
                asyncio.run(send_email(
                    to=user.email,
                    subject=f"Welcome to LiGHT Grant Engine — {inst.name} is ready",
                    html=html,
                ))
            except Exception as e:
                logger.warning("Welcome email failed for %s: %s", inst.name, e)

        celery_app.send_task("app.workers.surfacing_tasks.fan_out_sources_to_all")
        celery_app.send_task(
            "app.workers.surfacing_tasks.preseed_institution_grants",
            args=[institution_id],
        )
        return {"status": "ok", "institution_id": institution_id}

    except Exception as exc:
        logger.error("scaffold_new_organization failed: %s", exc)
        raise self.retry(exc=exc, countdown=60)

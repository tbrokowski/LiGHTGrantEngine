"""Background grant writing tasks — long-running call analysis off the API process."""
import asyncio
import logging
from datetime import datetime

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


def _set_grant_analysis_state(
    grant_id: str,
    *,
    status: str,
    error: str | None = None,
    call_analysis: dict | None = None,
    call_requirements: str | None = None,
) -> None:
    from app.config import get_settings
    from app.models.active_grant import ActiveGrant

    settings = get_settings()
    engine = create_engine(settings.database_url, pool_pre_ping=True)
    try:
        with Session(engine) as db:
            grant = db.get(ActiveGrant, grant_id)
            if not grant:
                logger.error("analyze_grant_call: grant %s not found", grant_id)
                return
            grant.call_analysis_status = status
            grant.call_analysis_error = error
            if call_analysis is not None:
                grant.call_analysis = call_analysis
            if call_requirements is not None:
                grant.call_requirements = call_requirements
            db.commit()
    finally:
        engine.dispose()


def _log_ai_run_sync(grant_id: str, user_id: str | None, output: dict) -> None:
    import uuid
    from app.config import get_settings
    from app.models.ai_run import AIRun, AgentType, AIRunStatus

    settings = get_settings()
    engine = create_engine(settings.database_url, pool_pre_ping=True)
    try:
        with Session(engine) as db:
            run = AIRun(
                id=str(uuid.uuid4()),
                user_id=user_id,
                entity_type="grant",
                entity_id=grant_id,
                agent_type=AgentType.CALL_ANALYZER,
                status=AIRunStatus.COMPLETED,
                output_structured=output,
                model_used=settings.ai.model,
                completed_at=datetime.utcnow(),
            )
            db.add(run)
            db.commit()
    finally:
        engine.dispose()


@celery_app.task(
    name="app.workers.grant_writing_tasks.analyze_grant_call",
    bind=True,
    max_retries=1,
    soft_time_limit=540,
    time_limit=600,
)
def analyze_grant_call(
    self,
    grant_id: str,
    call_text: str,
    call_url: str = "",
    funder: str = "",
    user_id: str | None = None,
) -> dict:
    """
    Run call analysis in the background so API requests are not held open
    during multi-minute LLM calls (survives API container restarts).
    """
    from app.ai.agents.call_analyzer import analyze_call, _analysis_has_content
    from app.ai.orchestrator.grant_writing import GrantWritingOrchestrator

    logger.info("analyze_grant_call started for grant %s (%d chars)", grant_id, len(call_text or ""))

    try:
        result = asyncio.run(
            analyze_call(
                call_text=call_text,
                call_url=call_url,
                funder=funder,
            )
        )

        if not _analysis_has_content(result):
            err = result.get("error") or "Call analysis returned no usable content"
            _set_grant_analysis_state(grant_id, status="failed", error=err)
            return {"status": "failed", "error": err}

        orchestrator = GrantWritingOrchestrator()
        requirements_text = orchestrator._format_call_requirements(result)

        _set_grant_analysis_state(
            grant_id,
            status="completed",
            error=None,
            call_analysis=result,
            call_requirements=requirements_text,
        )
        if user_id:
            _log_ai_run_sync(grant_id, user_id, result)

        logger.info("analyze_grant_call completed for grant %s", grant_id)
        return {"status": "completed", "grant_id": grant_id}

    except Exception as exc:
        logger.exception("analyze_grant_call failed for grant %s: %s", grant_id, exc)
        err_msg = str(exc)[:2000]
        _set_grant_analysis_state(grant_id, status="failed", error=err_msg)
        try:
            raise self.retry(exc=exc, countdown=60) from exc
        except Exception:
            return {"status": "failed", "error": err_msg}

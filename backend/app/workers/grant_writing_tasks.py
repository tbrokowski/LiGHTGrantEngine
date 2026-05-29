"""Background grant writing tasks — long-running call analysis off the API process."""
import asyncio
import json
import logging
from datetime import datetime, timezone, timedelta

from celery.exceptions import SoftTimeLimitExceeded
from celery.signals import worker_ready
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)

STALE_THRESHOLD_MINUTES = 20


def _set_grant_analysis_state(
    grant_id: str,
    *,
    status: str,
    error: str | None = None,
    call_analysis: dict | None = None,
    call_requirements: str | None = None,
    steps: list | None = None,
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
            if steps is not None:
                grant.call_analysis_steps = steps
            db.commit()
    finally:
        engine.dispose()


def _update_steps(grant_id: str, steps: list) -> None:
    """Write step-level progress to DB so the UI can poll it."""
    from app.config import get_settings

    settings = get_settings()
    engine = create_engine(settings.database_url, pool_pre_ping=True)
    try:
        with engine.connect() as conn:
            conn.execute(
                text(
                    "UPDATE active_grants SET call_analysis_steps = :steps, updated_at = NOW() WHERE id = :id"
                ),
                {"steps": json.dumps(steps), "id": grant_id},
            )
            conn.commit()
    except Exception as e:
        logger.warning("_update_steps failed for grant %s: %s", grant_id, e)
    finally:
        engine.dispose()


def _recover_stale_call_analysis() -> list[str]:
    """
    Find active_grants stuck in call_analysis_status='running' for longer than
    STALE_THRESHOLD_MINUTES and mark them failed so users can retry.
    """
    from app.config import get_settings

    settings = get_settings()
    engine = create_engine(settings.database_url, pool_pre_ping=True)
    recovered: list[str] = []
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=STALE_THRESHOLD_MINUTES)
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT id FROM active_grants "
                    "WHERE call_analysis_status = 'running' "
                    "AND COALESCE(updated_at, created_at, NOW() - INTERVAL '1 hour') < :cutoff"
                ),
                {"cutoff": cutoff},
            ).fetchall()
            stale_ids = [str(r[0]) for r in rows]
            if stale_ids:
                for grant_id in stale_ids:
                    conn.execute(
                        text(
                            "UPDATE active_grants SET call_analysis_status = 'failed', "
                            "call_analysis_error = 'Analysis timed out. Click Try again to restart.' "
                            "WHERE id = :id"
                        ),
                        {"id": grant_id},
                    )
                conn.commit()
                recovered = stale_ids
                logger.info("Recovered %d stale call analysis jobs: %s", len(stale_ids), stale_ids)
    except Exception as e:
        logger.error("_recover_stale_call_analysis error: %s", e)
    finally:
        engine.dispose()
    return recovered


@worker_ready.connect
def recover_stale_on_startup(sender, **kwargs):
    """Reset stuck running jobs when the worker restarts."""
    try:
        recovered = _recover_stale_call_analysis()
        if recovered:
            logger.info("worker_ready: recovered %d stale call analysis jobs", len(recovered))
    except Exception as e:
        logger.warning("worker_ready recovery failed: %s", e)


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
    soft_time_limit=840,
    time_limit=900,
)
def analyze_grant_call(
    self,
    grant_id: str,
    call_text: str,
    call_url: str = "",
    funder: str = "",
    user_id: str | None = None,
    existing_analysis: bool = False,
) -> dict:
    """
    Run call analysis in the background so API requests are not held open
    during multi-minute LLM calls (survives API container restarts).
    Pass existing_analysis=True on re-analyze to skip Stage 1 structure scan.
    """
    from app.ai.agents.call_analyzer import analyze_call, _analysis_has_content
    from app.ai.orchestrator.grant_writing import GrantWritingOrchestrator

    logger.info("analyze_grant_call started for grant %s (%d chars)", grant_id, len(call_text or ""))

    is_reanalyze = bool(existing_analysis)

    def steps(scan_status, extract_status, save_status):
        base = [
            {"id": "parse",   "label": "Loading document text",              "status": "done"},
        ]
        if not is_reanalyze:
            base.append({"id": "scan", "label": "Scanning document structure…", "status": scan_status})
        base += [
            {"id": "extract", "label": "Extracting requirements and context", "status": extract_status},
            {"id": "save",    "label": "Saving Call Intelligence",            "status": save_status},
        ]
        return base

    try:
        if not is_reanalyze:
            _update_steps(grant_id, steps("active", "pending", "pending"))
        else:
            _update_steps(grant_id, [
                {"id": "parse",   "label": "Loading document text",              "status": "done"},
                {"id": "extract", "label": "Extracting requirements and context", "status": "active"},
                {"id": "save",    "label": "Saving Call Intelligence",            "status": "pending"},
            ])

        result = asyncio.run(
            analyze_call(
                call_text=call_text,
                call_url=call_url,
                funder=funder,
                skip_structure_scan=is_reanalyze,
            )
        )

        _update_steps(grant_id, steps("done", "active", "pending") if not is_reanalyze else [
            {"id": "parse",   "label": "Loading document text",              "status": "done"},
            {"id": "extract", "label": "Extracting requirements and context", "status": "done"},
            {"id": "save",    "label": "Saving Call Intelligence",            "status": "active"},
        ])

        if not _analysis_has_content(result):
            err = result.get("error") or "Call analysis returned no usable content"
            _set_grant_analysis_state(grant_id, status="failed", error=err,
                                      steps=[{"id": "extract", "label": "Extracting requirements", "status": "error", "detail": err}])
            return {"status": "failed", "error": err}

        orchestrator = GrantWritingOrchestrator()
        requirements_text = orchestrator._format_call_requirements(result)

        final_steps = steps("done", "done", "done") if not is_reanalyze else [
            {"id": "parse",   "label": "Loading document text",              "status": "done"},
            {"id": "extract", "label": "Extracted requirements and context",  "status": "done"},
            {"id": "save",    "label": "Call Intelligence saved",             "status": "done"},
        ]
        _set_grant_analysis_state(
            grant_id,
            status="completed",
            error=None,
            call_analysis=result,
            call_requirements=requirements_text,
            steps=final_steps,
        )
        if user_id:
            _log_ai_run_sync(grant_id, user_id, result)

        logger.info("analyze_grant_call completed for grant %s", grant_id)
        return {"status": "completed", "grant_id": grant_id}

    except SoftTimeLimitExceeded:
        logger.warning("analyze_grant_call soft time limit for grant %s", grant_id)
        err_msg = "Analysis exceeded the time limit. Click Try again to restart."
        _set_grant_analysis_state(grant_id, status="failed", error=err_msg,
                                  steps=[{"id": "extract", "label": "Timed out", "status": "error", "detail": err_msg}])
        return {"status": "failed", "error": err_msg}

    except Exception as exc:
        logger.exception("analyze_grant_call failed for grant %s: %s", grant_id, exc)
        err_msg = str(exc)[:2000]
        _set_grant_analysis_state(grant_id, status="failed", error=err_msg,
                                  steps=[{"id": "extract", "label": "Analysis failed", "status": "error", "detail": err_msg}])
        try:
            raise self.retry(exc=exc, countdown=60) from exc
        except Exception:
            return {"status": "failed", "error": err_msg}


@celery_app.task(name="app.workers.grant_writing_tasks.recover_stale_call_analysis_tasks")
def recover_stale_call_analysis_tasks() -> dict:
    """Periodic beat task: reset stale running call analysis jobs so users can retry."""
    recovered = _recover_stale_call_analysis()
    return {"recovered": len(recovered), "ids": recovered}

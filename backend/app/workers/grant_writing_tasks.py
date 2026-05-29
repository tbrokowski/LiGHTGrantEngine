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

STALE_THRESHOLD_MINUTES = 8


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

    def _step_callback(new_steps: list) -> None:
        """Sync callback passed into analyze_call for intra-pipeline progress updates."""
        _update_steps(grant_id, new_steps)

    try:
        # Seed the initial "loading" step so the UI shows activity immediately.
        _update_steps(grant_id, [
            {"id": "parse",   "label": "Loading document text",              "status": "active"},
            {"id": "extract", "label": "Extracting requirements and context", "status": "pending"},
            {"id": "save",    "label": "Saving Call Intelligence",            "status": "pending"},
        ])

        result = asyncio.run(
            analyze_call(
                call_text=call_text,
                call_url=call_url,
                funder=funder,
                skip_structure_scan=is_reanalyze,
                on_step=_step_callback,
            )
        )

        # on_step already pushed extract→done / save→active; update save to active
        # only if on_step didn't already fire that transition.
        _update_steps(grant_id, steps("done", "done", "active") if not is_reanalyze else [
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


# ---------------------------------------------------------------------------
# Shared helpers for skeleton / draft background tasks
# ---------------------------------------------------------------------------

def _parse_sse_event(chunk: str) -> dict | None:
    """Extract the JSON payload from an SSE data line."""
    for line in chunk.split("\n"):
        if line.startswith("data: "):
            payload = line[6:].strip()
            if payload and payload != "[DONE]":
                try:
                    return json.loads(payload)
                except json.JSONDecodeError:
                    pass
    return None


def _update_ai_generation_steps(
    grant_id: str,
    steps: list,
    status: str,
    status_col: str,
    steps_col: str,
    error_col: str,
    error: str | None = None,
) -> None:
    """Write skeleton or draft progress steps to DB (synchronous, own engine)."""
    from app.config import get_settings

    settings = get_settings()
    engine = create_engine(settings.database_url, pool_pre_ping=True)
    try:
        with engine.connect() as conn:
            conn.execute(
                text(
                    f"UPDATE active_grants SET {status_col} = :status, "
                    f"{steps_col} = :steps, {error_col} = :error, "
                    "updated_at = NOW() WHERE id = :id"
                ),
                {
                    "status": status,
                    "steps": json.dumps(steps),
                    "error": error,
                    "id": grant_id,
                },
            )
            conn.commit()
    except Exception as e:
        logger.warning("_update_ai_generation_steps failed for grant %s: %s", grant_id, e)
    finally:
        engine.dispose()


# Skeleton step mapping -------------------------------------------------------

_SKELETON_STEPS_INIT = [
    {"id": "style",     "label": "Building style profile…",         "status": "active"},
    {"id": "archive",   "label": "Retrieving similar grants…",      "status": "pending"},
    {"id": "strategy",  "label": "Synthesizing call strategy…",     "status": "pending"},
    {"id": "alignment", "label": "Aligning idea to call…",          "status": "pending"},
    {"id": "synthesis", "label": "Generating proposal skeleton…",   "status": "pending"},
]


def _map_skeleton_event(event_name: str) -> list | None:
    """Return the full step list after a given SSE event, or None to keep current."""
    transitions = {
        "skeleton_start": [
            {"id": "style",     "label": "Building style profile…",        "status": "active"},
            {"id": "archive",   "label": "Retrieving similar grants…",     "status": "pending"},
            {"id": "strategy",  "label": "Synthesizing call strategy…",    "status": "pending"},
            {"id": "alignment", "label": "Aligning idea to call…",         "status": "pending"},
            {"id": "synthesis", "label": "Generating proposal skeleton…",  "status": "pending"},
        ],
        "style_profile_complete": [
            {"id": "style",     "label": "Style profile built",            "status": "done"},
            {"id": "archive",   "label": "Retrieving similar grants…",     "status": "active"},
            {"id": "strategy",  "label": "Synthesizing call strategy…",    "status": "pending"},
            {"id": "alignment", "label": "Aligning idea to call…",         "status": "pending"},
            {"id": "synthesis", "label": "Generating proposal skeleton…",  "status": "pending"},
        ],
        "archive_retrieval_complete": [
            {"id": "style",     "label": "Style profile built",            "status": "done"},
            {"id": "archive",   "label": "Similar grants retrieved",       "status": "done"},
            {"id": "strategy",  "label": "Synthesizing call strategy…",    "status": "active"},
            {"id": "alignment", "label": "Aligning idea to call…",         "status": "pending"},
            {"id": "synthesis", "label": "Generating proposal skeleton…",  "status": "pending"},
        ],
        "call_strategy_complete": [
            {"id": "style",     "label": "Style profile built",            "status": "done"},
            {"id": "archive",   "label": "Similar grants retrieved",       "status": "done"},
            {"id": "strategy",  "label": "Call strategy synthesized",      "status": "done"},
            {"id": "alignment", "label": "Aligning idea to call…",         "status": "active"},
            {"id": "synthesis", "label": "Generating proposal skeleton…",  "status": "pending"},
        ],
        "idea_alignment_complete": [
            {"id": "style",     "label": "Style profile built",            "status": "done"},
            {"id": "archive",   "label": "Similar grants retrieved",       "status": "done"},
            {"id": "strategy",  "label": "Call strategy synthesized",      "status": "done"},
            {"id": "alignment", "label": "Idea aligned to call",           "status": "done"},
            {"id": "synthesis", "label": "Generating proposal skeleton…",  "status": "active"},
        ],
        "skeleton_complete": [
            {"id": "style",     "label": "Style profile built",            "status": "done"},
            {"id": "archive",   "label": "Similar grants retrieved",       "status": "done"},
            {"id": "strategy",  "label": "Call strategy synthesized",      "status": "done"},
            {"id": "alignment", "label": "Idea aligned to call",           "status": "done"},
            {"id": "synthesis", "label": "Proposal skeleton generated",    "status": "done"},
        ],
    }
    return transitions.get(event_name)


# Draft step mapping ----------------------------------------------------------

def _make_draft_steps(
    planning: str = "pending",
    research_label: str = "Researching sections…",
    research: str = "pending",
    draft_label: str = "Drafting sections…",
    draft: str = "pending",
    meta_label: str = "Meta-agent review…",
    meta: str = "pending",
    assemble: str = "pending",
) -> list:
    return [
        {"id": "planning",  "label": "Planning research approach",  "status": planning},
        {"id": "research",  "label": research_label,                 "status": research},
        {"id": "drafting",  "label": draft_label,                    "status": draft},
        {"id": "meta",      "label": meta_label,                     "status": meta},
        {"id": "assemble",  "label": "Assembling final document…",   "status": assemble},
    ]


def _map_draft_event(event: dict, current_steps: list) -> list | None:
    """Return updated step list after a draft SSE event, or None to keep current."""
    name = event.get("event", "")
    total = event.get("total", "")

    if name == "planning_start":
        return _make_draft_steps(planning="active")
    if name == "planning_complete":
        return _make_draft_steps(planning="done", research_label=f"Researching {total} sections…", research="active")
    if name == "research_start":
        return _make_draft_steps(planning="done", research_label=f"Researching 0/{total} sections…", research="active")
    if name == "research_complete":
        return _make_draft_steps(planning="done", research_label=f"Research complete ({total} sections)", research="done",
                                 draft_label=f"Drafting 0/{total} sections…", draft="active")
    if name == "section_start":
        idx = event.get("index", 0)
        tot = event.get("total", 0)
        return _make_draft_steps(
            planning="done",
            research_label=f"Research complete ({tot} sections)", research="done",
            draft_label=f"Drafting section {idx + 1}/{tot}…", draft="active",
        )
    if name == "meta_agent_start":
        tot = event.get("total", "")
        return _make_draft_steps(
            planning="done",
            research_label="Research complete", research="done",
            draft_label="All sections drafted", draft="done",
            meta_label=f"Meta-agent reviewing 0/{tot} sections…", meta="active",
        )
    if name in ("section_complete",) and current_steps:
        # During meta-agent phase, update the meta step label per section
        idx = event.get("index", 0)
        tot = event.get("total", 0)
        # Determine current phase by checking what's active
        for s in current_steps:
            if s["id"] == "meta" and s["status"] == "active":
                return _make_draft_steps(
                    planning="done",
                    research_label="Research complete", research="done",
                    draft_label="All sections drafted", draft="done",
                    meta_label=f"Meta-agent reviewed {idx + 1}/{tot} sections…", meta="active",
                )
        return None
    if name in ("coherence_check", "compliance_pass", "bibliography_start"):
        return _make_draft_steps(
            planning="done",
            research_label="Research complete", research="done",
            draft_label="All sections drafted", draft="done",
            meta_label="Meta-agent review complete", meta="done",
            assemble="active",
        )
    if name == "draft_complete":
        return _make_draft_steps(
            planning="done",
            research_label="Research complete", research="done",
            draft_label="All sections drafted", draft="done",
            meta_label="Meta-agent review complete", meta="done",
            assemble="done",
        )
    return None


# ---------------------------------------------------------------------------
# Skeleton background task
# ---------------------------------------------------------------------------

@celery_app.task(
    name="app.workers.grant_writing_tasks.generate_skeleton_task",
    bind=True,
    max_retries=0,
    soft_time_limit=600,
    time_limit=660,
)
def generate_skeleton_task(self, grant_id: str, user_id: str) -> dict:
    """Run skeleton generation in the background; push step updates to DB for UI polling."""
    from app.config import get_settings

    logger.info("generate_skeleton_task started for grant %s", grant_id)

    def _upd(steps: list, status: str = "running", error: str | None = None) -> None:
        _update_ai_generation_steps(
            grant_id, steps, status,
            "skeleton_status", "skeleton_steps", "skeleton_error", error=error,
        )

    _upd(_SKELETON_STEPS_INIT)

    try:
        settings = get_settings()
        async_url = settings.database_url.replace("postgresql://", "postgresql+asyncpg://", 1)

        async def _run() -> None:
            from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
            from app.models.active_grant import ActiveGrant
            from app.ai.orchestrator.grant_writing import GrantWritingOrchestrator

            engine = create_async_engine(async_url, pool_pre_ping=True)
            try:
                async with AsyncSession(engine) as db:
                    grant = await db.get(ActiveGrant, grant_id)
                    if not grant:
                        _upd([], "failed", f"Grant {grant_id} not found")
                        return
                    orchestrator = GrantWritingOrchestrator()
                    current_steps: list = list(_SKELETON_STEPS_INIT)
                    async for chunk in orchestrator.generate_skeleton_stream(grant, db):
                        event = _parse_sse_event(chunk)
                        if event:
                            new_steps = _map_skeleton_event(event.get("event", ""))
                            if new_steps is not None:
                                current_steps = new_steps
                                _upd(current_steps)
            finally:
                await engine.dispose()

        asyncio.run(_run())

        final = _map_skeleton_event("skeleton_complete") or []
        _upd(final, "completed")
        logger.info("generate_skeleton_task completed for grant %s", grant_id)
        return {"status": "completed", "grant_id": grant_id}

    except SoftTimeLimitExceeded:
        msg = "Skeleton generation timed out. Please try again."
        _upd([{"id": "synthesis", "label": "Timed out", "status": "error", "detail": msg}], "failed", msg)
        return {"status": "failed", "error": msg}

    except Exception as exc:
        msg = str(exc)[:2000]
        logger.exception("generate_skeleton_task failed for grant %s: %s", grant_id, exc)
        _upd([{"id": "synthesis", "label": "Skeleton generation failed", "status": "error", "detail": msg}], "failed", msg)
        return {"status": "failed", "error": msg}


# ---------------------------------------------------------------------------
# Draft background task
# ---------------------------------------------------------------------------

@celery_app.task(
    name="app.workers.grant_writing_tasks.generate_draft_task",
    bind=True,
    max_retries=0,
    soft_time_limit=5400,
    time_limit=5460,
)
def generate_draft_task(
    self,
    grant_id: str,
    user_id: str,
    flagged_sections: list | None = None,
) -> dict:
    """Run full draft generation in the background; push step updates to DB for UI polling."""
    from app.config import get_settings

    logger.info("generate_draft_task started for grant %s", grant_id)

    init_steps = _make_draft_steps(planning="active")

    def _upd(steps: list, status: str = "running", error: str | None = None) -> None:
        _update_ai_generation_steps(
            grant_id, steps, status,
            "draft_status", "draft_steps", "draft_error", error=error,
        )

    _upd(init_steps)

    try:
        settings = get_settings()
        async_url = settings.database_url.replace("postgresql://", "postgresql+asyncpg://", 1)

        async def _run() -> None:
            from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
            from app.models.active_grant import ActiveGrant
            from app.ai.orchestrator.grant_writing import GrantWritingOrchestrator

            engine = create_async_engine(async_url, pool_pre_ping=True)
            try:
                async with AsyncSession(engine) as db:
                    grant = await db.get(ActiveGrant, grant_id)
                    if not grant:
                        _upd([], "failed", f"Grant {grant_id} not found")
                        return
                    orchestrator = GrantWritingOrchestrator()
                    current_steps: list = list(init_steps)
                    async for chunk in orchestrator.generate_draft_stream(
                        grant, db, flagged_sections=flagged_sections
                    ):
                        event = _parse_sse_event(chunk)
                        if event:
                            new_steps = _map_draft_event(event, current_steps)
                            if new_steps is not None:
                                current_steps = new_steps
                                _upd(current_steps)
            finally:
                await engine.dispose()

        asyncio.run(_run())

        final = _make_draft_steps(
            planning="done", research_label="Research complete", research="done",
            draft_label="All sections drafted", draft="done",
            meta_label="Meta-agent review complete", meta="done", assemble="done",
        )
        _upd(final, "completed")
        logger.info("generate_draft_task completed for grant %s", grant_id)
        return {"status": "completed", "grant_id": grant_id}

    except SoftTimeLimitExceeded:
        msg = "Draft generation timed out. Please try again."
        _upd([{"id": "assemble", "label": "Timed out", "status": "error", "detail": msg}], "failed", msg)
        return {"status": "failed", "error": msg}

    except Exception as exc:
        msg = str(exc)[:2000]
        logger.exception("generate_draft_task failed for grant %s: %s", grant_id, exc)
        _upd([{"id": "assemble", "label": "Draft generation failed", "status": "error", "detail": msg}], "failed", msg)
        return {"status": "failed", "error": msg}

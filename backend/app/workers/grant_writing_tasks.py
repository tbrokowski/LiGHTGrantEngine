"""Background grant writing tasks — long-running call analysis off the API process."""
import asyncio
from app.db_sync import get_sync_engine
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
    engine = get_sync_engine()
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
        pass  # shared, process-cached engine — never dispose


def _update_steps(grant_id: str, steps: list) -> None:
    """Write step-level progress to DB so the UI can poll it."""
    from app.config import get_settings

    settings = get_settings()
    engine = get_sync_engine()
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
        pass  # shared, process-cached engine — never dispose


def _recover_stale_call_analysis() -> list[str]:
    """
    Find active_grants stuck in call_analysis_status='running' for longer than
    STALE_THRESHOLD_MINUTES and mark them failed so users can retry.
    """
    from app.config import get_settings

    settings = get_settings()
    engine = get_sync_engine()
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
        pass  # shared, process-cached engine — never dispose
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
    engine = get_sync_engine()
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
                completed_at=datetime.now(timezone.utc),
            )
            db.add(run)
            db.commit()
    finally:
        pass  # shared, process-cached engine — never dispose


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

        # Reviewer-grade critique: read the call as an evaluation panel would
        # (rubric, weightings, wins/loses, red flags, per-section expectations) so
        # the whole pipeline drafts against how it will actually be judged.
        try:
            from app.ai.agents.call_reviewer import review_call
            review = asyncio.run(review_call(call_text=call_text, call_analysis=result, funder=funder))
            if review:
                result["reviewer_brief"] = review
        except Exception as exc:
            logger.warning("call_reviewer skipped: %s", exc)

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

        # Fire-and-forget meta-synthesis to enrich call_intelligence
        try:
            celery_app.send_task(
                "app.workers.grant_writing_tasks.synthesize_call_intelligence_task",
                args=[grant_id],
                queue="summaries",
            )
            logger.info("synthesize_call_intelligence_task queued for grant %s", grant_id)
        except Exception as exc:
            logger.warning("Failed to queue meta-synthesis for grant %s: %s", grant_id, exc)

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
    engine = get_sync_engine()
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
        pass  # shared, process-cached engine — never dispose


# Skeleton step mapping -------------------------------------------------------

_SKELETON_STEPS_INIT = [
    {"id": "style",     "label": "Building style profile…",              "status": "active"},
    {"id": "archive",   "label": "Retrieving similar grants…",           "status": "pending"},
    {"id": "strategy",  "label": "Synthesizing call strategy…",          "status": "pending"},
    {"id": "alignment", "label": "Aligning idea to call…",               "status": "pending"},
    {"id": "planning",  "label": "Planning section research…",           "status": "pending"},
    {"id": "research",  "label": "Gathering evidence per section…",      "status": "pending"},
    {"id": "synthesis", "label": "Generating grounded skeleton…",        "status": "pending"},
    {"id": "review",    "label": "Reviewing alignment…",                 "status": "pending"},
]


def _map_skeleton_event(event_name: str) -> list | None:
    """Return the full step list after a given SSE event, or None to keep current."""
    done = "done"
    active = "active"
    pending = "pending"

    base_done = [
        {"id": "style",     "label": "Style profile built",              "status": done},
        {"id": "archive",   "label": "Similar grants retrieved",         "status": done},
        {"id": "strategy",  "label": "Call strategy synthesized",        "status": done},
        {"id": "alignment", "label": "Idea aligned to call",             "status": done},
        {"id": "planning",  "label": "Section research planned",         "status": done},
        {"id": "research",  "label": "Evidence gathered",                "status": done},
        {"id": "synthesis", "label": "Proposal skeleton generated",      "status": done},
        {"id": "review",    "label": "Alignment reviewed",               "status": done},
    ]

    transitions: dict[str, list] = {
        "skeleton_start": [
            {"id": "style",     "label": "Building style profile…",          "status": active},
            {"id": "archive",   "label": "Retrieving similar grants…",       "status": pending},
            {"id": "strategy",  "label": "Synthesizing call strategy…",      "status": pending},
            {"id": "alignment", "label": "Aligning idea to call…",           "status": pending},
            {"id": "planning",  "label": "Planning section research…",       "status": pending},
            {"id": "research",  "label": "Gathering evidence per section…",  "status": pending},
            {"id": "synthesis", "label": "Generating grounded skeleton…",    "status": pending},
            {"id": "review",    "label": "Reviewing alignment…",             "status": pending},
        ],
        "style_profile_complete": [
            {"id": "style",     "label": "Style profile built",              "status": done},
            {"id": "archive",   "label": "Retrieving similar grants…",       "status": active},
            {"id": "strategy",  "label": "Synthesizing call strategy…",      "status": pending},
            {"id": "alignment", "label": "Aligning idea to call…",           "status": pending},
            {"id": "planning",  "label": "Planning section research…",       "status": pending},
            {"id": "research",  "label": "Gathering evidence per section…",  "status": pending},
            {"id": "synthesis", "label": "Generating grounded skeleton…",    "status": pending},
            {"id": "review",    "label": "Reviewing alignment…",             "status": pending},
        ],
        "archive_retrieval_complete": [
            {"id": "style",     "label": "Style profile built",              "status": done},
            {"id": "archive",   "label": "Similar grants retrieved",         "status": done},
            {"id": "strategy",  "label": "Synthesizing call strategy…",      "status": active},
            {"id": "alignment", "label": "Aligning idea to call…",           "status": pending},
            {"id": "planning",  "label": "Planning section research…",       "status": pending},
            {"id": "research",  "label": "Gathering evidence per section…",  "status": pending},
            {"id": "synthesis", "label": "Generating grounded skeleton…",    "status": pending},
            {"id": "review",    "label": "Reviewing alignment…",             "status": pending},
        ],
        "call_strategy_complete": [
            {"id": "style",     "label": "Style profile built",              "status": done},
            {"id": "archive",   "label": "Similar grants retrieved",         "status": done},
            {"id": "strategy",  "label": "Call strategy synthesized",        "status": done},
            {"id": "alignment", "label": "Aligning idea to call…",           "status": active},
            {"id": "planning",  "label": "Planning section research…",       "status": pending},
            {"id": "research",  "label": "Gathering evidence per section…",  "status": pending},
            {"id": "synthesis", "label": "Generating grounded skeleton…",    "status": pending},
            {"id": "review",    "label": "Reviewing alignment…",             "status": pending},
        ],
        "idea_alignment_complete": [
            {"id": "style",     "label": "Style profile built",              "status": done},
            {"id": "archive",   "label": "Similar grants retrieved",         "status": done},
            {"id": "strategy",  "label": "Call strategy synthesized",        "status": done},
            {"id": "alignment", "label": "Idea aligned to call",             "status": done},
            {"id": "planning",  "label": "Planning section research…",       "status": active},
            {"id": "research",  "label": "Gathering evidence per section…",  "status": pending},
            {"id": "synthesis", "label": "Generating grounded skeleton…",    "status": pending},
            {"id": "review",    "label": "Reviewing alignment…",             "status": pending},
        ],
        "skeleton_planning_complete": [
            {"id": "style",     "label": "Style profile built",              "status": done},
            {"id": "archive",   "label": "Similar grants retrieved",         "status": done},
            {"id": "strategy",  "label": "Call strategy synthesized",        "status": done},
            {"id": "alignment", "label": "Idea aligned to call",             "status": done},
            {"id": "planning",  "label": "Section research planned",         "status": done},
            {"id": "research",  "label": "Gathering evidence per section…",  "status": active},
            {"id": "synthesis", "label": "Generating grounded skeleton…",    "status": pending},
            {"id": "review",    "label": "Reviewing alignment…",             "status": pending},
        ],
        "skeleton_research_complete": [
            {"id": "style",     "label": "Style profile built",              "status": done},
            {"id": "archive",   "label": "Similar grants retrieved",         "status": done},
            {"id": "strategy",  "label": "Call strategy synthesized",        "status": done},
            {"id": "alignment", "label": "Idea aligned to call",             "status": done},
            {"id": "planning",  "label": "Section research planned",         "status": done},
            {"id": "research",  "label": "Evidence gathered",                "status": done},
            {"id": "synthesis", "label": "Generating grounded skeleton…",    "status": active},
            {"id": "review",    "label": "Reviewing alignment…",             "status": pending},
        ],
        "skeleton_synthesis_start": [
            {"id": "style",     "label": "Style profile built",              "status": done},
            {"id": "archive",   "label": "Similar grants retrieved",         "status": done},
            {"id": "strategy",  "label": "Call strategy synthesized",        "status": done},
            {"id": "alignment", "label": "Idea aligned to call",             "status": done},
            {"id": "planning",  "label": "Section research planned",         "status": done},
            {"id": "research",  "label": "Evidence gathered",                "status": done},
            {"id": "synthesis", "label": "Generating grounded skeleton…",    "status": active},
            {"id": "review",    "label": "Reviewing alignment…",             "status": pending},
        ],
        "skeleton_complete": base_done,
    }
    return transitions.get(event_name)


# Draft step mapping ----------------------------------------------------------

def _make_draft_steps(
    orchestrator: str = "pending",
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
        {"id": "orchestrator", "label": "Building draft execution plan", "status": orchestrator},
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

    if name == "orchestrator_start":
        return _make_draft_steps(orchestrator="active")
    if name == "orchestrator_complete":
        return _make_draft_steps(orchestrator="done", planning="active")
    if name == "planning_start":
        return _make_draft_steps(orchestrator="done", planning="active")
    if name == "planning_complete":
        return _make_draft_steps(orchestrator="done", planning="done", research_label=f"Researching {total} sections…", research="active")
    if name == "research_start":
        return _make_draft_steps(orchestrator="done", planning="done", research_label=f"Researching 0/{total} sections…", research="active")
    if name == "section_evidence_ready":
        sec = event.get("section", "")
        ex = event.get("exemplar_count", 0)
        ke = event.get("key_evidence_count", 0)
        tier = event.get("research_tier", "")
        detail = f"{sec}: {ex} archive, {ke} claims ({tier})"
        if current_steps:
            for s in current_steps:
                if s["id"] == "research" and s["status"] == "active":
                    return _make_draft_steps(
                        orchestrator="done", planning="done",
                        research_label=f"Evidence: {detail}", research="active",
                    )
        return None
    if name == "section_research_degraded":
        sec = event.get("section", "")
        if current_steps:
            for s in current_steps:
                if s["id"] == "research":
                    return _make_draft_steps(
                        orchestrator="done", planning="done",
                        research_label=f"⚠ {sec}: no archive hits", research="active",
                    )
        return None
    if name == "research_complete":
        return _make_draft_steps(orchestrator="done", planning="done", research_label=f"Research complete ({total} sections)", research="done",
                                 draft_label=f"Drafting 0/{total} sections…", draft="active")
    if name == "section_start":
        idx = event.get("index", 0)
        tot = event.get("total", 0)
        return _make_draft_steps(
            orchestrator="done",
            planning="done",
            research_label=f"Research complete ({tot} sections)", research="done",
            draft_label=f"Drafting section {idx + 1}/{tot}…", draft="active",
        )
    if name == "meta_agent_start":
        tot = event.get("total", "")
        return _make_draft_steps(
            orchestrator="done",
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
                    orchestrator="done",
                    planning="done",
                    research_label="Research complete", research="done",
                    draft_label="All sections drafted", draft="done",
                    meta_label=f"Meta-agent reviewed {idx + 1}/{tot} sections…", meta="active",
                )
        return None
    if name in ("coherence_check", "compliance_pass", "bibliography_start"):
        return _make_draft_steps(
            orchestrator="done",
            planning="done",
            research_label="Research complete", research="done",
            draft_label="All sections drafted", draft="done",
            meta_label="Meta-agent review complete", meta="done",
            assemble="active",
        )
    if name == "draft_complete":
        return _make_draft_steps(
            orchestrator="done",
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
def generate_skeleton_task(
    self,
    grant_id: str,
    user_id: str,
    user_section_constraints: list[dict] | None = None,
    user_total_word_limit: int | None = None,
    user_total_page_limit: str | None = None,
) -> dict:
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
                async with AsyncSession(engine, expire_on_commit=False) as db:
                    grant = await db.get(ActiveGrant, grant_id)
                    if not grant:
                        _upd([], "failed", f"Grant {grant_id} not found")
                        return
                    orchestrator = GrantWritingOrchestrator()
                    current_steps: list = list(_SKELETON_STEPS_INIT)
                    async for chunk in orchestrator.generate_skeleton_stream(
                        grant,
                        db,
                        user_section_constraints=user_section_constraints,
                        user_total_word_limit=user_total_word_limit,
                        user_total_page_limit=user_total_page_limit,
                    ):
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


async def _flush_llm_usage(db, user_id: str | None, grant_id: str | None) -> None:
    """Persist the buffered per-call LLM usage for this run + roll up the user's
    running AI spend. Best-effort — never fail the draft over accounting."""
    try:
        from app.ai import providers as _providers
        from app.models.llm_usage import LLMUsage
        from app.models.user import User

        usage = _providers.get_usage()
        if not usage:
            return
        total_cents = 0
        for u in usage:
            db.add(LLMUsage(
                user_id=user_id, grant_id=grant_id,
                provider=u.get("provider", "openai"), model=u.get("model", ""),
                agent=u.get("agent"), prompt_tokens=int(u.get("prompt_tokens", 0)),
                completion_tokens=int(u.get("completion_tokens", 0)),
                cost_cents=int(u.get("cost_cents", 0)),
            ))
            total_cents += int(u.get("cost_cents", 0))
        if user_id and total_cents:
            user = await db.get(User, user_id)
            if user:
                user.ai_usage_cents = (user.ai_usage_cents or 0) + total_cents
        await db.commit()
    except Exception as exc:
        logger.warning("llm usage flush failed: %s", exc)


# ---------------------------------------------------------------------------
# Draft background task
# ---------------------------------------------------------------------------

@celery_app.task(
    name="app.workers.grant_writing_tasks.generate_draft_task",
    bind=True,
    max_retries=0,
    soft_time_limit=10800,
    time_limit=10920,
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

    init_steps = _make_draft_steps(orchestrator="active")

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

            from app.ai import providers as _providers
            from app.routers.api_keys import load_user_provider_keys

            engine = create_async_engine(async_url, pool_pre_ping=True)
            try:
                async with AsyncSession(engine, expire_on_commit=False) as db:
                    grant = await db.get(ActiveGrant, grant_id)
                    if not grant:
                        _upd([], "failed", f"Grant {grant_id} not found")
                        return

                    # Route LLM calls through the running user's own provider keys
                    # (if any) and collect usage for this run.
                    try:
                        user_keys = await load_user_provider_keys(db, user_id) if user_id else {}
                    except Exception:
                        user_keys = {}
                    _providers.set_request_context(user_id, user_keys, grant_id)
                    _providers.reset_usage()

                    orchestrator = GrantWritingOrchestrator()
                    current_steps: list = list(init_steps)
                    try:
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
                        await _flush_llm_usage(db, user_id, grant_id)
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


# ── Conversation summarization ────────────────────────────────────────────────

@celery_app.task(
    bind=True,
    name="app.workers.grant_writing_tasks.summarize_conversation_task",
    max_retries=1,
    default_retry_delay=30,
    soft_time_limit=120,
    time_limit=150,
)
def summarize_conversation_task(self, grant_id: str) -> dict:
    """
    Summarize the conversation history for a grant and store it in conv.summary.
    This keeps the GrantContextManager context window lean for long conversations.
    Fired fire-and-forget from writing_chat_stream when len(conv.messages) >= 18.
    """
    logger.info("summarize_conversation_task started for grant %s", grant_id)
    try:
        settings = get_settings()
        async_url = settings.database_url.replace("postgresql://", "postgresql+asyncpg://", 1)

        async def _run() -> None:
            from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
            from sqlalchemy import select
            from app.models.grant_writing import GrantWritingConversation
            from app.ai.client import chat_complete

            engine = create_async_engine(async_url, pool_pre_ping=True)
            try:
                async with AsyncSession(engine, expire_on_commit=False) as db:
                    result = await db.execute(
                        select(GrantWritingConversation).where(
                            GrantWritingConversation.grant_id == grant_id
                        )
                    )
                    conv = result.scalar_one_or_none()
                    if not conv or not conv.messages:
                        return

                    messages_text = "\n".join(
                        f"{m['role'].upper()}: {m['content'][:300]}"
                        for m in (conv.messages or [])
                        if isinstance(m, dict) and m.get("content")
                    )

                    summary = await chat_complete(
                        messages=[
                            {
                                "role": "system",
                                "content": (
                                    "You are a grant writing assistant. Summarize the key topics, "
                                    "decisions, and information from this conversation in ~300 words. "
                                    "Focus on what is most important for continuing the conversation "
                                    "about this grant proposal. Be concise and factual."
                                ),
                            },
                            {
                                "role": "user",
                                "content": f"Summarize this conversation:\n\n{messages_text[:6000]}",
                            },
                        ],
                        agent_name="call_analyzer_classifier",
                        max_tokens=400,
                    )

                    conv.summary = summary
                    await db.commit()
                    logger.info("Conversation summarized for grant %s (%d chars)", grant_id, len(summary))
            finally:
                await engine.dispose()

        asyncio.run(_run())
        return {"status": "completed", "grant_id": grant_id}

    except Exception as exc:
        logger.warning("summarize_conversation_task failed for grant %s: %s", grant_id, exc)
        return {"status": "failed", "error": str(exc)[:500]}


# ── Grant meta-synthesis ──────────────────────────────────────────────────────

@celery_app.task(
    bind=True,
    name="app.workers.grant_writing_tasks.synthesize_call_intelligence_task",
    max_retries=1,
    default_retry_delay=30,
    soft_time_limit=300,
    time_limit=360,
)
def synthesize_call_intelligence_task(self, grant_id: str) -> dict:
    """
    Run the Grant Meta-Synthesizer after call analysis completes.
    Reads call_analysis + grant_idea + existing_skeleton from the grant,
    produces call_intelligence and writes it back.
    Fired fire-and-forget from analyze_grant_call.
    """
    logger.info("synthesize_call_intelligence_task started for grant %s", grant_id)
    try:
        settings = get_settings()
        async_url = settings.database_url.replace("postgresql://", "postgresql+asyncpg://", 1)

        async def _run() -> None:
            from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
            from app.models.active_grant import ActiveGrant
            from app.ai.agents.grant_meta_synthesizer import GrantMetaSynthesizer

            engine = create_async_engine(async_url, pool_pre_ping=True)
            try:
                async with AsyncSession(engine, expire_on_commit=False) as db:
                    grant = await db.get(ActiveGrant, grant_id)
                    if not grant:
                        logger.warning("synthesize_call_intelligence: grant %s not found", grant_id)
                        return
                    if not grant.call_analysis:
                        logger.warning("synthesize_call_intelligence: no call_analysis for grant %s", grant_id)
                        return

                    synthesizer = GrantMetaSynthesizer()
                    call_intelligence = await synthesizer.synthesize(
                        call_analysis=grant.call_analysis or {},
                        grant_idea=grant.grant_idea or "",
                        existing_skeleton=grant.proposal_skeleton or {},
                        funder=grant.funder or "",
                        title=grant.title or "",
                    )
                    grant.call_intelligence = call_intelligence
                    await db.commit()
                    logger.info(
                        "synthesize_call_intelligence_task completed for grant %s (call_type=%s)",
                        grant_id,
                        call_intelligence.get("call_type_label", "?"),
                    )
            finally:
                await engine.dispose()

        asyncio.run(_run())
        return {"status": "completed", "grant_id": grant_id}

    except Exception as exc:
        logger.warning("synthesize_call_intelligence_task failed for grant %s: %s", grant_id, exc)
        return {"status": "failed", "error": str(exc)[:500]}


# ── Expert reviewer ───────────────────────────────────────────────────────────

def _fmt_review_comment(comment: str, suggestion: str = "", criterion: str = "") -> str:
    parts = [comment.strip()]
    if suggestion:
        parts.append(f"Suggestion: {suggestion.strip()}")
    if criterion:
        parts.append(f"Re: {criterion.strip()}")
    return "\n\n".join(p for p in parts if p)


@celery_app.task(
    name="app.workers.grant_writing_tasks.run_expert_review_task",
    bind=True,
    max_retries=0,
    soft_time_limit=1200,
    time_limit=1320,
)
def run_expert_review_task(self, grant_id: str, user_id: str) -> dict:
    """Strict expert review of the full draft → writes anchored `Comment` rows."""
    import uuid as _uuid
    from app.config import get_settings

    logger.info("run_expert_review_task started for grant %s", grant_id)
    settings = get_settings()
    async_url = settings.database_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    async def _run() -> dict:
        from sqlalchemy import select
        from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
        from app.models.active_grant import ActiveGrant
        from app.models.comment import Comment
        from app.ai.context.grant_context import parse_document_sections
        from app.ai.agents.expert_reviewer import run_expert_review
        from app.ai import providers as _providers
        from app.routers.api_keys import load_user_provider_keys

        engine = create_async_engine(async_url, pool_pre_ping=True)
        try:
            async with AsyncSession(engine, expire_on_commit=False) as db:
                grant = await db.get(ActiveGrant, grant_id)
                if not grant:
                    return {"status": "failed", "error": "grant not found"}

                grant.ai_review_status = "running"
                grant.ai_review_error = None
                await db.commit()

                try:
                    user_keys = await load_user_provider_keys(db, user_id) if user_id else {}
                except Exception:
                    user_keys = {}
                _providers.set_request_context(user_id, user_keys, grant_id)
                _providers.reset_usage()

                html = grant.editor_document or ""
                skeleton = grant.proposal_skeleton or None
                sections = [
                    {"title": s.title, "plain_text": s.plain_text, "word_count": s.word_count}
                    for s in parse_document_sections(html, skeleton)
                    if (s.plain_text or "").strip()
                ]
                if not sections:
                    grant.ai_review_status = "failed"
                    grant.ai_review_error = "The draft is empty — nothing to review yet."
                    await db.commit()
                    return {"status": "failed", "error": "empty draft"}

                result = await run_expert_review(
                    sections,
                    funder=grant.funder or "",
                    program=grant.program or "",
                    call_url=grant.call_url or "",
                    call_analysis=grant.call_analysis or {},
                )

                # Clear prior AI comments that are unresolved and have no replies;
                # keep resolved ones and any the user has replied to.
                existing = (await db.execute(
                    select(Comment).where(
                        Comment.entity_type == "grant",
                        Comment.entity_id == grant_id,
                        Comment.document_id == "draft",
                        Comment.source == "ai_reviewer",
                    )
                )).scalars().all()
                ai_ids = {c.id for c in existing}
                replied_parents: set[str] = set()
                if ai_ids:
                    replied_parents = set((await db.execute(
                        select(Comment.parent_id).where(Comment.parent_id.in_(ai_ids))
                    )).scalars().all())
                for c in existing:
                    if not c.resolved and c.id not in replied_parents:
                        await db.delete(c)

                title_set = {s["title"] for s in sections}

                def _add(anchor: str | None, text: str, severity: str):
                    db.add(Comment(
                        id=str(_uuid.uuid4()),
                        entity_type="grant",
                        entity_id=grant_id,
                        author_id=user_id,
                        text=text,
                        anchor_text=anchor,
                        resolved=False,
                        source="ai_reviewer",
                        severity=severity,
                        document_id="draft",
                    ))

                n = 0
                for mc in result.get("macro_comments", []):
                    sec = mc.get("section") or ""
                    anchor = sec if sec in title_set else None
                    _add(anchor, _fmt_review_comment(mc.get("comment", ""), mc.get("suggestion", ""), mc.get("criterion", "")), mc.get("severity", "major"))
                    n += 1
                for tc in result.get("targeted_comments", []):
                    anchor = tc.get("anchor_text") or (tc.get("section") if tc.get("section") in title_set else None)
                    if not tc.get("comment"):
                        continue
                    _add(anchor, _fmt_review_comment(tc.get("comment", ""), tc.get("suggestion", ""), tc.get("criterion", "")), tc.get("severity", "minor"))
                    n += 1

                grant.ai_review_summary = {
                    **(result.get("overall") or {}),
                    "comment_count": n,
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                }
                grant.ai_review_status = "completed"
                grant.ai_review_error = None

                try:
                    await _flush_llm_usage(db, user_id, grant_id)
                except Exception:
                    pass
                await db.commit()
                logger.info("run_expert_review_task wrote %d comments for grant %s", n, grant_id)
                return {"status": "completed", "grant_id": grant_id, "comments": n}
        finally:
            await engine.dispose()

    try:
        return asyncio.run(_run())
    except SoftTimeLimitExceeded:
        _mark_review_failed(async_url, grant_id, "Review timed out. Please try again.")
        return {"status": "failed", "error": "timed out"}
    except Exception as exc:
        logger.exception("run_expert_review_task failed for grant %s: %s", grant_id, exc)
        _mark_review_failed(async_url, grant_id, str(exc)[:500])
        return {"status": "failed", "error": str(exc)[:500]}


def _mark_review_failed(async_url: str, grant_id: str, msg: str) -> None:
    async def _f():
        from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
        from app.models.active_grant import ActiveGrant
        engine = create_async_engine(async_url, pool_pre_ping=True)
        try:
            async with AsyncSession(engine, expire_on_commit=False) as db:
                grant = await db.get(ActiveGrant, grant_id)
                if grant:
                    grant.ai_review_status = "failed"
                    grant.ai_review_error = msg
                    await db.commit()
        finally:
            await engine.dispose()
    try:
        asyncio.run(_f())
    except Exception:
        pass

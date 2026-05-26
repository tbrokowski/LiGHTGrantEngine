"""Celery tasks for per-institution grant surfacing and preseed."""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


def _run_async(coro):
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                return pool.submit(asyncio.run, coro).result()
        return loop.run_until_complete(coro)
    except RuntimeError:
        return asyncio.run(coro)


@celery_app.task(name="app.workers.surfacing_tasks.preseed_institution_grants", bind=True, max_retries=2)
def preseed_institution_grants(self, institution_id: str) -> dict:
    from app.config import get_settings
    from app.models.institution import Institution
    from app.models.preseed_run import PreseedRun, PreseedRunStatus
    from app.services.grant_bootstrap import bootstrap_institution_feed, fan_out_sources_to_institutions

    settings = get_settings()
    engine = create_engine(settings.database_url)
    run_id = str(uuid.uuid4())

    with Session(engine) as db:
        run = PreseedRun(id=run_id, institution_id=institution_id, status=PreseedRunStatus.RUNNING)
        db.add(run)
        db.commit()

        try:
            fan_out_sources_to_institutions(db)
            count = bootstrap_institution_feed(db, institution_id)
            inst = db.get(Institution, institution_id)
            if inst and not (inst.grant_profile or {}).get("keywords"):
                from app.config import get_settings as gs
                cfg = gs().fit_scoring
                inst.grant_profile = {
                    "institution_name": cfg.institution_name,
                    "keywords": cfg.team_themes,
                    "geographies": cfg.team_geographies,
                    "projects": "",
                    "excluded_keywords": [],
                    "auto_queue_threshold": settings.discovery.get("auto_queue_threshold", 40),
                }
                db.commit()
                celery_app.send_task(
                    "app.workers.surfacing_tasks.rescore_institution",
                    args=[institution_id],
                )
            run.status = PreseedRunStatus.SUCCESS
            run.opportunities_scored = count
            run.opportunities_total = count
            run.ended_at = datetime.now(timezone.utc)
            run.log_summary = f"Surfaced {count} grants"
            db.commit()
            return {"status": "ok", "surfaced": count}
        except Exception as exc:
            logger.error("preseed_institution_grants failed: %s", exc)
            run.status = PreseedRunStatus.FAILED
            run.errors = [str(exc)]
            run.ended_at = datetime.now(timezone.utc)
            db.commit()
            raise self.retry(exc=exc, countdown=30)


@celery_app.task(name="app.workers.surfacing_tasks.surface_opportunity_for_institutions")
def surface_opportunity_for_institutions(opportunity_id: str) -> dict:
    from app.config import get_settings
    from app.models.institution import Institution
    from app.models.opportunity import Opportunity
    from app.services.grant_bootstrap import surface_opportunity_for_institution

    settings = get_settings()
    engine = create_engine(settings.database_url)
    surfaced = 0
    with Session(engine) as db:
        opp = db.get(Opportunity, opportunity_id)
        if not opp:
            return {"surfaced": 0}
        institutions = db.execute(select(Institution)).scalars().all()
        for inst in institutions:
            if surface_opportunity_for_institution(db, inst.id, opp):
                surfaced += 1
        db.commit()
    return {"surfaced": surfaced}


@celery_app.task(name="app.workers.surfacing_tasks.rescore_institution", bind=True, max_retries=2)
def rescore_institution(self, institution_id: str) -> dict:
    from app.config import get_settings
    from app.models.institution import Institution
    from app.models.institution_opportunity import InstitutionOpportunity
    from app.models.opportunity import Opportunity
    from app.schemas.grant_profile import GrantProfile
    from app.services.keyword_scorer import keyword_score_opportunity

    settings = get_settings()
    engine = create_engine(settings.database_url)

    scored = 0
    with Session(engine) as db:
        inst = db.get(Institution, institution_id)
        if not inst:
            return {"scored": 0}
        profile = GrantProfile.from_dict(inst.grant_profile or {})
        threshold = profile.auto_queue_threshold
        rows = db.execute(
            select(InstitutionOpportunity, Opportunity)
            .join(Opportunity, Opportunity.id == InstitutionOpportunity.opportunity_id)
            .where(InstitutionOpportunity.institution_id == institution_id)
        ).all()
        for io, opp in rows:
            try:
                result = keyword_score_opportunity(
                    title=opp.title,
                    description=opp.description or opp.parsed_text or opp.notes or "",
                    funder=opp.funder or "",
                    eligibility=opp.eligibility_criteria or "",
                    geography=opp.geography or [],
                    award_min=opp.award_min,
                    award_max=opp.award_max,
                    deadline=opp.deadline,
                    thematic_areas=opp.thematic_areas or [],
                    profile_keywords=profile.keywords,
                    profile_geographies=profile.geographies,
                    excluded_keywords=profile.excluded_keywords,
                )
                io.fit_score = result["fit_score"]
                io.priority = result["priority"]
                io.fit_rationale = (
                    f"Keyword score — matched: {', '.join(result['matched_themes'][:5]) or 'none'}"
                )
                if result.get("matched_themes"):
                    io.matched_themes = result["matched_themes"]
                io.status = "needs_review" if io.fit_score >= threshold else "new"
                io.scored_at = datetime.now(timezone.utc)
                scored += 1
            except Exception as exc:
                logger.warning("Rescore failed for opp %s: %s", opp.id, exc)
        db.commit()
    return {"scored": scored}


@celery_app.task(name="app.workers.surfacing_tasks.rescore_opportunity_for_institutions")
def rescore_opportunity_for_institutions(opportunity_id: str) -> dict:
    """Re-score one opportunity for every institution that has it surfaced."""
    from app.config import get_settings
    from app.models.institution import Institution
    from app.models.institution_opportunity import InstitutionOpportunity
    from app.models.opportunity import Opportunity
    from app.schemas.grant_profile import GrantProfile
    from app.services.keyword_scorer import keyword_score_opportunity

    settings = get_settings()
    engine = create_engine(settings.database_url)

    scored = 0
    with Session(engine) as db:
        opp = db.get(Opportunity, opportunity_id)
        if not opp:
            return {"scored": 0}

        rows = db.execute(
            select(InstitutionOpportunity, Institution)
            .join(Institution, Institution.id == InstitutionOpportunity.institution_id)
            .where(InstitutionOpportunity.opportunity_id == opportunity_id)
        ).all()

        for io, inst in rows:
            profile = GrantProfile.from_dict(inst.grant_profile or {})
            threshold = profile.auto_queue_threshold
            try:
                result = keyword_score_opportunity(
                    title=opp.title,
                    description=opp.description or opp.parsed_text or opp.notes or "",
                    funder=opp.funder or "",
                    eligibility=opp.eligibility_criteria or "",
                    geography=opp.geography or [],
                    award_min=opp.award_min,
                    award_max=opp.award_max,
                    deadline=opp.deadline,
                    thematic_areas=opp.thematic_areas or [],
                    profile_keywords=profile.keywords,
                    profile_geographies=profile.geographies,
                    excluded_keywords=profile.excluded_keywords,
                )
                io.fit_score = result["fit_score"]
                io.priority = result["priority"]
                io.fit_rationale = (
                    f"Keyword score — matched: {', '.join(result['matched_themes'][:5]) or 'none'}"
                )
                if result.get("matched_themes"):
                    io.matched_themes = result["matched_themes"]
                if io.status not in ("archived", "potential_fit", "in_review"):
                    io.status = "needs_review" if io.fit_score >= threshold else "new"
                io.scored_at = datetime.now(timezone.utc)
                scored += 1
            except Exception as exc:
                logger.warning("Institution rescore failed for opp %s inst %s: %s", opp.id, inst.id, exc)
        db.commit()
    return {"scored": scored}


@celery_app.task(name="app.workers.surfacing_tasks.bootstrap_global_pool")
def bootstrap_global_pool() -> dict:
    from app.services.grant_bootstrap import run_full_bootstrap
    return run_full_bootstrap()


@celery_app.task(name="app.workers.surfacing_tasks.fan_out_sources_to_all")
def fan_out_sources_to_all() -> dict:
    from app.config import get_settings
    from app.services.grant_bootstrap import fan_out_sources_to_institutions

    settings = get_settings()
    engine = create_engine(settings.database_url)
    with Session(engine) as db:
        linked = fan_out_sources_to_institutions(db)
    return {"linked": linked}

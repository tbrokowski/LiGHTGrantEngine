"""Discovery-pipeline reconciler + health.

The scrape → dedup → enrich → tag/embed → score → surface chain is a set of
chained Celery tasks; a dropped worker or a failed step can leave an opportunity
stuck (parsed but never embedded, embedded but never scored, scored but never
surfaced). This watchdog finds those and re-queues the right next step, and
exposes corpus counters so `/sources/health` can show whether the pipeline is
actually working end to end.
"""
import logging

from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import Session

from app.db_sync import get_sync_engine
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)

_BATCH = 200  # bound per run so a big backlog is drained over several ticks


@celery_app.task(name="app.workers.pipeline_tasks.reconcile_pipeline")
def reconcile_pipeline() -> dict:
    """Re-queue opportunities stuck between pipeline stages. Bounded per run."""
    from app.models.opportunity import Opportunity
    from app.models.institution_opportunity import InstitutionOpportunity

    engine = get_sync_engine()
    requeued = {"embed": 0, "score": 0, "surface": 0}

    with Session(engine) as db:
        # 1. Parsed but not embedded → tag_and_embed.
        rows = db.execute(
            select(Opportunity.id).where(
                Opportunity.status != "duplicate",
                Opportunity.parsed_text.isnot(None),
                Opportunity.parsed_text != "[fetch_failed]",
                Opportunity.embedding.is_(None),
            ).limit(_BATCH)
        ).scalars().all()
        for oid in rows:
            celery_app.send_task("app.workers.tagging_tasks.tag_and_embed_opportunity", args=[oid])
            requeued["embed"] += 1

        # 2. Embedded but never scored → score_opportunity.
        rows = db.execute(
            select(Opportunity.id).where(
                Opportunity.status != "duplicate",
                Opportunity.embedding.isnot(None),
                or_(Opportunity.fit_score.is_(None), Opportunity.fit_score == 0),
            ).limit(_BATCH)
        ).scalars().all()
        for oid in rows:
            celery_app.send_task("app.workers.discovery_tasks.score_opportunity", args=[oid])
            requeued["score"] += 1

        # 3. Scored but not surfaced to any institution → surface.
        surfaced_subq = select(InstitutionOpportunity.opportunity_id).distinct().subquery()
        rows = db.execute(
            select(Opportunity.id).where(
                Opportunity.status != "duplicate",
                Opportunity.fit_score.isnot(None),
                Opportunity.id.notin_(select(surfaced_subq.c.opportunity_id)),
            ).limit(_BATCH)
        ).scalars().all()
        for oid in rows:
            celery_app.send_task("app.workers.surfacing_tasks.surface_opportunity_for_institutions", args=[oid])
            requeued["surface"] += 1

    total = sum(requeued.values())
    if total:
        logger.info("reconcile_pipeline re-queued %s", requeued)
    return {"requeued": requeued, "total": total}


def pipeline_health(db: Session) -> dict:
    """Corpus counters for the sources/health view (sync; call with a Session)."""
    from app.models.opportunity import Opportunity
    from app.models.institution_opportunity import InstitutionOpportunity

    def _count(*conds) -> int:
        return db.execute(
            select(func.count()).select_from(Opportunity).where(Opportunity.status != "duplicate", *conds)
        ).scalar() or 0

    surfaced_subq = select(InstitutionOpportunity.opportunity_id).distinct().subquery()
    return {
        "total_opportunities": _count(),
        "missing_embedding": _count(
            Opportunity.parsed_text.isnot(None),
            Opportunity.parsed_text != "[fetch_failed]",
            Opportunity.embedding.is_(None),
        ),
        "missing_score": _count(
            Opportunity.embedding.isnot(None),
            or_(Opportunity.fit_score.is_(None), Opportunity.fit_score == 0),
        ),
        "missing_surfacing": _count(
            Opportunity.fit_score.isnot(None),
            Opportunity.id.notin_(select(surfaced_subq.c.opportunity_id)),
        ),
    }

"""Celery tasks for per-institution grant surfacing and preseed."""
from __future__ import annotations
from app.db_sync import get_sync_engine

import asyncio
import logging
import uuid
from datetime import date, datetime, timezone

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
    engine = get_sync_engine()
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
    engine = get_sync_engine()
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


_LLM_TIERS = {"high_priority", "worth_reviewing", "watchlist", "low_fit"}

# Rows streamed per fetch during a full rescore. Bounds peak memory: at 1536-d
# float embeddings, pulling an entire institution's feed at once would be tens
# of MB per worker process, times concurrency.
_RESCORE_BATCH = 500

# Cap on text fed to keyword matching. `parsed_text` can be an entire scraped
# page; the signal is in the first few thousand characters.
_MAX_MATCH_TEXT = 20_000

# Statuses a rescore must not overwrite — a human has already acted on these.
_PRESERVED_STATUSES = ("archived", "potential_fit", "in_review")


def _extract_features(row, ctx, profile, today):
    """Score one streamed row into (features, keyword_result).

    Shared by the full-institution rescore and the single-opportunity path so
    both produce identical numbers. Returns (None, keyword_result) when an
    exclusion keyword fires — the caller short-circuits to EXCLUDED_SCORE.
    """
    from app.services.grant_ranker import compute_features
    from app.services.keyword_scorer import keyword_score_opportunity

    description = (row.description or row.parsed_text or row.notes or "")[:_MAX_MATCH_TEXT]
    kw = keyword_score_opportunity(
        title=row.title,
        description=description,
        funder=row.funder or "",
        eligibility=row.eligibility_criteria or "",
        geography=row.geography or [],
        award_min=row.award_min,
        award_max=row.award_max,
        deadline=row.deadline,
        thematic_areas=row.thematic_areas or [],
        profile_keywords=profile.keywords,
        profile_geographies=profile.geographies,
        excluded_keywords=profile.excluded_keywords,
    )
    if kw.get("excluded"):
        return None, kw

    feats = compute_features(
        row.embedding,
        ctx,
        keyword_coverage=kw["keyword_coverage"],
        funder=row.funder,
        deadline=row.deadline,
        award_min=row.award_min,
        award_max=row.award_max,
        today=today,
    )
    return feats, kw


def _finalize(feats, kw, ctx, funder):
    """Turn features into the persisted (score, tier, rationale, themes)."""
    from app.services.grant_ranker import EXCLUDED_SCORE, build_rationale, calibrated_score
    from app.services.keyword_scorer import tier_from_score

    if feats is None:  # excluded
        return EXCLUDED_SCORE, "low", kw.get("fit_rationale", "Excluded."), []

    score = calibrated_score(feats, ctx)
    return (
        round(score),
        tier_from_score(score),
        build_rationale(feats, kw.get("matched_themes") or [], funder),
        (kw.get("matched_themes") or [])[:15],
    )


def _scoring_columns():
    """Column list for the streaming rescore — never selects ORM entities, so
    1536-d embeddings are garbage-collected per batch instead of accumulating in
    the session identity map."""
    from app.models.institution_opportunity import InstitutionOpportunity
    from app.models.opportunity import Opportunity

    return [
        InstitutionOpportunity.opportunity_id.label("opportunity_id"),
        InstitutionOpportunity.priority.label("existing_priority"),
        InstitutionOpportunity.status.label("existing_status"),
        Opportunity.title, Opportunity.description, Opportunity.parsed_text,
        Opportunity.notes, Opportunity.funder, Opportunity.eligibility_criteria,
        Opportunity.geography, Opportunity.award_min, Opportunity.award_max,
        Opportunity.deadline, Opportunity.thematic_areas, Opportunity.embedding,
    ]


@celery_app.task(name="app.workers.surfacing_tasks.rescore_institution", bind=True, max_retries=2)
def rescore_institution(self, institution_id: str) -> dict:
    """Re-score every surfaced opportunity for one institution, and refresh the
    calibration quantiles from the resulting score distribution.

    Two passes over a streamed result set:
      1. Extract features for every row. Embeddings are touched once and
         discarded; only the small feature structs are retained.
      2. Build the raw-score distribution, persist its quantiles, then calibrate
         and bulk-write. Pass 2 needs no embeddings at all, so the whole job
         holds ~1MB of features rather than tens of MB of vectors.
    """
    from app.models.institution import Institution
    from app.models.institution_opportunity import InstitutionOpportunity
    from app.models.institution_taste_profile import InstitutionTasteProfile
    from app.models.opportunity import Opportunity
    from app.schemas.grant_profile import GrantProfile
    from app.services.grant_ranker import build_quantiles, context_from_profile

    engine = get_sync_engine()
    today = date.today()

    with Session(engine) as db:
        inst = db.get(Institution, institution_id)
        if not inst:
            return {"scored": 0}
        profile = GrantProfile.from_dict(inst.grant_profile or {})
        threshold = profile.auto_queue_threshold
        taste_profile = db.get(InstitutionTasteProfile, institution_id)
        ctx = context_from_profile(taste_profile)

        # ── Pass 1: features only ────────────────────────────────────────────
        stmt = (
            select(*_scoring_columns())
            .join(Opportunity, Opportunity.id == InstitutionOpportunity.opportunity_id)
            .where(InstitutionOpportunity.institution_id == institution_id)
            .execution_options(yield_per=_RESCORE_BATCH, stream_results=True)
        )
        pending: list[tuple] = []
        for row in db.execute(stmt):
            if row.existing_priority in _LLM_TIERS:
                continue  # preserve LLM score, do not overwrite with keyword score
            try:
                feats, kw = _extract_features(row, ctx, profile, today)
                pending.append((row.opportunity_id, feats, kw, row.funder, row.existing_status))
            except Exception as exc:
                logger.warning("Rescore failed for opp %s: %s", row.opportunity_id, exc)

        # ── Calibration ──────────────────────────────────────────────────────
        quantiles = build_quantiles(f.raw for _o, f, _k, _fn, _st in pending if f is not None)
        if quantiles and taste_profile is not None:
            meta = dict(taste_profile.ranking_meta or {})
            meta["quantiles"] = quantiles
            taste_profile.ranking_meta = meta
            db.commit()
        ctx.quantiles = quantiles

        # ── Pass 2: calibrate + bulk write ───────────────────────────────────
        now = datetime.now(timezone.utc)
        updates = []
        for opportunity_id, feats, kw, funder, existing_status in pending:
            score, tier, rationale, themes = _finalize(feats, kw, ctx, funder)
            update = {
                "institution_id": institution_id,
                "opportunity_id": opportunity_id,
                "fit_score": score,
                "priority": tier,
                "fit_rationale": rationale,
                "scored_at": now,
            }
            if themes:
                update["matched_themes"] = themes
            if existing_status not in _PRESERVED_STATUSES:
                update["status"] = "needs_review" if score >= threshold else "new"
            updates.append(update)

        for i in range(0, len(updates), _RESCORE_BATCH):
            db.bulk_update_mappings(InstitutionOpportunity, updates[i : i + _RESCORE_BATCH])
            db.commit()

    return {"scored": len(updates), "calibrated": bool(quantiles)}


@celery_app.task(name="app.workers.surfacing_tasks.rescore_opportunity_for_institutions")
def rescore_opportunity_for_institutions(opportunity_id: str) -> dict:
    """Re-score one opportunity for every institution that has it surfaced.

    The hot path: runs for every newly discovered grant. Calibration reuses the
    quantiles each institution's last full rescore persisted, so a single new
    opportunity lands on the same 0-100 scale as the rest of that org's feed
    without rescoring the whole feed to find out where it falls.
    """
    from app.models.institution import Institution
    from app.models.institution_opportunity import InstitutionOpportunity
    from app.models.institution_taste_profile import InstitutionTasteProfile
    from app.models.opportunity import Opportunity
    from app.schemas.grant_profile import GrantProfile
    from app.services.grant_ranker import context_from_profile

    engine = get_sync_engine()
    today = date.today()

    scored = 0
    with Session(engine) as db:
        rows = db.execute(
            select(*_scoring_columns(), Institution)
            .join(Opportunity, Opportunity.id == InstitutionOpportunity.opportunity_id)
            .join(Institution, Institution.id == InstitutionOpportunity.institution_id)
            .where(InstitutionOpportunity.opportunity_id == opportunity_id)
        ).all()

        # One context per institution, not per row — the unpack is the expensive
        # part and an opportunity can be surfaced to many orgs.
        ctx_cache: dict = {}
        now = datetime.now(timezone.utc)
        updates = []

        for row in rows:
            inst = row[-1]
            if row.existing_priority in _LLM_TIERS:
                continue  # preserve LLM score
            if inst.id not in ctx_cache:
                ctx_cache[inst.id] = context_from_profile(
                    db.get(InstitutionTasteProfile, inst.id)
                )
            ctx = ctx_cache[inst.id]
            profile = GrantProfile.from_dict(inst.grant_profile or {})
            try:
                feats, kw = _extract_features(row, ctx, profile, today)
                score, tier, rationale, themes = _finalize(feats, kw, ctx, row.funder)
            except Exception as exc:
                logger.warning(
                    "Institution rescore failed for opp %s inst %s: %s",
                    opportunity_id, inst.id, exc,
                )
                continue

            update = {
                "institution_id": inst.id,
                "opportunity_id": opportunity_id,
                "fit_score": score,
                "priority": tier,
                "fit_rationale": rationale,
                "scored_at": now,
            }
            if themes:
                update["matched_themes"] = themes
            if row.existing_status not in _PRESERVED_STATUSES:
                threshold = profile.auto_queue_threshold
                update["status"] = "needs_review" if score >= threshold else "new"
            updates.append(update)
            scored += 1

        if updates:
            db.bulk_update_mappings(InstitutionOpportunity, updates)
            db.commit()

    return {"scored": scored}


@celery_app.task(name="app.workers.surfacing_tasks.llm_rescore_institution", bind=True, max_retries=2)
def llm_rescore_institution(self, institution_id: str) -> dict:
    """Re-score all surfaced opportunities for an institution using the LLM fit scorer."""
    from app.config import get_settings
    from app.models.institution import Institution
    from app.models.institution_opportunity import InstitutionOpportunity
    from app.models.opportunity import Opportunity
    from app.schemas.grant_profile import GrantProfile
    from app.ai.agents.fit_scorer import score_opportunity

    settings = get_settings()
    engine = get_sync_engine()

    scored = 0
    failed = 0
    with Session(engine) as db:
        inst = db.get(Institution, institution_id)
        if not inst:
            return {"scored": 0, "failed": 0}
        profile = GrantProfile.from_dict(inst.grant_profile or {})
        threshold = profile.auto_queue_threshold
        rows = db.execute(
            select(InstitutionOpportunity, Opportunity)
            .join(Opportunity, Opportunity.id == InstitutionOpportunity.opportunity_id)
            .where(InstitutionOpportunity.institution_id == institution_id)
        ).all()
        for io, opp in rows:
            try:
                result = _run_async(score_opportunity(
                    title=opp.title or "",
                    description=opp.description or opp.parsed_text or opp.notes or "",
                    funder=opp.funder or "",
                    eligibility=opp.eligibility_criteria or "",
                    geography=", ".join(opp.geography or []),
                    award_amount=f"{opp.award_min or ''}–{opp.award_max or ''}" if (opp.award_min or opp.award_max) else "",
                    deadline=str(opp.deadline) if opp.deadline else "",
                    profile=profile,
                ))
                io.fit_score = result.get("fit_score", 0)
                io.priority = result.get("priority", "low_fit")
                io.fit_rationale = result.get("rationale", "")
                if result.get("matched_themes"):
                    io.matched_themes = result["matched_themes"]
                io.status = "needs_review" if io.fit_score >= threshold else "new"
                io.scored_at = datetime.now(timezone.utc)
                scored += 1
            except Exception as exc:
                logger.warning("LLM rescore failed for opp %s: %s", opp.id, exc)
                failed += 1
        db.commit()
    return {"scored": scored, "failed": failed}


@celery_app.task(name="app.workers.surfacing_tasks.surface_missing_institution_links_all")
def surface_missing_institution_links_all() -> dict:
    """Backfill InstitutionOpportunity rows for scraped opps missing institution links."""
    from app.config import get_settings
    from app.services.grant_bootstrap import surface_missing_for_all_institutions

    settings = get_settings()
    engine = get_sync_engine()
    with Session(engine) as db:
        surfaced = surface_missing_for_all_institutions(db)
    return {"surfaced": surfaced}


@celery_app.task(name="app.workers.surfacing_tasks.bootstrap_global_pool")
def bootstrap_global_pool() -> dict:
    from app.services.grant_bootstrap import run_full_bootstrap
    return run_full_bootstrap()


@celery_app.task(name="app.workers.surfacing_tasks.fan_out_sources_to_all")
def fan_out_sources_to_all() -> dict:
    from app.config import get_settings
    from app.services.grant_bootstrap import fan_out_sources_to_institutions

    settings = get_settings()
    engine = get_sync_engine()
    with Session(engine) as db:
        linked = fan_out_sources_to_institutions(db)
    return {"linked": linked}

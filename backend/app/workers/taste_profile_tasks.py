"""
Institution taste-profile tasks — compute per-institution positive/negative
centroid embeddings from InstitutionOpportunity outcome/status history.

This is a lightweight, always-on complement to the one-shot keyword/LLM
scorers: instead of training a model, it averages the embeddings of
opportunities an institution has actually pursued/won (positive) vs. rejected/
declined (negative), then lets Phase C nudge fit scores by cosine similarity
to those two centroids. No archive data is used here — GrantArchive has no
per-institution scoping in this codebase, so mixing it in would leak one
org's history into another's ranking.
"""
import logging
from app.db_sync import get_sync_engine
from datetime import datetime, timezone

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)

_POSITIVE_OUTCOMES = ("awarded",)
_POSITIVE_STATUSES = ("potential_fit", "actively_pursuing")
_NEGATIVE_OUTCOMES = ("declined", "not_pursued")
_NEGATIVE_STATUSES = ("rejected",)


def _centroid(embeddings: list[list[float]]) -> list[float] | None:
    """L2-normalize each embedding, average them, then L2-normalize the mean."""
    import numpy as np

    if not embeddings:
        return None
    arr = np.array(embeddings, dtype=np.float64)
    norms = np.linalg.norm(arr, axis=1, keepdims=True)
    norms[norms < 1e-10] = 1.0
    arr = arr / norms
    mean = arr.mean(axis=0)
    mean_norm = np.linalg.norm(mean)
    if mean_norm < 1e-10:
        return None
    return (mean / mean_norm).tolist()


def _embed_text(text: str) -> list[float] | None:
    """Embed a short profile description (sync wrapper over the async embedder)."""
    import asyncio

    if not text or not text.strip():
        return None
    from app.ai.client import get_embedding

    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(get_embedding(text[:6000]))
    except Exception:
        return None
    finally:
        loop.close()


@celery_app.task(name="app.workers.taste_profile_tasks.compute_taste_profile", bind=True, max_retries=2)
def compute_taste_profile(self, institution_id: str) -> dict:
    """Recompute one institution's positive/negative taste centroids."""
    from app.config import get_settings
    from app.models.institution_opportunity import InstitutionOpportunity
    from app.models.institution_taste_profile import InstitutionTasteProfile
    from app.models.opportunity import Opportunity

    settings = get_settings()
    engine = get_sync_engine()

    with Session(engine) as db:
        rows = db.execute(
            select(InstitutionOpportunity.outcome, InstitutionOpportunity.status, Opportunity.embedding)
            .join(Opportunity, Opportunity.id == InstitutionOpportunity.opportunity_id)
            .where(
                InstitutionOpportunity.institution_id == institution_id,
                Opportunity.embedding.isnot(None),
            )
        ).all()

        positive_embeddings = [
            emb for outcome, status, emb in rows
            if outcome in _POSITIVE_OUTCOMES or status in _POSITIVE_STATUSES
        ]
        negative_embeddings = [
            emb for outcome, status, emb in rows
            if outcome in _NEGATIVE_OUTCOMES or status in _NEGATIVE_STATUSES
        ]

        profile = db.get(InstitutionTasteProfile, institution_id)
        if not profile:
            profile = InstitutionTasteProfile(institution_id=institution_id)
            db.add(profile)

        profile.positive_embedding = _centroid(positive_embeddings)
        profile.negative_embedding = _centroid(negative_embeddings)
        profile.positive_count = len(positive_embeddings)
        profile.negative_count = len(negative_embeddings)

        # Semantic anchor from the org's *declared* profile (keywords/geographies/
        # mission) — the primary fit signal and the cold-start fallback.
        from app.models.institution import Institution
        from app.schemas.grant_profile import GrantProfile

        inst = db.get(Institution, institution_id)
        gp = GrantProfile.from_dict((inst.grant_profile if inst else None) or {})
        profile_text = " ".join(filter(None, [
            inst.name if inst else "",
            ", ".join(gp.keywords),
            ", ".join(gp.geographies),
            (inst.grant_profile.get("mission") or inst.grant_profile.get("description") or "") if inst and inst.grant_profile else "",
        ])).strip()
        profile.profile_embedding = _embed_text(profile_text)

        profile.computed_at = datetime.now(timezone.utc)
        db.commit()

    return {
        "institution_id": institution_id,
        "positive_count": len(positive_embeddings),
        "negative_count": len(negative_embeddings),
    }


@celery_app.task(name="app.workers.taste_profile_tasks.compute_all_taste_profiles")
def compute_all_taste_profiles() -> dict:
    """Recompute taste profiles for every institution with surfaced opportunities."""
    from app.config import get_settings
    from app.models.institution_opportunity import InstitutionOpportunity

    settings = get_settings()
    engine = get_sync_engine()

    with Session(engine) as db:
        institution_ids = [
            row[0] for row in db.execute(
                select(InstitutionOpportunity.institution_id).distinct()
            ).all()
        ]

    for institution_id in institution_ids:
        try:
            compute_taste_profile.delay(institution_id)
        except Exception as exc:
            logger.warning("Failed to queue taste profile for %s: %s", institution_id, exc)

    return {"institutions_queued": len(institution_ids)}


@celery_app.task(name="app.workers.taste_profile_tasks.compute_user_taste_profile", bind=True, max_retries=2)
def compute_user_taste_profile(self, user_id: str) -> dict:
    """Recompute one user's personal taste: a behavioral centroid (opps they
    saved/pinned) plus an embedding of their explicit preference keywords."""
    from app.models.user import User
    from app.models.user_opportunity_state import UserOpportunityState
    from app.models.user_taste_profile import UserTasteProfile
    from app.models.opportunity import Opportunity
    from app.schemas.grant_profile import UserGrantPreferences

    engine = get_sync_engine()
    with Session(engine) as db:
        rows = db.execute(
            select(Opportunity.embedding)
            .join(UserOpportunityState, UserOpportunityState.opportunity_id == Opportunity.id)
            .where(
                UserOpportunityState.user_id == user_id,
                Opportunity.embedding.isnot(None),
                (UserOpportunityState.saved_at.isnot(None)) | (UserOpportunityState.pinned.is_(True)),
            )
        ).all()
        positive = [emb for (emb,) in rows if emb is not None]

        user = db.get(User, user_id)
        prefs = UserGrantPreferences.from_dict((user.grant_preferences if user else None) or {})
        pref_text = ", ".join(prefs.keywords)

        profile = db.get(UserTasteProfile, user_id)
        if not profile:
            profile = UserTasteProfile(user_id=user_id)
            db.add(profile)
        profile.positive_embedding = _centroid(positive)
        profile.profile_embedding = _embed_text(pref_text)
        profile.positive_count = len(positive)
        profile.computed_at = datetime.now(timezone.utc)
        db.commit()

    return {"user_id": user_id, "positive_count": len(positive)}


@celery_app.task(name="app.workers.taste_profile_tasks.compute_all_user_taste_profiles")
def compute_all_user_taste_profiles() -> dict:
    """Recompute personal taste for every user who has engagement or explicit prefs."""
    from app.models.user import User
    from app.models.user_opportunity_state import UserOpportunityState

    engine = get_sync_engine()
    with Session(engine) as db:
        active = {
            row[0] for row in db.execute(
                select(UserOpportunityState.user_id)
                .where((UserOpportunityState.saved_at.isnot(None)) | (UserOpportunityState.pinned.is_(True)))
                .distinct()
            ).all()
        }
        # Also users with explicit keyword prefs set.
        for (uid, prefs) in db.execute(select(User.id, User.grant_preferences)).all():
            if prefs and (prefs.get("keywords")):
                active.add(uid)

    for uid in active:
        try:
            compute_user_taste_profile.delay(uid)
        except Exception as exc:
            logger.warning("Failed to queue user taste profile for %s: %s", uid, exc)
    return {"users_queued": len(active)}

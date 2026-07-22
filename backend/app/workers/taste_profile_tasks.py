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

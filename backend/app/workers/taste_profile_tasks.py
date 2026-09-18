"""
Institution taste-profile tasks — build the ranking artifacts the calibrated
scorer consumes (see services/grant_ranker.py).

Produces, per institution:
  * **Multi-prototype taste.** A small set of prototype vectors derived from the
    institution's archive and its pursued opportunities. Similarity is taken as
    a `max` over these rather than a cosine to one averaged centroid — averaging
    a multi-interest lab's history yields a midpoint describing none of its
    interests, which then scores bland generic grants highest.
  * **Funder affinity.** Prior submission/award record per funder, a strong and
    previously unused prior.
  * **Award median.** What this institution actually wins, for award-size fit.

The archive *is* used here now. It was previously excluded on the grounds that
`GrantArchive` has no `institution_id`, but it is reachable per-institution
through `ActiveGrant.institution_id` and through `InstitutionOpportunity` — see
`_institution_archive_rows`. That scoping keeps one org's history out of
another's ranking while using the single best signal available: real proposals
the team wrote, with known outcomes.

Legacy single centroids (`positive_embedding` / `negative_embedding`) are still
maintained for `taste_profile_scorer.taste_adjustment` and the personalized feed.
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


# ── Archive + prototype construction ─────────────────────────────────────────

_WON_OUTCOMES = ("awarded", "partially_funded")


def _institution_archive_rows(db, institution_id: str) -> list[tuple]:
    """Archive entries belonging to this institution, with embeddings.

    `GrantArchive` carries no institution_id, so scope through the two links it
    does have: the active grant it came from, or an opportunity surfaced to this
    institution. Returns (title, embedding, outcome, funder, awarded_amount).
    """
    from app.models.archive import GrantArchive
    from app.models.active_grant import ActiveGrant
    from app.models.institution_opportunity import InstitutionOpportunity

    rows = db.execute(
        select(
            GrantArchive.title,
            GrantArchive.embedding,
            GrantArchive.outcome,
            GrantArchive.funder,
            GrantArchive.awarded_amount,
        )
        .outerjoin(ActiveGrant, ActiveGrant.id == GrantArchive.grant_id)
        .outerjoin(
            InstitutionOpportunity,
            (InstitutionOpportunity.opportunity_id == GrantArchive.opportunity_id)
            & (InstitutionOpportunity.institution_id == institution_id),
        )
        .where(
            GrantArchive.embedding.isnot(None),
            (ActiveGrant.institution_id == institution_id)
            | (InstitutionOpportunity.institution_id.isnot(None)),
        )
    ).all()
    # One archive row can match through both joins; de-duplicate on title+funder.
    seen: set = set()
    out: list[tuple] = []
    for title, emb, outcome, funder, amount in rows:
        key = (title, funder)
        if key in seen:
            continue
        seen.add(key)
        out.append((title, emb, outcome, funder, amount))
    return out


def _build_prototypes(
    vectors: list, labels: list, won_flags: list, max_k: int
) -> tuple[list, list, list]:
    """Reduce a set of example embeddings to at most `max_k` prototypes.

    With few examples each one is its own prototype. Above the cap, k-means over
    L2-normalized vectors groups them into coherent interest areas; each cluster
    contributes its normalized mean, labelled by the member nearest the centroid
    so the rationale can cite a real prior grant.
    """
    import numpy as np

    if not vectors:
        return [], [], []

    arr = np.array(vectors, dtype=np.float64)
    norms = np.linalg.norm(arr, axis=1, keepdims=True)
    norms[norms < 1e-10] = 1.0
    arr = arr / norms

    if len(vectors) <= max_k:
        return arr.tolist(), list(labels), list(won_flags)

    try:
        from sklearn.cluster import KMeans

        assignments = KMeans(n_clusters=max_k, n_init=4, random_state=0).fit(arr).labels_
    except Exception as exc:  # sklearn unavailable or degenerate input
        logger.warning("Prototype clustering failed (%s) — using first %d examples", exc, max_k)
        return arr[:max_k].tolist(), list(labels[:max_k]), list(won_flags[:max_k])

    protos, proto_labels, proto_won = [], [], []
    for k in range(max_k):
        members = np.where(assignments == k)[0]
        if members.size == 0:
            continue
        mean = arr[members].mean(axis=0)
        mean_norm = np.linalg.norm(mean)
        if mean_norm < 1e-10:
            continue
        mean = mean / mean_norm
        nearest = members[int(np.argmax(arr[members] @ mean))]
        protos.append(mean.tolist())
        proto_labels.append(labels[nearest])
        # A prototype counts as "won" when any member of its cluster was awarded —
        # the rationale claims resemblance to funded work, not that all of it was.
        proto_won.append(any(won_flags[i] for i in members))
    return protos, proto_labels, proto_won


def _funder_affinity(archive_rows: list) -> dict:
    """Map normalized funder name -> 0..1 affinity.

    A submission to a funder is mild evidence of fit; an award is strong
    evidence. Saturates so one prolific relationship can't dominate the score.
    """
    from app.services.grant_ranker import normalize_funder

    tally: dict = {}
    for _title, _emb, outcome, funder, _amount in archive_rows:
        key = normalize_funder(funder)
        if not key:
            continue
        submitted, won = tally.get(key, (0, 0))
        tally[key] = (submitted + 1, won + (1 if outcome in _WON_OUTCOMES else 0))

    return {
        key: round(min(1.0, min(1.0, 0.25 * sub) * 0.4 + min(1.0, 0.5 * won) * 0.6), 4)
        for key, (sub, won) in tally.items()
    }


def _award_median(archive_rows: list) -> float | None:
    """Median awarded amount — what this institution actually wins."""
    import numpy as np

    amounts = [
        float(amount)
        for _t, _e, outcome, _f, amount in archive_rows
        if amount and float(amount) > 0 and outcome in _WON_OUTCOMES
    ]
    return float(np.median(amounts)) if amounts else None


@celery_app.task(name="app.workers.taste_profile_tasks.compute_taste_profile", bind=True, max_retries=2)
def compute_taste_profile(self, institution_id: str) -> dict:
    """Recompute one institution's taste centroids, prototypes and ranking meta."""
    from app.models.institution import Institution
    from app.models.institution_opportunity import InstitutionOpportunity
    from app.models.institution_taste_profile import InstitutionTasteProfile
    from app.models.opportunity import Opportunity
    from app.schemas.grant_profile import GrantProfile
    from app.services.grant_ranker import (
        MAX_NEGATIVE_PROTOTYPES,
        MAX_POSITIVE_PROTOTYPES,
        pack_vectors,
    )

    engine = get_sync_engine()

    with Session(engine) as db:
        rows = db.execute(
            select(
                InstitutionOpportunity.outcome,
                InstitutionOpportunity.status,
                Opportunity.embedding,
                Opportunity.title,
            )
            .join(Opportunity, Opportunity.id == InstitutionOpportunity.opportunity_id)
            .where(
                InstitutionOpportunity.institution_id == institution_id,
                Opportunity.embedding.isnot(None),
            )
        ).all()

        positive_embeddings = [
            emb for outcome, status, emb, _t in rows
            if outcome in _POSITIVE_OUTCOMES or status in _POSITIVE_STATUSES
        ]
        positive_labels = [
            title for outcome, status, _e, title in rows
            if outcome in _POSITIVE_OUTCOMES or status in _POSITIVE_STATUSES
        ]
        positive_won = [
            outcome in _POSITIVE_OUTCOMES for outcome, status, _e, _t in rows
            if outcome in _POSITIVE_OUTCOMES or status in _POSITIVE_STATUSES
        ]
        negative_embeddings = [
            emb for outcome, status, emb, _t in rows
            if outcome in _NEGATIVE_OUTCOMES or status in _NEGATIVE_STATUSES
        ]

        # ── Archive signal — the strongest evidence available ────────────────
        # Real proposals this team wrote, with known outcomes. Weighted ahead of
        # pursued-opportunity signal by being listed first: when there are more
        # examples than prototype slots, k-means still sees all of them, but with
        # few examples the archive entries are the ones kept verbatim.
        archive_rows = _institution_archive_rows(db, institution_id)
        proto_vectors = [emb for _t, emb, _o, _f, _a in archive_rows] + positive_embeddings
        proto_labels = [title for title, _e, _o, _f, _a in archive_rows] + positive_labels
        proto_won = [
            outcome in _WON_OUTCOMES for _t, _e, outcome, _f, _a in archive_rows
        ] + positive_won

        pos_protos, pos_labels, pos_won = _build_prototypes(
            proto_vectors, proto_labels, proto_won, MAX_POSITIVE_PROTOTYPES
        )
        neg_protos, _nl, _nw = _build_prototypes(
            negative_embeddings,
            ["" for _ in negative_embeddings],
            [False for _ in negative_embeddings],
            MAX_NEGATIVE_PROTOTYPES,
        )

        profile = db.get(InstitutionTasteProfile, institution_id)
        if not profile:
            profile = InstitutionTasteProfile(institution_id=institution_id)
            db.add(profile)

        # Legacy single centroids — still consumed by taste_profile_scorer and
        # the personalized feed path.
        profile.positive_embedding = _centroid(positive_embeddings)
        profile.negative_embedding = _centroid(negative_embeddings)
        profile.positive_count = len(positive_embeddings)
        profile.negative_count = len(negative_embeddings)

        profile.prototypes = {
            "positive": pack_vectors(pos_protos),
            "negative": pack_vectors(neg_protos),
            "labels": pos_labels,
            "won": pos_won,
            "dim": 1536,
        }

        # Preserve quantiles — they are written by the scoring pass, not here.
        existing_meta = profile.ranking_meta or {}
        profile.ranking_meta = {
            "funder_affinity": _funder_affinity(archive_rows),
            "award_median": _award_median(archive_rows),
            "quantiles": existing_meta.get("quantiles") or [],
            "archive_count": len(archive_rows),
        }

        # Semantic anchor from the org's *declared* profile (keywords/geographies/
        # mission) — the cold-start fallback when there is no archive yet.
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

    # Prototypes just changed, so every stored fit_score for this institution is
    # stale. Rescoring also refreshes the calibration quantiles.
    try:
        celery_app.send_task(
            "app.workers.surfacing_tasks.rescore_institution", args=[institution_id]
        )
    except Exception as exc:
        logger.warning("Failed to queue rescore for %s: %s", institution_id, exc)

    return {
        "institution_id": institution_id,
        "positive_count": len(positive_embeddings),
        "negative_count": len(negative_embeddings),
        "archive_count": len(archive_rows),
        "prototypes": len(pos_protos),
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
    from app.models.active_grant import ActiveGrant
    from app.schemas.grant_profile import UserGrantPreferences

    engine = get_sync_engine()
    with Session(engine) as db:
        # Positives: opportunities the user explicitly saved/pinned…
        saved_rows = db.execute(
            select(Opportunity.embedding)
            .join(UserOpportunityState, UserOpportunityState.opportunity_id == Opportunity.id)
            .where(
                UserOpportunityState.user_id == user_id,
                Opportunity.embedding.isnot(None),
                (UserOpportunityState.saved_at.isnot(None)) | (UserOpportunityState.pinned.is_(True)),
            )
        ).all()
        # …plus opportunities the user actually started as grants (strong intent).
        grant_rows = db.execute(
            select(Opportunity.embedding)
            .join(ActiveGrant, ActiveGrant.opportunity_id == Opportunity.id)
            .where(
                ActiveGrant.created_by_id == user_id,
                Opportunity.embedding.isnot(None),
            )
        ).all()
        positive = [emb for (emb,) in [*saved_rows, *grant_rows] if emb is not None]

        # Negatives: opportunities the user dismissed ("Not interested").
        neg_rows = db.execute(
            select(Opportunity.embedding)
            .join(UserOpportunityState, UserOpportunityState.opportunity_id == Opportunity.id)
            .where(
                UserOpportunityState.user_id == user_id,
                Opportunity.embedding.isnot(None),
                UserOpportunityState.dismissed_at.isnot(None),
            )
        ).all()
        negative = [emb for (emb,) in neg_rows if emb is not None]

        user = db.get(User, user_id)
        prefs = UserGrantPreferences.from_dict((user.grant_preferences if user else None) or {})
        pref_text = ", ".join(prefs.keywords)

        profile = db.get(UserTasteProfile, user_id)
        if not profile:
            profile = UserTasteProfile(user_id=user_id)
            db.add(profile)
        profile.positive_embedding = _centroid(positive)
        profile.negative_embedding = _centroid(negative)
        profile.profile_embedding = _embed_text(pref_text)
        profile.positive_count = len(positive)
        profile.negative_count = len(negative)
        profile.computed_at = datetime.now(timezone.utc)
        db.commit()

    return {"user_id": user_id, "positive_count": len(positive), "negative_count": len(negative)}


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
                .where(
                    (UserOpportunityState.saved_at.isnot(None))
                    | (UserOpportunityState.pinned.is_(True))
                    | (UserOpportunityState.dismissed_at.isnot(None))
                )
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

"""Relevance ranking helpers for the opportunities feed.

Two concerns:
  * semantic_fit() — a continuous, well-differentiated org fit score blending
    embedding similarity, keyword coverage, and taste centroids (used by the
    surfacing/scoring tasks to replace the coarse keyword-only buckets).
  * diversify_order() — a greedy MMR-style reorder that interleaves sources/
    funders so a single source can't dominate the top of the feed.

Both are pure/sync and dependency-light so they're safe to call from Celery
workers and the request path alike.
"""
from __future__ import annotations

from typing import Callable, Hashable, Sequence

from app.services.taste_profile_scorer import cosine_similarity


# ── Continuous org fit score ─────────────────────────────────────────────────

def semantic_fit(
    opp_embedding: list[float] | None,
    profile_embedding: list[float] | None,
    positive_embedding: list[float] | None,
    negative_embedding: list[float] | None,
    keyword_ratio: float,
    *,
    has_taste_signal: bool = False,
    funder_priority: bool = False,
) -> float:
    """Blend signals into a continuous 0–100 fit score.

    keyword_ratio: share of the org's profile keywords matched (0..1) — the
      coverage signal the old keyword scorer already computes.
    profile_embedding: embedding of the org's declared profile (keywords/mission);
      positive/negative: taste centroids of what the org pursued/rejected.

    Weighting favours semantic similarity (fine-grained) but keeps keyword
    coverage and taste so the score stays explainable and degrades gracefully:
    with no embedding at all it falls back to keyword coverage alone.
    """
    kw = max(0.0, min(1.0, keyword_ratio))

    if opp_embedding is None:
        # No vector — pure keyword coverage, same scale as before.
        return round(25 + kw * 72)

    sem = 0.0
    sem_weight = 0.0
    if profile_embedding is not None:
        sem = max(0.0, cosine_similarity(opp_embedding, profile_embedding))
        sem_weight = 0.55
    taste = 0.0
    if has_taste_signal and (positive_embedding is not None or negative_embedding is not None):
        pos = cosine_similarity(opp_embedding, positive_embedding)
        neg = cosine_similarity(opp_embedding, negative_embedding)
        taste = pos - neg  # -1..1
    # Re-normalise weights over whatever signals are present.
    kw_weight = 0.30
    taste_weight = 0.15 if (has_taste_signal and taste != 0.0) else 0.0
    total_w = sem_weight + kw_weight + taste_weight or 1.0
    blended = (sem_weight * sem + kw_weight * kw + taste_weight * ((taste + 1) / 2)) / total_w

    score = blended * 100
    if funder_priority:
        score += 6
    return round(max(0.0, min(100.0, score)))


# ── Source/funder diversification (MMR) ──────────────────────────────────────

def diversify_order(
    items: Sequence,
    key_fn: Callable[[object], Hashable],
    *,
    penalty: float = 0.16,
) -> list[int]:
    """Return a permutation of indices into `items` that interleaves by key.

    `items` must already be sorted best-first (highest relevance first). Each
    item's base score comes from its rank; a per-repeat penalty is subtracted for
    every earlier item that shared its key, so consecutive picks tend to come
    from different sources/funders while still respecting relevance. Deterministic
    (ties resolved by original order). O(n^2) — fine for the ~few-hundred pool we
    feed it.
    """
    n = len(items)
    if n <= 2:
        return list(range(n))

    keys = [key_fn(it) for it in items]
    remaining = set(range(n))
    seen: dict[Hashable, int] = {}
    order: list[int] = []

    while remaining:
        best_idx = -1
        best_score = None
        for idx in sorted(remaining):  # ascending idx → prefers higher relevance on ties
            base = (n - idx) / n
            adj = base - penalty * seen.get(keys[idx], 0)
            if best_score is None or adj > best_score:
                best_score = adj
                best_idx = idx
        order.append(best_idx)
        remaining.discard(best_idx)
        seen[keys[best_idx]] = seen.get(keys[best_idx], 0) + 1

    return order

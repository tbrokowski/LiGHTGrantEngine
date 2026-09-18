"""Relevance ranking helpers for the opportunities feed.

Two concerns:
  * personal_relevance() — blends the institution fit score with the signed-in
    user's own taste so the feed is personalized on top of the org ranking.
  * diversify_order() — a greedy MMR-style reorder that interleaves sources/
    funders so a single source can't dominate the top of the feed.

The org-level fit score itself now comes from `services.grant_ranker`, which
calibrates against the institution's own score distribution. The old
`semantic_fit()` blend that lived here fed raw cosine similarity straight into a
weighted average; because embedding cosines realistically top out near 0.6, that
compressed every opportunity into the 20s-50s and left the 75/45 tier thresholds
unreachable.

Both are pure/sync and dependency-light so they're safe to call from Celery
workers and the request path alike.
"""
from __future__ import annotations

from typing import Callable, Hashable, Sequence


# ── Personalized feed relevance ──────────────────────────────────────────────

def personal_relevance(
    org_fit: float,
    pos_sim: float,
    neg_sim: float = 0.0,
    *,
    fit_weight: float = 0.5,
    sim_weight: float = 0.5,
    neg_weight: float = 0.35,
    has_user_signal: bool = True,
) -> float:
    """Blend org fit with the user's personal taste into a single 0–100 score.

    org_fit  — the institution-level fit_score (0–100).
    pos_sim  — cosine similarity (0..1) of the opportunity to the user's positive
               taste centroid (what they saved / started as grants).
    neg_sim  — cosine similarity (0..1) to the user's dismissed ("not interested")
               centroid; subtracted so items like ones they rejected sink.

    This is the number the feed both sorts by AND shows on the badge, so the
    displayed order is always monotonic in the displayed score. With no user
    signal it returns org_fit unchanged (cold-start / graceful fallback).
    """
    if not has_user_signal:
        return round(max(0.0, min(100.0, org_fit)))
    pos = max(0.0, min(1.0, pos_sim))
    neg = max(0.0, min(1.0, neg_sim))
    blended = fit_weight * (org_fit / 100.0) + sim_weight * pos - neg_weight * neg
    return round(max(0.0, min(100.0, blended * 100.0)))


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


def diversify_within_bands(
    items: Sequence,
    key_fn: Callable[[object], Hashable],
    score_fn: Callable[[object], float],
    *,
    band: float = 5.0,
    penalty: float = 0.16,
) -> list[int]:
    """Diversify by source/funder, but only *within* score bands.

    `items` must already be sorted best-first by score. Items are grouped into
    contiguous bands of width `band` (e.g. 5 points), and `diversify_order` is
    applied inside each band only. This keeps variety among near-equal items
    while guaranteeing a high-score item can never be demoted below a materially
    lower-score one — fixing the "55 above 85" inversion the global MMR caused.
    Returns a permutation of indices into `items`.
    """
    n = len(items)
    if n <= 2:
        return list(range(n))

    order: list[int] = []
    i = 0
    while i < n:
        band_hi = score_fn(items[i])
        j = i
        while j < n and (band_hi - score_fn(items[j])) < band:
            j += 1
        # items[i:j] share a band; diversify sources within it, preserving offsets.
        local = diversify_order(items[i:j], key_fn, penalty=penalty)
        order.extend(i + idx for idx in local)
        i = j
    return order

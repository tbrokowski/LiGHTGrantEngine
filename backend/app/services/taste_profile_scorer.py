"""
Taste-profile score adjustment — nudges a keyword-scored fit_score toward what
an institution has actually pursued/won and away from what it has rejected/
declined, using cosine similarity to the institution's positive/negative
centroid embeddings (see app.workers.taste_profile_tasks).

Deliberately not a trained model: centroid similarity is cheap, explainable,
and degrades gracefully to a no-op when an institution has little history yet.
"""
from __future__ import annotations

# Below this many examples on both sides, the centroid is too noisy to trust —
# return a zero adjustment so cold-start institutions see unchanged scores.
_MIN_SIGNAL_COUNT = 3
_MAX_ADJUSTMENT = 15.0


def cosine_similarity(a: list[float] | None, b: list[float] | None) -> float:
    """Cosine similarity of two vectors. Returns 0.0 if either is missing/zero."""
    if not a or not b:
        return 0.0
    import numpy as np

    va = np.array(a, dtype=np.float64)
    vb = np.array(b, dtype=np.float64)
    na = np.linalg.norm(va)
    nb = np.linalg.norm(vb)
    if na < 1e-10 or nb < 1e-10:
        return 0.0
    return float(np.dot(va, vb) / (na * nb))


def taste_adjustment(
    opp_embedding: list[float] | None,
    positive_embedding: list[float] | None,
    negative_embedding: list[float] | None,
    positive_count: int,
    negative_count: int,
) -> float:
    """
    Returns a -15..+15 point adjustment based on how similar an opportunity's
    embedding is to the institution's positive vs. negative taste centroids.
    Returns 0.0 when there's insufficient signal (cold start) or no opportunity
    embedding, so it never distorts scores for new orgs or unembedded opps.
    """
    if opp_embedding is None:
        return 0.0
    if positive_count < _MIN_SIGNAL_COUNT and negative_count < _MIN_SIGNAL_COUNT:
        return 0.0

    pos_sim = cosine_similarity(opp_embedding, positive_embedding)
    neg_sim = cosine_similarity(opp_embedding, negative_embedding)
    delta = (pos_sim - neg_sim) * _MAX_ADJUSTMENT
    return max(-_MAX_ADJUSTMENT, min(_MAX_ADJUSTMENT, delta))

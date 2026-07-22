"""Unit tests for the taste-profile centroid-similarity score adjustment."""
from app.services.taste_profile_scorer import cosine_similarity, taste_adjustment


def test_cosine_similarity_identical_vectors():
    assert cosine_similarity([1.0, 0.0], [1.0, 0.0]) == 1.0


def test_cosine_similarity_orthogonal_vectors():
    assert cosine_similarity([1.0, 0.0], [0.0, 1.0]) == 0.0


def test_cosine_similarity_opposite_vectors():
    assert cosine_similarity([1.0, 0.0], [-1.0, 0.0]) == -1.0


def test_cosine_similarity_handles_missing_vectors():
    assert cosine_similarity(None, [1.0, 0.0]) == 0.0
    assert cosine_similarity([1.0, 0.0], None) == 0.0
    assert cosine_similarity([0.0, 0.0], [1.0, 0.0]) == 0.0


def test_taste_adjustment_cold_start_returns_zero():
    # Fewer than 3 examples on both sides — insufficient signal, must not adjust.
    adj = taste_adjustment(
        opp_embedding=[1.0, 0.0],
        positive_embedding=[1.0, 0.0],
        negative_embedding=[-1.0, 0.0],
        positive_count=1,
        negative_count=0,
    )
    assert adj == 0.0


def test_taste_adjustment_missing_opportunity_embedding_returns_zero():
    adj = taste_adjustment(
        opp_embedding=None,
        positive_embedding=[1.0, 0.0],
        negative_embedding=[-1.0, 0.0],
        positive_count=5,
        negative_count=5,
    )
    assert adj == 0.0


def test_taste_adjustment_positive_when_similar_to_liked():
    adj = taste_adjustment(
        opp_embedding=[1.0, 0.0],
        positive_embedding=[1.0, 0.0],
        negative_embedding=[-1.0, 0.0],
        positive_count=3,
        negative_count=3,
    )
    assert adj > 0
    assert adj == 15.0  # max positive similarity (1.0) minus max negative (-1.0) -> clamps at +15


def test_taste_adjustment_negative_when_similar_to_rejected():
    adj = taste_adjustment(
        opp_embedding=[-1.0, 0.0],
        positive_embedding=[1.0, 0.0],
        negative_embedding=[-1.0, 0.0],
        positive_count=3,
        negative_count=3,
    )
    assert adj < 0
    assert adj == -15.0


def test_taste_adjustment_clamped_to_max():
    # Even with an extreme delta, the adjustment never exceeds +/-15.
    adj = taste_adjustment(
        opp_embedding=[1.0, 0.0, 0.0],
        positive_embedding=[1.0, 0.0, 0.0],
        negative_embedding=[0.0, 1.0, 0.0],
        positive_count=10,
        negative_count=10,
    )
    assert -15.0 <= adj <= 15.0

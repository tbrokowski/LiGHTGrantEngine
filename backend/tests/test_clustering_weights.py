"""Unit tests for the hybrid keyword+semantic clustering edge-weight blend."""
from app.workers.clustering_tasks import jaccard, blend_edge_weight, ALPHA


def test_jaccard_empty_sets_returns_zero():
    assert jaccard(set(), {"ai", "health"}) == 0.0
    assert jaccard({"ai"}, set()) == 0.0
    assert jaccard(set(), set()) == 0.0


def test_jaccard_identical_sets_returns_one():
    assert jaccard({"ai", "health"}, {"ai", "health"}) == 1.0


def test_jaccard_partial_overlap():
    assert jaccard({"ai", "health"}, {"health", "climate"}) == 1 / 3


def test_jaccard_no_overlap_returns_zero():
    assert jaccard({"ai"}, {"climate"}) == 0.0


def test_blend_edge_weight_pure_semantic_when_no_tag_overlap():
    w = blend_edge_weight(semantic_weight=0.9, tag_jaccard=0.0)
    assert w == ALPHA * 0.9


def test_blend_edge_weight_boosted_by_tag_overlap():
    low_semantic_no_tags = blend_edge_weight(semantic_weight=0.4, tag_jaccard=0.0)
    low_semantic_high_tags = blend_edge_weight(semantic_weight=0.4, tag_jaccard=1.0)
    assert low_semantic_high_tags > low_semantic_no_tags


def test_blend_edge_weight_default_alpha_favors_semantic():
    # Full tag overlap alone should not exceed a high semantic-only match,
    # since ALPHA keeps semantic similarity dominant.
    semantic_only = blend_edge_weight(semantic_weight=1.0, tag_jaccard=0.0)
    tags_only = blend_edge_weight(semantic_weight=0.0, tag_jaccard=1.0)
    assert semantic_only > tags_only

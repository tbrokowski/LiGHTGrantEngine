"""Unit tests for the calibrated grant ranker.

These target the specific defects that made the previous ranking unusable:
score compression into an unreachable-tier band, a single averaged centroid
misrepresenting multi-interest institutions, substring keyword matching, and
coverage that divided by profile size.
"""
import math
from datetime import date, timedelta

import numpy as np
import pytest

from app.services.grant_ranker import (
    InstitutionRankingContext,
    RankFeatures,
    award_fit,
    build_quantiles,
    build_rationale,
    calibrated_score,
    compute_features,
    deadline_feasibility,
    l2_normalize,
    normalize_funder,
    pack_vectors,
    percentile_of,
    raw_score,
    unpack_vectors,
)
from app.services.keyword_scorer import keyword_score_opportunity


def _unit(*components) -> list[float]:
    v = np.array(components, dtype=np.float64)
    return (v / np.linalg.norm(v)).tolist()


# ── Vector packing ───────────────────────────────────────────────────────────

def test_pack_unpack_roundtrip():
    vectors = [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]
    restored = unpack_vectors(pack_vectors(vectors), dim=3)
    assert restored.shape == (2, 3)
    assert np.allclose(restored, np.array(vectors, dtype=np.float32), atol=1e-6)


def test_unpack_handles_missing_and_malformed():
    assert unpack_vectors(None, dim=4).shape == (0, 4)
    assert unpack_vectors("not-base64!!", dim=4).shape == (0, 4)


# ── The compression fix ──────────────────────────────────────────────────────

def test_calibration_spreads_realistic_cosines_across_the_full_range():
    """The core regression. Real profile-to-grant cosines cluster in ~0.25-0.55.
    The old blend mapped that band into the 20s-50s, leaving the 75 "high"
    threshold unreachable. Calibration must restore usable spread."""
    rng = np.random.default_rng(0)
    sims = np.clip(rng.normal(0.40, 0.07, 400), 0.05, 0.95)

    pool = []
    for sim in sims:
        feats = RankFeatures(proto_sim=float(sim), keyword_coverage=0.3,
                             deadline_feasibility=1.0, award_fit=0.6)
        pool.append(feats)

    quantiles = build_quantiles(raw_score(f) for f in pool)
    ctx = InstitutionRankingContext(quantiles=quantiles)
    scores = sorted(calibrated_score(f, ctx) for f in pool)

    # The best matches must actually reach the "high" tier...
    assert scores[-1] >= 75, f"top score only {scores[-1]:.1f} — tiers still unreachable"
    # ...and the distribution must be genuinely spread, not a 20-point smear.
    assert scores[-1] - scores[0] > 55


def test_uncalibrated_blend_would_have_been_compressed():
    """Documents the old failure mode: raw blended scores for a realistic pool
    all land well below the high-tier threshold before calibration."""
    feats = RankFeatures(proto_sim=0.52, keyword_coverage=0.25,
                         deadline_feasibility=1.0, award_fit=0.6)
    assert raw_score(feats) * 100 < 75


def test_weak_pool_does_not_claim_excellent_fit():
    """Percentile calibration alone guarantees ~10% of any pool scores >=90,
    even a pool with nothing good in it. The quality damp must prevent that."""
    weak = [RankFeatures(proto_sim=float(s), keyword_coverage=0.0) for s in
            np.linspace(0.05, 0.20, 60)]
    quantiles = build_quantiles(raw_score(f) for f in weak)
    ctx = InstitutionRankingContext(quantiles=quantiles)
    top = max(calibrated_score(f, ctx) for f in weak)
    assert top < 75, f"weak pool produced a {top:.1f} — damp not applied"


def test_strong_match_outranks_weak_match():
    quantiles = build_quantiles(
        raw_score(RankFeatures(proto_sim=float(s), keyword_coverage=0.2))
        for s in np.linspace(0.1, 0.7, 100)
    )
    ctx = InstitutionRankingContext(quantiles=quantiles)
    strong = calibrated_score(RankFeatures(proto_sim=0.68, keyword_coverage=0.8), ctx)
    weak = calibrated_score(RankFeatures(proto_sim=0.12, keyword_coverage=0.0), ctx)
    assert strong > weak + 30


# ── Multi-prototype vs. single centroid ──────────────────────────────────────

def test_max_over_prototypes_beats_averaged_centroid_for_multi_interest_org():
    """A lab doing both water sanitation and medical imaging: the mean of the two
    interest vectors describes neither, and scores a grant in one of them poorly.
    Max-over-prototypes must score that grant highly."""
    water = _unit(1.0, 0.0, 0.0)
    imaging = _unit(0.0, 1.0, 0.0)
    grant_about_water = np.array(_unit(0.97, 0.05, 0.1), dtype=np.float32)

    prototypes = l2_normalize(np.array([water, imaging], dtype=np.float32))
    ctx = InstitutionRankingContext(positive=prototypes, labels=["Water grant", "Imaging grant"],
                                    won_mask=np.array([False, False]))
    feats = compute_features(grant_about_water, ctx, keyword_coverage=0.0,
                             funder=None, deadline=None)

    averaged = np.array(_unit(*(np.array(water) + np.array(imaging))), dtype=np.float32)
    centroid_sim = float(averaged @ grant_about_water)

    assert feats.proto_sim > 0.95
    assert feats.proto_sim > centroid_sim + 0.2
    assert feats.best_prototype == "Water grant"


def test_won_prototype_similarity_is_tracked_separately():
    won = _unit(1.0, 0.0)
    unfunded = _unit(0.0, 1.0)
    ctx = InstitutionRankingContext(
        positive=l2_normalize(np.array([won, unfunded], dtype=np.float32)),
        labels=["Awarded work", "Unfunded work"],
        won_mask=np.array([True, False]),
    )
    feats = compute_features(np.array(_unit(0.0, 1.0), dtype=np.float32), ctx,
                            keyword_coverage=0.0, funder=None, deadline=None)
    assert feats.proto_sim > 0.99          # matches the unfunded prototype
    assert feats.won_sim < 0.1             # but not the awarded one


def test_negative_prototypes_penalize_score():
    disliked = _unit(1.0, 0.0)
    ctx = InstitutionRankingContext(negative=l2_normalize(np.array([disliked], dtype=np.float32)))
    feats = compute_features(np.array(_unit(1.0, 0.0), dtype=np.float32), ctx,
                             keyword_coverage=0.5, funder=None, deadline=None)
    assert feats.neg_sim > 0.99
    penalized = raw_score(feats)
    feats.neg_sim = 0.0
    assert raw_score(feats) > penalized


# ── Practical signals ────────────────────────────────────────────────────────

def test_deadline_feasibility_is_an_inverted_u():
    today = date(2026, 1, 1)
    passed = deadline_feasibility(today - timedelta(days=1), today)
    imminent = deadline_feasibility(today + timedelta(days=5), today)
    workable = deadline_feasibility(today + timedelta(days=60), today)
    distant = deadline_feasibility(today + timedelta(days=400), today)
    assert passed == 0.0
    assert imminent < workable
    assert distant < workable
    # No deadline (rolling call) must be neutral, not penalized to zero.
    assert deadline_feasibility(None, today) > 0.5


def test_award_fit_is_log_scaled_and_neutral_without_history():
    assert award_fit(100_000, 120_000, None) == pytest.approx(0.6)
    on_target = award_fit(90_000, 110_000, 100_000)
    decade_off = award_fit(900_000, 1_100_000, 100_000)
    assert on_target > 0.9
    assert decade_off < on_target
    # Two decades off should be worse still, but never zero.
    assert 0.0 < award_fit(9_000_000, 11_000_000, 100_000) < decade_off


def test_funder_normalization_collapses_boilerplate():
    assert normalize_funder("The Wellcome Trust") == normalize_funder("Wellcome Trust")
    assert normalize_funder("Bill & Melinda Gates Foundation") == normalize_funder(
        "Bill Melinda Gates Foundation"
    )
    assert normalize_funder(None) == ""


def test_funder_affinity_raises_score():
    ctx = InstitutionRankingContext(funder_affinity={"wellcome trust": 0.9})
    hit = compute_features(None, ctx, keyword_coverage=0.2,
                           funder="The Wellcome Trust", deadline=None)
    miss = compute_features(None, ctx, keyword_coverage=0.2,
                            funder="Unknown Funder", deadline=None)
    assert hit.funder_affinity == 0.9
    assert miss.funder_affinity == 0.0
    assert raw_score(hit) > raw_score(miss)


# ── Graceful degradation ─────────────────────────────────────────────────────

def test_no_embedding_falls_back_to_keyword_and_context_only():
    ctx = InstitutionRankingContext()
    strong_kw = compute_features(None, ctx, keyword_coverage=1.0, funder=None, deadline=None)
    weak_kw = compute_features(None, ctx, keyword_coverage=0.0, funder=None, deadline=None)
    assert raw_score(strong_kw) > raw_score(weak_kw)


def test_percentile_of_is_monotonic_and_bounded():
    quantiles = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5]
    previous = -1.0
    for raw in np.linspace(-0.5, 1.5, 50):
        pct = percentile_of(float(raw), quantiles)
        assert 0.0 <= pct <= 100.0
        assert pct >= previous
        previous = pct


def test_cold_start_without_quantiles_still_differentiates():
    ctx = InstitutionRankingContext(quantiles=[])
    high = calibrated_score(RankFeatures(proto_sim=0.60, keyword_coverage=0.8), ctx)
    low = calibrated_score(RankFeatures(proto_sim=0.10, keyword_coverage=0.0), ctx)
    assert high > low + 20


def test_build_quantiles_needs_enough_samples():
    assert build_quantiles([0.1, 0.2, 0.3]) == []
    assert len(build_quantiles(np.linspace(0, 1, 100))) == 21


# ── Rationale ────────────────────────────────────────────────────────────────

def test_rationale_cites_awarded_prior_work_first():
    feats = RankFeatures(proto_sim=0.8, won_sim=0.8, best_prototype="Malaria Vector Study")
    text = build_rationale(feats, ["malaria"], "Wellcome Trust")
    assert "Malaria Vector Study" in text
    assert "awarded" in text.lower()


def test_rationale_is_honest_about_weak_matches():
    assert "weak match" in build_rationale(RankFeatures(), [], None).lower()


# ── Keyword scorer fixes ─────────────────────────────────────────────────────

def test_keyword_matching_respects_word_boundaries():
    """'ai' must not match 'maintenance' or 'sustainability'."""
    result = keyword_score_opportunity(
        title="Infrastructure maintenance and sustainability programme",
        profile_keywords=["ai"],
    )
    assert result["matched_themes"] == []
    assert result["keyword_coverage"] == 0.0


def test_keyword_matching_still_finds_phrases():
    result = keyword_score_opportunity(
        title="Grants for machine learning in global health",
        profile_keywords=["machine learning", "global health"],
    )
    assert set(result["matched_themes"]) == {"machine learning", "global health"}


def test_coverage_saturates_so_rich_profiles_are_not_penalized():
    """The old formula divided by profile size: four title matches against a
    40-keyword profile scored 4/40 = 0.1, so carefully filling out a profile made
    ranking worse. Coverage now saturates, leaving at most a small bounded gap."""
    title = "Water sanitation and hygiene programme for rural climate resilience"
    matched = ["water", "sanitation", "hygiene", "climate"]

    small = keyword_score_opportunity(title=title, profile_keywords=matched)
    large = keyword_score_opportunity(
        title=title, profile_keywords=matched + [f"unrelated{i}" for i in range(36)]
    )
    assert small["keyword_coverage"] == 1.0
    # The old behaviour here was 0.1. The penalty is now capped by the saturation
    # point rather than scaling with profile size.
    assert large["keyword_coverage"] >= 0.75
    assert large["fit_score"] >= 75


def test_secondary_matches_count_less_than_title_matches():
    in_title = keyword_score_opportunity(title="Climate resilience fund",
                                         profile_keywords=["climate"])
    in_body = keyword_score_opportunity(title="General fund",
                                        description="Supports climate work",
                                        profile_keywords=["climate"])
    assert in_title["keyword_coverage"] > in_body["keyword_coverage"] > 0


def test_exclusion_is_reported_explicitly():
    result = keyword_score_opportunity(
        title="Defense research programme",
        profile_keywords=["research"],
        excluded_keywords=["defense"],
    )
    assert result["excluded"] is True
    assert result["keyword_coverage"] == 0.0


def test_missing_profile_keywords_yields_neutral_coverage_not_a_fake_ratio():
    """The old code reverse-engineered coverage out of the score, turning the
    'no keywords configured' sentinel (55) into a coverage of 0.42."""
    result = keyword_score_opportunity(title="Anything", profile_keywords=[])
    assert result["keyword_coverage"] == 0.5
    assert result["excluded"] is False


# ── Calibration pipeline ordering ────────────────────────────────────────────

def test_compute_features_populates_raw():
    """Regression: the calibration pass builds the score distribution from
    `feats.raw` before anything is calibrated. When `raw` was only populated
    later (inside calibrated_score), every quantile came out 0.0, every
    opportunity mapped to the 100th percentile, and the whole feed collapsed into
    a narrow high band with an empty 'low' tier."""
    ctx = InstitutionRankingContext()
    feats = compute_features(None, ctx, keyword_coverage=0.8, funder=None, deadline=None)
    assert feats.raw > 0.0


def test_quantiles_from_compute_features_are_not_degenerate():
    prototypes = l2_normalize(np.eye(8, dtype=np.float32))
    ctx = InstitutionRankingContext(
        positive=prototypes,
        labels=[f"proto{i}" for i in range(8)],
        won_mask=np.zeros(8, dtype=bool),
    )
    rng = np.random.default_rng(3)
    feats = [
        compute_features(
            l2_normalize(rng.normal(size=(1, 8)).astype(np.float32))[0],
            ctx, keyword_coverage=float(rng.random()), funder=None, deadline=None,
        )
        for _ in range(120)
    ]
    quantiles = build_quantiles(f.raw for f in feats)
    assert len(quantiles) == 21
    assert quantiles[-1] > quantiles[0], "degenerate distribution — raw never populated"

    ctx.quantiles = quantiles
    scores = sorted(calibrated_score(f, ctx) for f in feats)
    # A real distribution must use the low end of the scale, not just the top.
    assert scores[0] < 25
    assert scores[-1] - scores[0] > 40

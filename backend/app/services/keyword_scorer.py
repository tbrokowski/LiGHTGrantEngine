"""
Zero-LLM keyword-based grant fit scorer.

Produces a keyword-coverage signal (and a standalone fit_score for callers that
have no embeddings) without any AI API calls.

Two defects in the previous version are fixed here:

  * **Substring matching.** `kw in text` meant the keyword "ai" matched
    "maintenance" and "sustainability", and "water" missed "waters". Matching is
    now word-boundary aware, so multi-word phrases still work but spurious
    infixes don't.

  * **Coverage divided by profile size.** Coverage was `matches /
    len(profile_keywords)`, so an org with 40 keywords could never score well —
    no single grant mentions 30 of 40 topics. The more carefully someone filled
    out their profile, the worse their ranking got. Coverage now saturates: a
    handful of strong matches is already a full signal.

The numeric fit_score is kept for internal threshold comparisons
(auto_queue_threshold) and as the fallback when an opportunity has no embedding.
The `keyword_coverage` field is the value the calibrated ranker actually
consumes — previously it was reverse-engineered out of the score, which
conflated the flat "no keywords configured" and "excluded" sentinel values with
real coverage ratios.
"""
from __future__ import annotations

import re
from functools import lru_cache
from typing import Optional

# Matching this many distinct profile keywords is already a complete keyword
# signal. Beyond it, coverage saturates rather than dividing by profile size.
COVERAGE_SATURATION = 5

# Weight of a description/funder hit relative to a title/theme hit.
_SECONDARY_WEIGHT = 0.4


@lru_cache(maxsize=4096)
def _pattern(keyword: str) -> re.Pattern:
    """Word-boundary matcher for one keyword or phrase. Cached — the same org
    keywords are matched against thousands of opportunities per rescore."""
    escaped = r"\s+".join(re.escape(part) for part in keyword.split())
    return re.compile(rf"(?<!\w){escaped}(?!\w)", re.IGNORECASE)


def _matches(keywords: list[str], text: str) -> list[str]:
    if not text:
        return []
    return [kw for kw in keywords if _pattern(kw).search(text)]


def tier_from_score(fit_score: float) -> str:
    """Map a continuous 0-100 fit_score to a priority tier. Shared so keyword
    scoring and the calibrated ranker always agree on the same thresholds."""
    if fit_score >= 75:
        return "high"
    if fit_score >= 45:
        return "medium"
    return "low"


def keyword_score_opportunity(
    title: str,
    description: str = "",
    funder: str = "",
    eligibility: str = "",
    geography: Optional[list[str]] = None,
    award_min: Optional[int] = None,
    award_max: Optional[int] = None,
    deadline=None,
    thematic_areas: Optional[list[str]] = None,
    profile_keywords: Optional[list[str]] = None,
    profile_geographies: Optional[list[str]] = None,
    excluded_keywords: Optional[list[str]] = None,
) -> dict:
    """
    Score a grant opportunity against org profile keywords.
    Pure sync, zero I/O — safe to call from any context.

    Returns a dict with:
      fit_score         — 0-100 standalone keyword score (fallback path)
      priority          — "high" | "medium" | "low"
      fit_rationale     — human-readable explanation string
      matched_themes    — list of matched keyword strings
      keyword_coverage  — 0..1 saturating coverage, consumed by the ranker
      excluded          — True when an exclusion keyword fired
      scoring_method    — "keyword"
    """
    profile_keywords = [kw.lower().strip() for kw in (profile_keywords or []) if kw.strip()]
    excluded_keywords = [kw.lower().strip() for kw in (excluded_keywords or []) if kw.strip()]
    thematic_areas = thematic_areas or []

    primary_text = f"{title or ''} {' '.join(thematic_areas)}"
    secondary_text = f"{description or ''} {funder or ''}"

    # ── Exclusion check ────────────────────────────────────────────────────────
    if excluded_keywords:
        hit_exclusions = _matches(excluded_keywords, f"{primary_text} {secondary_text}")
        if hit_exclusions:
            excl_str = ", ".join(f"'{kw}'" for kw in hit_exclusions[:3])
            return {
                "fit_score": 10,
                "priority": "low",
                "fit_rationale": f"Excluded — contains {excl_str}.",
                "matched_themes": [],
                "keyword_coverage": 0.0,
                "excluded": True,
                "scoring_method": "keyword",
            }

    # ── No profile keywords set — neutral, and an explicitly neutral coverage ──
    if not profile_keywords:
        return {
            "fit_score": 55,
            "priority": "medium",
            "fit_rationale": "No org profile keywords configured — defaulting to Medium.",
            "matched_themes": [],
            "keyword_coverage": 0.5,
            "excluded": False,
            "scoring_method": "keyword",
        }

    primary_matches = _matches(profile_keywords, primary_text)
    secondary_matches = [
        kw for kw in _matches(profile_keywords, secondary_text) if kw not in primary_matches
    ]
    all_matches = list(dict.fromkeys(primary_matches + secondary_matches))

    # ── Saturating coverage ───────────────────────────────────────────────────
    # Denominator is capped at COVERAGE_SATURATION so a rich profile is an asset
    # rather than a handicap; secondary-field hits count for less than title hits.
    denom = max(1, min(len(profile_keywords), COVERAGE_SATURATION))
    weighted = len(primary_matches) + _SECONDARY_WEIGHT * len(secondary_matches)
    coverage = max(0.0, min(1.0, weighted / denom))

    fit_score = min(97, round(20 + coverage * 77))
    priority = tier_from_score(fit_score)

    if primary_matches:
        kw_list = ", ".join(f"'{kw}'" for kw in primary_matches[:5])
        fit_rationale = f"Matched {kw_list} in title or thematic areas."
    elif secondary_matches:
        kw_list = ", ".join(f"'{kw}'" for kw in secondary_matches[:5])
        fit_rationale = f"Matched {kw_list} in description or funder."
    else:
        fit_rationale = "No profile keywords matched this opportunity."

    return {
        "fit_score": fit_score,
        "priority": priority,
        "fit_rationale": fit_rationale,
        "matched_themes": all_matches[:15],
        "keyword_coverage": coverage,
        "excluded": False,
        "scoring_method": "keyword",
    }

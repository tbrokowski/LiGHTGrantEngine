"""
Zero-LLM keyword-based grant fit scorer.

Used by all background Celery scoring tasks to produce fit_score, priority tier,
and a human-readable fit_rationale without any AI API calls.

Scoring (continuous, based on the proportion of the org's profile keywords that
match — not just whether *any* single keyword matches):
  score = 25 + up to 60 points scaled by the share of profile keywords found in
          primary fields (title / thematic areas), + up to 30 points scaled by
          the share found in secondary fields (description / funder), capped at 97.
  High   (>= 75) / Medium (>= 45) / Low (< 45)
  Archived — exclusion keyword found (caller handles archiving)

This intentionally replaces a flat 85/55/25 bucket scheme: a grant matching one
of five profile keywords in the title scored the same as a grant matching all
five, which meant nearly every remotely-relevant opportunity landed in the same
tier. Scaling by match coverage gives a continuous signal that's more useful for
sorting/filtering by "Fit level."

The numeric fit_score is kept for internal threshold comparisons (auto_queue_threshold).
"""
from __future__ import annotations

from typing import Optional


def tier_from_score(fit_score: float) -> str:
    """Map a continuous 0-100 fit_score to a priority tier. Shared so that
    keyword scoring and any post-hoc score adjustment (e.g. taste-profile
    blending in surfacing_tasks.py) always agree on the same thresholds."""
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
      fit_score       — int anchor value (85 / 55 / 25) for threshold filtering
      priority        — "high" | "medium" | "low"
      fit_rationale   — human-readable explanation string
      matched_themes  — list of matched keyword strings
      scoring_method  — "keyword"
    """
    profile_keywords = [kw.lower().strip() for kw in (profile_keywords or []) if kw.strip()]
    excluded_keywords = [kw.lower().strip() for kw in (excluded_keywords or []) if kw.strip()]
    thematic_areas = thematic_areas or []

    title_lower = (title or "").lower()
    desc_lower = (description or "").lower()
    theme_lower = " ".join(thematic_areas).lower()
    funder_lower = (funder or "").lower()

    # ── Exclusion check ────────────────────────────────────────────────────────
    if excluded_keywords:
        full_text = f"{title_lower} {desc_lower} {theme_lower} {funder_lower}"
        hit_exclusions = [kw for kw in excluded_keywords if kw in full_text]
        if hit_exclusions:
            excl_str = ", ".join(f"'{kw}'" for kw in hit_exclusions[:3])
            return {
                "fit_score": 10,
                "priority": "low",
                "fit_rationale": f"Excluded — contains {excl_str}.",
                "matched_themes": [],
                "scoring_method": "keyword",
            }

    # ── No profile keywords set — neutral medium ───────────────────────────────
    if not profile_keywords:
        return {
            "fit_score": 55,
            "priority": "medium",
            "fit_rationale": "No org profile keywords configured — defaulting to Medium.",
            "matched_themes": [],
            "scoring_method": "keyword",
        }

    # ── Keyword matching ────────────────────────────────────────────────────────
    # Primary fields: title and thematic areas → High
    primary_text = f"{title_lower} {theme_lower}"
    primary_matches = [kw for kw in profile_keywords if kw in primary_text]

    # Secondary fields: description and funder → Medium
    secondary_text = f"{desc_lower} {funder_lower}"
    secondary_matches = [
        kw for kw in profile_keywords
        if kw not in primary_matches and kw in secondary_text
    ]

    all_matches = list(dict.fromkeys(primary_matches + secondary_matches))

    # ── Continuous score, scaled by proportion of profile keywords matched ─────
    num_profile_kw = max(len(profile_keywords), 1)
    primary_ratio = len(primary_matches) / num_profile_kw
    secondary_ratio = len(secondary_matches) / num_profile_kw
    fit_score = min(97, round(25 + min(primary_ratio, 1.0) * 60 + min(secondary_ratio, 1.0) * 30))
    priority = tier_from_score(fit_score)

    if primary_matches:
        kw_list = ", ".join(f"'{kw}'" for kw in primary_matches[:5])
        fit_rationale = (
            f"Matched {kw_list} in title or thematic areas "
            f"({len(primary_matches)}/{num_profile_kw} profile keywords)."
        )
    elif secondary_matches:
        kw_list = ", ".join(f"'{kw}'" for kw in secondary_matches[:5])
        fit_rationale = (
            f"Matched {kw_list} in description or funder "
            f"({len(secondary_matches)}/{num_profile_kw} profile keywords)."
        )
    else:
        fit_rationale = "No profile keywords matched this opportunity."

    return {
        "fit_score": fit_score,
        "priority": priority,
        "fit_rationale": fit_rationale,
        "matched_themes": all_matches[:15],
        "scoring_method": "keyword",
    }

"""
Zero-LLM keyword-based grant fit scorer.

Used by all background Celery scoring tasks to produce fit_score, priority tier,
and a human-readable fit_rationale without any AI API calls.

Scoring tiers (based on org profile keyword matching):
  High   (85)  — profile keyword found in title or primary thematic areas
  Medium (55)  — profile keyword found in description, funder name, or secondary fields
  Low    (25)  — no keyword match (but no exclusion hit)
  Archived     — exclusion keyword found (caller handles archiving)

The numeric fit_score is kept for internal threshold comparisons (auto_queue_threshold).
"""
from __future__ import annotations

from typing import Optional


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

    # ── Determine tier ─────────────────────────────────────────────────────────
    if primary_matches:
        priority = "high"
        fit_score = 85
        kw_list = ", ".join(f"'{kw}'" for kw in primary_matches[:5])
        fit_rationale = f"High fit — matched {kw_list} in title or thematic areas."
    elif secondary_matches:
        priority = "medium"
        fit_score = 55
        kw_list = ", ".join(f"'{kw}'" for kw in secondary_matches[:5])
        fit_rationale = f"Medium fit — matched {kw_list} in description or funder."
    else:
        priority = "low"
        fit_score = 25
        fit_rationale = "Low fit — no profile keywords matched this opportunity."

    return {
        "fit_score": fit_score,
        "priority": priority,
        "fit_rationale": fit_rationale,
        "matched_themes": all_matches[:15],
        "scoring_method": "keyword",
    }

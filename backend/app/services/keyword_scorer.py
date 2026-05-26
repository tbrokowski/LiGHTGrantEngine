"""
Zero-LLM keyword-based grant fit scorer.

Used by all background Celery scoring tasks to produce fit_score and priority
tier without any AI API calls. Fast, deterministic, and free to run at scale.

Scoring dimensions (total 0-100):
  - Thematic alignment  0-40  (weighted keyword match: title 2x, themes 1.5x, desc 1x)
  - Geography           0-15  (profile geo cross-match)
  - Deadline            0-10  (days-until tiers)
  - Award size          0-10  (presence + range reasonableness)
  - Eligibility         0-10  (org-type keyword scan)
  - Funder relevance    0- 5  (funder name in profile keywords)

Priority tiers:
  >= 75  →  high_priority
  >= 55  →  worth_reviewing
  >= 35  →  watchlist
  <  35  →  low_fit
"""
from __future__ import annotations

from datetime import date
from typing import Optional


def keyword_score_opportunity(
    title: str,
    description: str = "",
    funder: str = "",
    eligibility: str = "",
    geography: Optional[list[str]] = None,
    award_min: Optional[int] = None,
    award_max: Optional[int] = None,
    deadline: Optional[date] = None,
    thematic_areas: Optional[list[str]] = None,
    profile_keywords: Optional[list[str]] = None,
    profile_geographies: Optional[list[str]] = None,
    excluded_keywords: Optional[list[str]] = None,
) -> dict:
    """
    Score a grant opportunity against org profile keywords.
    Pure sync, zero I/O — safe to call from any context.
    """
    profile_keywords = [kw.lower().strip() for kw in (profile_keywords or []) if kw.strip()]
    profile_geographies = [g.lower().strip() for g in (profile_geographies or []) if g.strip()]
    excluded_keywords = [kw.lower().strip() for kw in (excluded_keywords or []) if kw.strip()]
    thematic_areas = thematic_areas or []

    title_lower = (title or "").lower()
    desc_lower = (description or "").lower()
    theme_lower = " ".join(thematic_areas).lower()
    funder_lower = (funder or "").lower()
    elig_lower = (eligibility or "").lower()
    opp_geos = [g.lower().strip() for g in (geography or [])]
    opp_geo_text = " ".join(opp_geos)

    # ── 1. Thematic alignment (0-40) ───────────────────────────────────────────
    matched_kws: list[tuple[str, float]] = []
    if profile_keywords:
        for kw in profile_keywords:
            if kw in title_lower:
                matched_kws.append((kw, 2.0))
            elif kw in theme_lower:
                matched_kws.append((kw, 1.5))
            elif kw in desc_lower or kw in funder_lower:
                matched_kws.append((kw, 1.0))

        weighted = sum(w for _, w in matched_kws)
        # Scale: if half the keywords match at full weight, that's 40 pts
        theme_score = min(40, round(weighted / max(len(profile_keywords), 1) * 40 * 2))
    else:
        theme_score = 20  # neutral when no profile keywords set

    # Exclusion penalty
    if excluded_keywords:
        full_text = f"{title_lower} {desc_lower} {theme_lower}"
        penalty = sum(8 for kw in excluded_keywords if kw in full_text)
        theme_score = max(0, theme_score - penalty)

    matched_theme_names = list(dict.fromkeys(kw for kw, _ in matched_kws))

    # ── 2. Geography (0-15) ────────────────────────────────────────────────────
    if not profile_geographies:
        geo_score = 10  # neutral
    elif any(
        pg in opp_geo_text or opp_geo_text in pg or _geo_overlap(pg, opp_geos)
        for pg in profile_geographies
    ):
        geo_score = 15
    elif any(
        word in opp_geo_text
        for word in ("global", "international", "worldwide", "any country", "all countries")
    ):
        geo_score = 10
    elif not opp_geos:
        geo_score = 8  # geography not specified — benefit of doubt
    else:
        geo_score = 3

    # ── 3. Deadline feasibility (0-10) ─────────────────────────────────────────
    if deadline is None:
        deadline_score = 6
    else:
        days = (deadline - date.today()).days
        if days < 0:
            deadline_score = 0
        elif days <= 14:
            deadline_score = 1
        elif days <= 30:
            deadline_score = 3
        elif days <= 90:
            deadline_score = 5
        elif days <= 180:
            deadline_score = 8
        else:
            deadline_score = 10

    # ── 4. Award size (0-10) ───────────────────────────────────────────────────
    if award_max and award_max > 0:
        if 10_000 <= award_max <= 100_000_000:
            award_score = 8
        else:
            award_score = 5
    elif award_min and award_min > 0:
        award_score = 6
    else:
        award_score = 5  # unknown size — neutral

    # ── 5. Eligibility org-type check (0-10) ───────────────────────────────────
    _NEGATIVE_ELIG = (
        "for-profit only", "companies only", "industry only", "sme only",
        "private sector only", "businesses only",
    )
    _POSITIVE_ELIG = (
        "university", "universities", "research institution", "research organisation",
        "research organization", "academic", "non-profit", "nonprofit", "ngo",
        "higher education", "public institution", "public body", "research center",
        "research centre",
    )
    if any(phrase in elig_lower for phrase in _NEGATIVE_ELIG):
        elig_score = 2
    elif any(phrase in elig_lower for phrase in _POSITIVE_ELIG):
        elig_score = 10
    else:
        elig_score = 7  # benefit of doubt

    # ── 6. Funder relevance (0-5) ──────────────────────────────────────────────
    if profile_keywords and any(kw in funder_lower for kw in profile_keywords):
        funder_score = 5
    elif funder_lower:
        funder_score = 3
    else:
        funder_score = 2

    # ── Total + tier ───────────────────────────────────────────────────────────
    total = theme_score + geo_score + deadline_score + award_score + elig_score + funder_score
    total = max(0, min(100, total))

    if total >= 75:
        priority = "high_priority"
    elif total >= 55:
        priority = "worth_reviewing"
    elif total >= 35:
        priority = "watchlist"
    else:
        priority = "low_fit"

    return {
        "fit_score": total,
        "priority": priority,
        "scoring_method": "keyword",
        "matched_themes": matched_theme_names[:15],
        "score_breakdown": {
            "thematic_alignment": theme_score,
            "geography": geo_score,
            "deadline_feasibility": deadline_score,
            "award_size": award_score,
            "eligibility": elig_score,
            "funder_relevance": funder_score,
        },
    }


def _geo_overlap(profile_geo: str, opp_geos: list[str]) -> bool:
    """Fuzzy check: profile geo tokens overlap with any opportunity geo."""
    profile_tokens = set(profile_geo.split())
    for og in opp_geos:
        opp_tokens = set(og.split())
        if profile_tokens & opp_tokens:
            return True
    return False

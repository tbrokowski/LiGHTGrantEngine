"""
Deterministic word/page budget allocation across proposal sections.
"""
from __future__ import annotations

import re
from typing import Any

DEFAULT_WORDS_PER_PAGE = 500
MIN_SECTION_WORDS = 400
MAX_SECTION_FRACTION = 0.25
PRIORITY_MULTIPLIERS = {"high": 1.2, "medium": 1.0, "low": 0.7}
SIZE_MULTIPLIERS = {"small": 0.5, "medium": 1.0, "large": 1.8}


def parse_int_limit(value: Any) -> int | None:
    """Parse limits like '15,000 words', '70 pages', or int."""
    if value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    match = re.search(r"[\d,]+", str(value))
    if match:
        try:
            return int(match.group(0).replace(",", ""))
        except ValueError:
            pass
    return None


def resolve_total_words(
    total_word_limit: int | None,
    total_page_limit: Any,
    narrative_page_limit: int | None = None,
    words_per_page: int = DEFAULT_WORDS_PER_PAGE,
) -> tuple[int, str]:
    """
    Resolve document total word count. Prefer explicit words; else pages * words_per_page.
    Uses narrative_page_limit when set (excludes annexes).
    """
    if total_word_limit and total_word_limit > 500:
        return total_word_limit, "explicit_word_limit"
    pages = narrative_page_limit or parse_int_limit(total_page_limit)
    if pages and pages > 0:
        return pages * words_per_page, "pages_x_wpp"
    return 12000, "default_estimate"


def _section_weight(sec: dict, eval_weights: dict[str, float]) -> float:
    name = (sec.get("name") or "").strip()
    pri = (sec.get("priority") or "medium").lower()
    mult = PRIORITY_MULTIPLIERS.get(pri, 1.0)
    size = (sec.get("relative_size") or "medium").lower()
    size_mult = SIZE_MULTIPLIERS.get(size, 1.0)
    ew = eval_weights.get(name.lower(), 0.0)
    if ew > 0:
        return ew * mult
    if pri == "high":
        return 1.2 * mult * size_mult
    if pri == "low":
        return 0.7 * mult * size_mult
    return 1.0 * mult * size_mult


def evaluation_weights_from_call_intelligence(call_intelligence: dict) -> dict[str, float]:
    """Map section name (lower) -> relative weight from evaluation_framework sub-analysis."""
    weights: dict[str, float] = {}
    ef = call_intelligence.get("evaluation_framework") or {}
    if isinstance(ef, dict):
        for c in ef.get("criteria") or []:
            if not isinstance(c, dict):
                continue
            pct = c.get("weight_pct") or 0
            for sec_name in c.get("relevant_sections") or []:
                key = str(sec_name).lower()
                weights[key] = weights.get(key, 0) + float(pct) / 100.0
    return weights


def allocate_section_budgets(
    sections: list[dict],
    total_words: int,
    *,
    words_per_page: int = DEFAULT_WORDS_PER_PAGE,
    eval_weights: dict[str, float] | None = None,
    per_section_caps: dict[str, int] | None = None,
) -> list[dict]:
    """
    Distribute total_words across sections by evaluation weight × priority.
    Renormalizes so sum(word_limit) ≈ total_words.
    """
    if not sections:
        return []
    eval_weights = eval_weights or {}
    caps = per_section_caps or {}
    n = len(sections)
    max_per = max(MIN_SECTION_WORDS, int(total_words * MAX_SECTION_FRACTION))

    raw_weights = []
    for sec in sections:
        w = _section_weight(sec, eval_weights)
        cap = caps.get((sec.get("name") or "").lower())
        if isinstance(sec.get("word_limit"), int) and sec["word_limit"] > 0:
            w = sec["word_limit"]
        raw_weights.append(max(w, 0.1))

    total_w = sum(raw_weights) or n
    allocated = []
    for sec, rw in zip(sections, raw_weights):
        share = rw / total_w
        words = int(total_words * share)
        words = max(MIN_SECTION_WORDS, min(words, max_per))
        name = sec.get("name") or "Section"
        cap = caps.get(name.lower())
        if cap:
            words = min(words, cap)
        if isinstance(sec.get("word_limit"), int) and sec["word_limit"] > 0:
            words = sec["word_limit"]
        pages = round(words / words_per_page, 1)
        allocated.append({
            **sec,
            "name": name,
            "word_limit": words,
            "page_limit": sec.get("page_limit") or str(pages),
            "allocation_method": "weight_proportional",
        })

    # Renormalize to total_words (±2%)
    current_sum = sum(s["word_limit"] for s in allocated)
    if current_sum > 0 and abs(current_sum - total_words) > total_words * 0.02:
        ratio = total_words / current_sum
        for s in allocated:
            s["word_limit"] = max(MIN_SECTION_WORDS, int(s["word_limit"] * ratio))
        # Fix rounding drift on last section
        drift = total_words - sum(s["word_limit"] for s in allocated)
        if allocated and drift != 0:
            allocated[-1]["word_limit"] = max(
                MIN_SECTION_WORDS,
                allocated[-1]["word_limit"] + drift,
            )

    return allocated


def audit_constraints_compliance(
    document_constraints: dict,
    skeleton: dict | None = None,
) -> dict:
    """
    Deterministic constraints audit for reviewer / UI warnings.
    """
    issues: list[str] = []
    sections = document_constraints.get("sections") or []
    total = document_constraints.get("total_word_limit")
    if not total:
        issues.append("Document total word limit is not set.")
    else:
        section_sum = sum(int(s.get("word_limit") or 0) for s in sections)
        if section_sum and abs(section_sum - total) > total * 0.05:
            issues.append(
                f"Section word limits sum to {section_sum:,} but document total is {total:,}."
            )
        if total > 10000:
            for s in sections:
                wl = s.get("word_limit") or 0
                if wl and wl < 300:
                    issues.append(
                        f"Section '{s.get('name')}' has only {wl} target words for a large proposal."
                    )

    pages = parse_int_limit(document_constraints.get("total_page_limit"))
    narrative = document_constraints.get("narrative_page_limit")
    if pages and total:
        implied = (narrative or pages) * DEFAULT_WORDS_PER_PAGE
        if abs(implied - total) > total * 0.3 and not document_constraints.get("verification_notes"):
            issues.append(
                f"Page-derived word estimate ({implied:,}) differs significantly from total words ({total:,})."
            )

    required = document_constraints.get("required_sections") or []
    section_names = {(s.get("name") or "").lower() for s in sections}
    for req in required:
        if req and req.lower() not in section_names:
            issues.append(f"Required call section missing from budget: {req}")

    if skeleton:
        sk_sections = skeleton.get("sections") or []
        for s in sk_sections:
            name = s.get("name")
            dc = next((x for x in sections if x.get("name") == name), None)
            if dc and s.get("word_limit") and dc.get("word_limit"):
                if s["word_limit"] != dc["word_limit"]:
                    issues.append(
                        f"Skeleton section '{name}' limit ({s['word_limit']}) differs from document_constraints ({dc['word_limit']})."
                    )

    return {
        "passed": len(issues) == 0,
        "issues": issues,
        "section_word_sum": sum(int(s.get("word_limit") or 0) for s in sections),
        "total_word_limit": total,
    }

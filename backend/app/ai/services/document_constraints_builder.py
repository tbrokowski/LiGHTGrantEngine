"""
Build document_constraints: extract → verify → allocate → align with idea → merge user overrides.
"""
from __future__ import annotations

from app.ai.agents.idea_constraints_aligner import align_constraints_to_idea
from app.ai.agents.limits_extractor import extract_limits
from app.ai.agents.limits_verifier import verify_limits
from app.ai.services.constraint_allocator import (
    allocate_section_budgets,
    evaluation_weights_from_call_intelligence,
    parse_int_limit,
    resolve_total_words,
)


def _build_section_list(
    call_analysis: dict,
    call_intelligence: dict,
    extracted: dict,
) -> list[dict]:
    """Merge required sections from call, blueprint, and per-section limits."""
    seen: dict[str, dict] = {}
    order = 0

    def add(name: str, **kwargs):
        nonlocal order
        key = name.strip().lower()
        if not key:
            return
        order += 1
        if key in seen:
            seen[key].update({k: v for k, v in kwargs.items() if v is not None})
        else:
            seen[key] = {
                "name": name.strip(),
                "word_limit": kwargs.get("word_limit"),
                "page_limit": kwargs.get("page_limit"),
                "priority": kwargs.get("priority") or "medium",
                "order": kwargs.get("order") or order,
                "required": kwargs.get("required", False),
            }

    for sec_name in call_analysis.get("required_sections") or []:
        if isinstance(sec_name, str):
            add(sec_name, required=True, priority="high")

    sec_reqs = call_analysis.get("section_requirements") or {}
    for sec_name, details in sec_reqs.items():
        if not isinstance(details, dict):
            continue
        add(
            sec_name,
            word_limit=details.get("word_limit"),
            page_limit=details.get("page_limit"),
            priority=details.get("priority") or "medium",
            required=True,
        )

    per_sec = extracted.get("per_section_limits") or {}
    for sec_name, details in per_sec.items():
        if isinstance(details, dict):
            add(
                sec_name,
                word_limit=details.get("word_limit"),
                page_limit=details.get("page_limit"),
            )

    blueprint = call_intelligence.get("section_blueprint") or []
    for sec in blueprint:
        if not isinstance(sec, dict):
            continue
        name = sec.get("name") or ""
        add(
            name,
            word_limit=sec.get("suggested_word_count"),
            priority="high" if sec.get("required") else "medium",
        )

    if not seen:
        for sec in blueprint[:8]:
            if isinstance(sec, dict) and sec.get("name"):
                add(sec["name"], priority="medium")

    return sorted(seen.values(), key=lambda x: x.get("order", 99))


def merge_user_section_overrides(
    sections: list[dict],
    user_section_constraints: list[dict] | None,
    user_total_word_limit: int | None,
    user_total_page_limit: str | None,
) -> tuple[list[dict], int | None, str | None]:
    """Field-level merge: user values override auto for matching section names."""
    if not user_section_constraints:
        return sections, user_total_word_limit, user_total_page_limit

    by_name = {s["name"].lower(): dict(s) for s in sections}
    for us in user_section_constraints:
        name = (us.get("name") or "").strip()
        if not name:
            continue
        key = name.lower()
        base = by_name.get(key, {"name": name, "order": len(by_name) + 1})
        for field in ("word_limit", "page_limit", "priority", "order"):
            if us.get(field) is not None:
                base[field] = us[field]
        by_name[key] = base

    merged = sorted(by_name.values(), key=lambda x: x.get("order", 99))
    return merged, user_total_word_limit, user_total_page_limit


async def build_document_constraints(
    *,
    call_requirements: str,
    call_analysis: dict,
    call_intelligence: dict,
    grant_idea: str = "",
    aligned_concept: dict | None = None,
    user_section_constraints: list[dict] | None = None,
    user_total_word_limit: int | None = None,
    user_total_page_limit: str | None = None,
    funder: str = "",
    title: str = "",
) -> dict:
    """Full Stage 0 pipeline → document_constraints dict."""
    extracted = await extract_limits(
        call_requirements=call_requirements,
        call_analysis=call_analysis,
        funder=funder,
        title=title,
    )
    verification = await verify_limits(
        extracted=extracted,
        call_requirements=call_requirements,
        call_analysis=call_analysis,
    )
    verified = verification.get("verified") or extracted
    confidence = verification.get("confidence") or "medium"

    total_page_limit = user_total_page_limit or verified.get("total_page_limit") or call_analysis.get("page_limit")
    total_word_limit = user_total_word_limit or verified.get("total_word_limit")
    if not total_word_limit:
        ci_total = call_intelligence.get("total_allocated_words")
        if isinstance(ci_total, int) and ci_total > 500:
            total_word_limit = ci_total

    narrative_pages = verified.get("narrative_page_limit")
    total_words, allocation_method = resolve_total_words(
        parse_int_limit(total_word_limit),
        total_page_limit,
        narrative_page_limit=narrative_pages,
    )

    sections = _build_section_list(call_analysis, call_intelligence, verified)
    eval_weights = evaluation_weights_from_call_intelligence(call_intelligence)

    per_caps = {}
    for name, det in (verified.get("per_section_limits") or {}).items():
        if isinstance(det, dict) and det.get("word_limit"):
            per_caps[name.lower()] = int(det["word_limit"])

    allocated = allocate_section_budgets(
        sections,
        total_words,
        eval_weights=eval_weights,
        per_section_caps=per_caps,
    )

    alignment = await align_constraints_to_idea(
        allocated,
        grant_idea=grant_idea,
        aligned_concept=aligned_concept,
        call_analysis=call_analysis,
        call_intelligence=call_intelligence,
    )
    aligned_sections = alignment.get("sections") or allocated
    by_name = {s["name"].lower(): s for s in allocated}
    for als in aligned_sections:
        key = (als.get("name") or "").lower()
        if key in by_name and als.get("priority"):
            by_name[key]["priority"] = als["priority"]
            if als.get("rationale"):
                by_name[key]["rationale"] = als["rationale"]

    # Idea-driven sections: the funder's call only dictates the REQUIRED structure —
    # the grant idea may describe distinct components that warrant their own section.
    # These are additive within the existing (locked) total_words budget, not on top of it.
    next_order = max((s.get("order", 0) for s in by_name.values()), default=0) + 1
    added_sections = 0
    for extra in (alignment.get("additional_sections") or [])[:4]:
        name = (extra.get("name") or "").strip()
        if not name:
            continue
        key = name.lower()
        if key in by_name:
            continue  # already covered by a required/existing section
        by_name[key] = {
            "name": name,
            "word_limit": None,
            "page_limit": None,
            "priority": extra.get("priority") or "medium",
            "order": next_order,
            "required": False,
            "idea_derived": True,
            "rationale": extra.get("rationale"),
        }
        next_order += 1
        added_sections += 1

    final_sections = sorted(by_name.values(), key=lambda x: x.get("order", 99))

    if added_sections:
        # Re-partition the same total_words across the larger section list — existing
        # sections yield a little room, new ones land at least MIN_SECTION_WORDS.
        final_sections = allocate_section_budgets(
            final_sections,
            total_words,
            eval_weights=eval_weights,
            per_section_caps=per_caps,
        )

    final_sections, tw, tp = merge_user_section_overrides(
        final_sections,
        user_section_constraints,
        user_total_word_limit or total_words,
        user_total_page_limit or (str(total_page_limit) if total_page_limit else None),
    )

    if user_total_word_limit:
        final_sections = allocate_section_budgets(
            final_sections,
            user_total_word_limit,
            eval_weights=eval_weights,
        )
        total_words = user_total_word_limit

    return {
        "total_word_limit": total_words,
        "total_page_limit": tp or (str(total_page_limit) if total_page_limit else None),
        "narrative_page_limit": narrative_pages,
        "annex_page_limit": verified.get("annex_page_limit"),
        "confidence": confidence,
        "verification_notes": verification.get("verification_notes") or [],
        "contradictions": verification.get("contradictions") or [],
        "sources": extracted.get("sources") or [],
        "required_sections": call_analysis.get("required_sections") or [],
        "allocation_method": allocation_method,
        "emphasis_notes": alignment.get("emphasis_notes") or [],
        "sections": final_sections,
    }


def enforce_skeleton_constraints(skeleton: dict, document_constraints: dict) -> dict:
    """Apply locked limits to skeleton output and fix (Target: N words) in raw_text."""
    import re

    sk = dict(skeleton)
    dc_sections = document_constraints.get("sections") or []
    limits_by_name = {s["name"]: s for s in dc_sections if s.get("name")}

    if document_constraints.get("total_word_limit"):
        sk["total_word_limit"] = document_constraints["total_word_limit"]
    if document_constraints.get("total_page_limit"):
        sk["total_page_limit"] = document_constraints["total_page_limit"]

    sections = sk.get("sections") or []
    updated_sections = []
    for sec in sections:
        name = sec.get("name") or ""
        dc = limits_by_name.get(name) or {}
        updated_sections.append({
            **sec,
            "word_limit": dc.get("word_limit") or sec.get("word_limit"),
            "page_limit": dc.get("page_limit") or sec.get("page_limit"),
            "priority": dc.get("priority") or sec.get("priority"),
        })
    if not updated_sections and dc_sections:
        updated_sections = [
            {
                "name": s["name"],
                "word_limit": s.get("word_limit"),
                "page_limit": s.get("page_limit"),
                "priority": s.get("priority", "medium"),
                "order": s.get("order", i + 1),
            }
            for i, s in enumerate(dc_sections)
        ]
    sk["sections"] = updated_sections

    raw = sk.get("raw_text") or ""
    if raw and limits_by_name:
        for name, dc in limits_by_name.items():
            target = dc.get("word_limit")
            if not target:
                continue
            pattern = rf"(##\s+{re.escape(name)}[\s\S]*?)\(Target:\s*\d+\s*words\)"
            replacement = rf"\1(Target: {target:,} words)"
            raw, n = re.subn(pattern, replacement, raw, count=1, flags=re.IGNORECASE)
            if n == 0:
                heading_pattern = rf"(##\s+{re.escape(name)}\s*\n)"
                if re.search(heading_pattern, raw, re.IGNORECASE):
                    raw = re.sub(
                        heading_pattern,
                        rf"\1\n(Target: {target:,} words)\n",
                        raw,
                        count=1,
                        flags=re.IGNORECASE,
                    )
        sk["raw_text"] = raw

    sk["document_constraints_applied"] = True
    return sk

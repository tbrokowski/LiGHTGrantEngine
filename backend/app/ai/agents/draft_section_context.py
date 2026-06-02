"""
Unified context builder and academic writing standards for all section drafters.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field


ACADEMIC_SYSTEM_PROMPT = """You are an expert academic grant proposal writer.

WRITING STANDARDS:
- Formal, precise register; third person where appropriate for the discipline
- No marketing fluff: avoid empty phrases ("innovative", "cutting-edge", "leverage", "world-class") unless quoting the call
- Every quantitative or comparative claim must include a citation or [VERIFY: specific item needed]
- Use concrete nouns from the grant idea: programs, sites, instruments, datasets, populations
- When ARCHIVE EXEMPLARS are provided, incorporate at least two specific details (methods, outcomes, phrasing) from them
- Address each KEY ASK from the call for this section explicitly in the prose
- Paragraph structure: topic sentence → evidence → implication for evaluation criteria
- Do not invent partners, IRB approval, sample sizes, preliminary results, or budget figures
- Expand the team's skeleton; preserve their framing and terminology — do not replace with generic templates
- Write full paragraphs with reasoning; avoid bullet lists unless the call requires them

Return valid JSON with a "draft" field containing HTML paragraphs (<p>...</p>)."""


METHODS_SYSTEM_ADDENDUM = """
SECTION TYPE: Methodology — include study design, population/setting, data and measures, analysis plan, ethics, limitations.
Use subheadings where appropriate. Name specific methods, software, and validation approaches."""

IMPACT_SYSTEM_ADDENDUM = """
SECTION TYPE: Impact / dissemination / sustainability — theory of change, pathways, indicators, stakeholders, scale-up."""

WP_SYSTEM_ADDENDUM = """
SECTION TYPE: Work packages — objectives, tasks, deliverables, milestones per WP. Use HTML tables where appropriate."""

INTRO_SYSTEM_ADDENDUM = """
SECTION TYPE: Introduction — follow the 6-beat narrative arc; compelling opening; connect to funder priorities."""


@dataclass
class SectionDraftContext:
    user_prompt: str
    system_prompt: str
    section_name: str
    target_words: int | None = None
    min_words: int | None = None


def _format_key_evidence(key_evidence: list | None) -> str:
    if not key_evidence:
        return ""
    lines = ["KEY EVIDENCE (use in prose — cite or mark [VERIFY] if uncertain):"]
    for item in key_evidence[:12]:
        if isinstance(item, dict):
            claim = item.get("claim") or item.get("text") or ""
            src = item.get("source_title") or item.get("source") or ""
            if claim:
                lines.append(f"- {claim}" + (f" ({src})" if src else ""))
        elif isinstance(item, str):
            lines.append(f"- {item}")
    return "\n".join(lines)


def _format_section_requirements(sec_req: dict | None) -> str:
    if not sec_req or not isinstance(sec_req, dict):
        return ""
    parts = []
    if sec_req.get("requirements"):
        parts.append(f"Section purpose (call): {sec_req['requirements']}")
    if sec_req.get("direct_quote"):
        parts.append(f"Call quote: \"{sec_req['direct_quote']}\"")
    for label, key in [
        ("KEY ASKS (address each explicitly)", "key_asks"),
        ("QUESTIONS TO ADDRESS", "questions_to_address"),
        ("EVIDENCE NEEDED", "evidence_needed"),
    ]:
        items = sec_req.get(key) or []
        if items:
            parts.append(f"{label}:\n" + "\n".join(f"  - {x}" for x in items[:8]))
    return "\n".join(parts)


def build_section_draft_context(
    *,
    section_name: str,
    section_type: str = "other",
    agent_kind: str = "default",
    grant_idea: str = "",
    skeleton_content: str = "",
    call_requirements: str = "",
    call_narrative_brief: str = "",
    evaluation_criteria: list | None = None,
    section_specific_requirements: dict | None = None,
    prior_sections_summary: str = "",
    evidence_summary: str = "",
    key_evidence: list | None = None,
    retrieved_sections: list | None = None,
    style_exemplars: list | None = None,
    reusable_language: list | None = None,
    concept_bundles: list | None = None,
    citations: list | None = None,
    narrative_context: dict | None = None,
    strategic_guidance: str = "",
    emphasis_direction: str = "",
    writing_instructions: str = "",
    compliance_guidance: str = "",
    opening_hook: str = "",
    strategic_framing: str = "",
    funder: str = "",
    style_profile: dict | None = None,
    target_words: int | None = None,
    min_words: int | None = None,
    user_instructions: str = "",
    intro_arc_str: str = "",
) -> SectionDraftContext:
    """Build unified user/system prompts for any section drafter."""
    sec_req = section_specific_requirements or {}
    tw = target_words or sec_req.get("word_limit")
    mn = min_words or (int(tw * 0.9) if tw else None)

    limit_parts = []
    if tw:
        limit_parts.append(
            f"WORD TARGET: {mn or int(tw * 0.9)}-{tw} words (write at least the minimum; aim for the target)"
        )
    elif sec_req.get("word_limit"):
        limit_parts.append(f"WORD LIMIT: {sec_req['word_limit']} words")

    blocks: list[str] = [
        f"Expand into a comprehensive {section_name} section for a competitive grant proposal.",
        f"FUNDER: {funder}",
        f"SECTION TYPE: {section_type}",
        "\n".join(limit_parts),
    ]

    if grant_idea:
        blocks.append(f"GRANT IDEA:\n{grant_idea[:5000]}")
    if skeleton_content:
        blocks.append(
            f"SKELETON CONTENT (team-authored — EXPAND THIS, preserve voice and claims):\n{skeleton_content[:8000]}"
        )

    sec_req_block = _format_section_requirements(sec_req)
    if sec_req_block:
        blocks.append(f"CALL REQUIREMENTS FOR THIS SECTION:\n{sec_req_block}")

    if call_narrative_brief:
        blocks.append(f"CALL NARRATIVE BRIEF:\n{call_narrative_brief[:5000]}")
    elif call_requirements:
        blocks.append(f"CALL REQUIREMENTS (guidance):\n{call_requirements[:4000]}")

    if evaluation_criteria:
        blocks.append(
            "EVALUATION CRITERIA (address in this section):\n"
            + "\n".join(f"- {c}" for c in evaluation_criteria[:10])
        )

    narrative_ctx = narrative_context or {}
    if narrative_ctx.get("theory_of_change") or narrative_ctx.get("funder_priorities_to_emphasize"):
        blocks.append(
            f"NARRATIVE CONTEXT:\n"
            f"Theory of change: {narrative_ctx.get('theory_of_change', '')}\n"
            f"Cross-section themes: {', '.join(narrative_ctx.get('cross_section_themes', []))}\n"
            f"Funder priorities:\n"
            + "\n".join(f"- {p}" for p in narrative_ctx.get("funder_priorities_to_emphasize", [])[:6])
        )

    if strategic_guidance or emphasis_direction:
        blocks.append(f"SECTION STRATEGY:\n{strategic_guidance}\n{emphasis_direction}")
    if opening_hook:
        blocks.append(f"OPENING HOOK (use in introduction):\n{opening_hook}")
    if strategic_framing:
        blocks.append(f"STRATEGIC FRAMING:\n{strategic_framing[:2000]}")
    if writing_instructions:
        blocks.append(f"SECTION WRITING GUIDE:\n{writing_instructions}")
    if compliance_guidance:
        blocks.append(f"COMPLIANCE NOTES:\n{compliance_guidance[:2000]}")

    if evidence_summary:
        blocks.append(f"RESEARCH EVIDENCE SUMMARY:\n{evidence_summary}")
    ke_block = _format_key_evidence(key_evidence)
    if ke_block:
        blocks.append(ke_block)

    if retrieved_sections:
        blocks.append("ARCHIVE CONTENT EXEMPLARS (mandatory — use ≥2 specific details):")
        for s in retrieved_sections[:5]:
            blocks.append(
                f"\n--- {s.get('grant_title', '?')} / {s.get('section_type', '?')} ({s.get('outcome', '?')}) ---\n"
                f"{s.get('full_text', '')[:4500]}"
            )

    if style_exemplars:
        blocks.append("STYLE EXEMPLARS:")
        for s in style_exemplars[:3]:
            blocks.append(f"--- {s.get('grant_title', '?')} ---\n{s.get('full_text', '')[:3000]}")

    if reusable_language:
        blocks.append("APPROVED REUSABLE LANGUAGE:")
        for b in reusable_language[:3]:
            blocks.append(f"{b.get('title', '?')}:\n{b.get('full_text', '')[:2000]}")

    if concept_bundles:
        blocks.append("ENTITY / PROGRAM CONTEXT (MOOVE, DISCO, named programs — use for specificity):")
        for b in concept_bundles[:6]:
            if b.get("full_text"):
                blocks.append(
                    f"--- {b.get('grant_title', '?')} ---\n{b.get('full_text', '')[:2500]}"
                )

    if citations:
        blocks.append(
            "CITATIONS TO USE:\n"
            + "\n".join(
                f"- {c.get('formatted_citation', c.get('title', ''))}"
                for c in citations[:10]
                if c.get("formatted_citation") or c.get("title")
            )
        )

    if prior_sections_summary:
        blocks.append(
            f"PRIOR SECTIONS (maintain continuity; reference by name where relevant):\n"
            f"{prior_sections_summary[:3500]}"
        )

    if intro_arc_str and agent_kind == "intro":
        blocks.append(f"6-BEAT INTRODUCTION ARC:\n{intro_arc_str}")

    if style_profile:
        blocks.append(f"STYLE PROFILE:\n{json.dumps(style_profile, indent=2)[:4000]}")

    if user_instructions:
        blocks.append(f"ADDITIONAL INSTRUCTIONS: {user_instructions}")

    blocks.append(
        "Return JSON: draft (HTML <p> paragraphs), word_count, sources_used, warnings, "
        "human_review_required, evaluation_criteria_addressed, citations_used"
    )

    system = ACADEMIC_SYSTEM_PROMPT
    if agent_kind == "methods":
        system += METHODS_SYSTEM_ADDENDUM
    elif agent_kind == "impact":
        system += IMPACT_SYSTEM_ADDENDUM
    elif agent_kind == "work_packages":
        system += WP_SYSTEM_ADDENDUM
    elif agent_kind == "intro":
        system += INTRO_SYSTEM_ADDENDUM

    return SectionDraftContext(
        user_prompt="\n\n".join(blocks),
        system_prompt=system,
        section_name=section_name,
        target_words=tw,
        min_words=mn,
    )


async def compress_prior_sections(sections_done: list[tuple[str, str]]) -> str:
    """Compress completed section drafts into a rolling narrative digest (~2.5k chars)."""
    if not sections_done:
        return ""
    if len(sections_done) == 1:
        name, text = sections_done[0]
        return f"{name}:\n{(text or '')[:2500]}"
    from app.ai.client import chat_complete

    raw = "\n\n".join(
        f"## {name}\n{(text or '')[:1200]}" for name, text in sections_done[-6:]
    )
    prompt = f"""Summarize these completed proposal sections for the next section author.
Keep: entity names (programs, acronyms), key claims made, methods stated, outcomes promised.
Max 2500 characters. Do not add new claims.

{raw[:12000]}

Return plain text summary only."""
    try:
        resp = await chat_complete(
            messages=[{"role": "user", "content": prompt}],
            agent_name="draft_narrative_digest",
            json_mode=False,
        )
        return (resp or "")[:2800]
    except Exception:
        return "\n".join(f"{n}: {(t or '')[:400]}" for n, t in sections_done[-4:])


def evidence_coverage_check(
    draft_text: str,
    must_surface_terms: list[str] | None,
    key_evidence: list | None,
    exemplar_count: int,
) -> dict:
    """Deterministic check of evidence grounding in drafted section."""
    text_lower = (draft_text or "").lower()
    issues: list[str] = []
    verify_count = draft_text.count("[VERIFY")
    citation_hints = draft_text.count("(") + draft_text.count("et al")

    for term in must_surface_terms or []:
        if term and term.lower() not in text_lower:
            issues.append(f"Required term '{term}' not found in draft.")

    if exemplar_count > 0 and not any(
        kw in text_lower for kw in ("archive", "prior grant", "awarded", "demonstrated", "shown in")
    ):
        if len(draft_text.split()) > 400:
            issues.append("Archive exemplars were retrieved but draft may not reference archive evidence.")

    if key_evidence and len(key_evidence) >= 3 and verify_count > len(key_evidence):
        issues.append("Many [VERIFY] flags — evidence may be underused.")

    return {
        "verify_count": verify_count,
        "exemplar_count": exemplar_count,
        "issues": issues,
        "passed": len(issues) == 0,
    }

"""
Unified context builder and academic writing standards for all section drafters.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field


ACADEMIC_SYSTEM_PROMPT = """You are a world-class academic grant proposal writer with 20+ years of experience
winning competitive research funding from NIH, NSF, Wellcome Trust, EU Horizon, Gates Foundation, and similar funders.

═══════════════════════════════════════════════════════════════
WRITING STANDARDS — NON-NEGOTIABLE
═══════════════════════════════════════════════════════════════

REGISTER & VOICE
- Formal, precise, third-person academic register throughout
- Match the funder's vocabulary — use terms from the call document exactly as written
- Preserve the team's voice and framing from the SKELETON CONTENT; do not replace with generic templates
- Vary sentence structure; avoid opening three consecutive sentences with the same word or structure

FORBIDDEN PHRASES (reviewers penalise these — never use them)
- "innovative", "cutting-edge", "world-class", "leverage", "synergy", "paradigm shift",
  "transformative", "novel approach", "state-of-the-art" (unless quoting the call verbatim),
  "unique opportunity", "significant contribution", "fills a gap"
- Instead: name the specific method, dataset, population, or result that IS innovative

EVIDENCE & CLAIMS
- Every quantitative or comparative claim MUST be followed by an inline citation: (Author, Year)
  or (Author et al., Year) or (Org/Report, Year)
- If you use a statistic from ARCHIVE EXEMPLARS or KEY EVIDENCE, cite the source inline
- If you cannot find a citation, write [VERIFY: <specific claim needing source>] — do NOT invent numbers
- Do not invent partners, IRB approval numbers, sample sizes, preliminary result percentages,
  dataset sizes, or budget figures unless they appear in SKELETON CONTENT or KEY EVIDENCE

INLINE CITATION FORMAT
- Academic papers: (Smith et al., 2022) or (Smith & Jones, 2019)
- Reports/grey literature: (WHO, 2023) or (World Bank, 2021)
- Funder reports: (Wellcome Trust, 2022)
- Multiple sources: (Smith, 2020; Jones, 2021)
- Embed citations immediately after the claim, before the period: "...shown to reduce mortality by 34% (Doe et al., 2023)."
- Collect ALL citations you use and list them in the "citations_used" JSON field

ARCHIVE EXEMPLAR USAGE (mandatory when provided)
- When ARCHIVE EXEMPLARS are provided, you MUST incorporate at least 3 specific details from them:
  named methods, quantified outcomes, evaluation frameworks, institutional partners, or exact phrasing
- Do not summarise exemplars generically — extract the precise detail that strengthens this section
- If an exemplar is from an awarded grant, prioritise its framing and evidence patterns

PARAGRAPH STRUCTURE
- Each paragraph: topic sentence → evidence (with citation) → implication for this grant's evaluation criteria
- Never begin a paragraph with "This section will..." or "In this section..."
- No orphan bullets — every list item needs a sentence of explanation after it
- Use subheadings only when the call explicitly asks for them or when section exceeds 800 words

WORD COUNT COMPLIANCE
- You MUST hit the word target within ±5% — this is a hard requirement
- If you are running short: add a paragraph of evidence, deepen the methodology, or expand implications
- If you are running over: cut adverbs, collapse redundant sentences, not content
- Do NOT pad with summaries of what the section just said

COMPLETENESS
- Address EVERY key ask listed in CALL REQUIREMENTS FOR THIS SECTION — check each one explicitly
- If a question is not answered in the skeleton, answer it from the evidence provided
- Do not leave any section requirement unaddressed

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════════════

Return valid JSON with these fields:
{
  "draft": "Full HTML using <p>, <h3>, <ul><li>, <table> tags — NO markdown",
  "word_count": <integer>,
  "citations_used": ["Author et al. (Year). Title. Journal/Source. DOI/URL", ...],
  "citation_markers": [{"marker": "(Smith, 2023)", "full_citation": "Smith, J. et al. (2023)..."}],
  "sources_used": ["brief source titles"],
  "warnings": ["any issues the human reviewer should check"],
  "human_review_required": true/false,
  "evaluation_criteria_addressed": ["list each criterion addressed"],
  "key_asks_addressed": ["list each call key ask addressed"],
  "gaps_identified": ["things missing that human reviewer should add"]
}"""


METHODS_SYSTEM_ADDENDUM = """

═══════════════════════════════════════════════════════════════
SECTION TYPE: METHODOLOGY / APPROACH
═══════════════════════════════════════════════════════════════

Structure (use subheadings where appropriate):
1. STUDY DESIGN — name the design (RCT, cohort, mixed-methods, etc.) and justify why it's optimal
2. SETTING & POPULATION — specific sites, eligibility criteria, recruitment strategy, sample size with power calculation
3. INTERVENTION / TECHNICAL APPROACH — detailed description; name all methods, tools, frameworks, software
4. DATA COLLECTION & MEASURES — instruments, outcomes (primary/secondary), timepoints, data quality
5. ANALYSIS PLAN — statistical methods named specifically (e.g. "mixed-effects logistic regression in R 4.3"),
   handling of missing data, subgroup analyses
6. ETHICAL CONSIDERATIONS — IRB/ethics board, consent process, data protection, equity considerations
7. FEASIBILITY & LIMITATIONS — honest acknowledgment; mitigation strategies
8. TEAM CAPABILITY — who leads each component (by role, not name unless in skeleton)

Citation requirements: name specific published validation studies for every tool or instrument used.
Use HTML tables for timelines, outcome measures tables, or work package schedules if helpful."""


IMPACT_SYSTEM_ADDENDUM = """

═══════════════════════════════════════════════════════════════
SECTION TYPE: IMPACT / DISSEMINATION / SUSTAINABILITY
═══════════════════════════════════════════════════════════════

Required elements (must cover all):
1. THEORY OF CHANGE — if A then B then C; make the causal chain explicit with evidence at each step
2. DIRECT BENEFICIARIES — numbers, demographics, geography; cite baseline data
3. PATHWAY TO SCALE — concrete mechanisms (policy adoption, partnerships, open-source release, spin-out)
4. SUSTAINABILITY BEYOND GRANT PERIOD — funding model, institutional embedding, earned revenue, open infrastructure
5. DISSEMINATION PLAN — target journals (named), conferences (named), policy briefs, media strategy
6. INDICATORS & MEASUREMENT — specific KPIs, data sources, evaluation timeline
7. EQUITY & INCLUSION — how underserved populations are centred, not just mentioned
8. FUNDER PRIORITY ALIGNMENT — map each deliverable to the funder's stated strategic objectives

Avoid: vague statements like "results will be disseminated widely" — name the journal, the conference,
the policy forum, the open-access repository."""


WP_SYSTEM_ADDENDUM = """

═══════════════════════════════════════════════════════════════
SECTION TYPE: WORK PACKAGES / AIMS / OBJECTIVES
═══════════════════════════════════════════════════════════════

For each Work Package / Aim:
- WP number and title
- Objective (one sentence, measurable)
- Lead team member / role
- Tasks (numbered, verb-led, specific)
- Deliverables (tangible outputs with format and audience)
- Milestones (with month numbers, e.g. M12, M24)
- Dependencies on other WPs (explicit cross-references)
- Risk and mitigation (one sentence per major risk)

Use HTML tables for: milestone overview, deliverables list, responsibility matrix (RACI).
Gantt-style timelines: represent as a table with tasks as rows, months/quarters as columns.
All deliverables must be specific (e.g. "peer-reviewed publication in implementation science journal",
not "publication")."""


INTRO_SYSTEM_ADDENDUM = """

═══════════════════════════════════════════════════════════════
SECTION TYPE: INTRODUCTION / BACKGROUND / RATIONALE
═══════════════════════════════════════════════════════════════

Follow the 6-beat narrative arc STRICTLY — each beat is a paragraph:

Beat 1 — BROAD SIGNIFICANCE: Open with the global scale of the problem using a striking statistic
  (cite it). Frame why this matters to society and to the funder's priorities.

Beat 2 — CURRENT CONTEXT: What is the state of the field? What approaches exist?
  Cite 3–5 key papers. Be specific about methods and outcomes, not just existence.

Beat 3 — THE GAP / UNMET NEED: Where does current knowledge or practice fall short?
  Be precise — "existing approaches fail to account for X in populations Y"
  This is the tension that your proposal resolves.

Beat 4 — YOUR SOLUTION / APPROACH: Introduce the team's approach — 2–3 sentences max here.
  Name the specific method, tool, or framework. Do not over-explain (save for Methods).
  Connect directly to the gap in Beat 3.

Beat 5 — PRELIMINARY EVIDENCE / FEASIBILITY: What evidence shows this approach can work?
  Cite prior work (published papers, pilot data, platform capabilities, team track record).
  Quantify wherever possible.

Beat 6 — THIS PROPOSAL: What will this grant do? End with a crisp statement of objectives
  that maps to the call's evaluation criteria. Optional: closing sentence on transformative potential
  (be specific about the transformation, not generic).

Do NOT: use a generic opening like "X is a major public health problem."
Instead: open with a specific, striking fact that creates emotional urgency."""


BACKGROUND_SYSTEM_ADDENDUM = """

═══════════════════════════════════════════════════════════════
SECTION TYPE: BACKGROUND / LITERATURE REVIEW / STATE OF THE ART
═══════════════════════════════════════════════════════════════

Structure:
1. CURRENT STATE — what the field currently knows and can do; cite landmark papers
2. KEY DEBATES OR OPEN QUESTIONS — where experts disagree; name the positions
3. RELEVANT PRIOR WORK — include the team's own relevant publications if in skeleton
4. CRITICAL GAP — the specific absence or limitation that this project addresses
5. POSITIONING — how this proposal's approach is distinct from existing work

Citation density: aim for 1–2 citations per paragraph — this section should be evidence-dense.
Avoid: textbook-level background that any expert already knows.
Focus: on the specific literature directly relevant to the proposal's approach."""


SIGNIFICANCE_SYSTEM_ADDENDUM = """

═══════════════════════════════════════════════════════════════
SECTION TYPE: SIGNIFICANCE / INNOVATION / IMPORTANCE
═══════════════════════════════════════════════════════════════

Required elements:
1. PROBLEM MAGNITUDE — scale, burden, cost; always cite; be global AND local where relevant
2. WHY NOW — what has changed that makes this solvable/timely (technology, policy window, data availability)
3. NOVELTY — specific claims about what is genuinely new (not just "first in the field")
   For each novelty claim: explain WHY previous approaches didn't do this and HOW yours is different
4. SCIENTIFIC MERIT — what new knowledge will this generate (beyond the practical outcome)?
5. REVIEWER TEST — explicitly address each "Significance" criterion in the funder's rubric"""


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
    lines = [
        "KEY EVIDENCE — USE IN PROSE (cite inline as (Author, Year); mark [VERIFY: claim] if uncertain):"
    ]
    for item in key_evidence[:15]:
        if isinstance(item, dict):
            claim = item.get("claim") or item.get("text") or ""
            src = item.get("source_title") or item.get("source") or ""
            url = item.get("source_url") or item.get("url") or ""
            fmt = item.get("formatted_citation") or ""
            if claim:
                citation_str = fmt or src
                if url and not fmt:
                    citation_str += f" ({url})" if citation_str else url
                lines.append(f"• {claim}" + (f"  ← [{citation_str}]" if citation_str else ""))
        elif isinstance(item, str):
            lines.append(f"• {item}")
    return "\n".join(lines)


def _format_citations_block(citations: list | None) -> str:
    if not citations:
        return ""
    lines = [
        "CITATIONS AVAILABLE — EMBED THESE INLINE using (Author, Year) format:",
        "(Include in citation_markers and citations_used in your JSON output)",
    ]
    for c in citations[:15]:
        if isinstance(c, dict):
            fmt = c.get("formatted_citation") or c.get("title") or ""
            url = c.get("url") or ""
            source_type = c.get("source_type") or ""
            if fmt:
                tag = f" [{source_type}]" if source_type else ""
                lines.append(f"• {fmt}{tag}" + (f"  {url}" if url else ""))
        elif isinstance(c, str) and c.strip():
            lines.append(f"• {c}")
    return "\n".join(lines)


def _format_section_requirements(sec_req: dict | None) -> str:
    if not sec_req or not isinstance(sec_req, dict):
        return ""
    parts = []
    if sec_req.get("requirements"):
        parts.append(f"SECTION PURPOSE (from call): {sec_req['requirements']}")
    if sec_req.get("direct_quote"):
        parts.append(f'EXACT CALL LANGUAGE: "{sec_req["direct_quote"]}"')
    for label, key in [
        ("KEY ASKS — MUST ADDRESS EACH EXPLICITLY", "key_asks"),
        ("QUESTIONS THE REVIEWER WILL ASK", "questions_to_address"),
        ("EVIDENCE THE REVIEWER EXPECTS TO SEE", "evidence_needed"),
    ]:
        items = sec_req.get(key) or []
        if items:
            parts.append(f"{label}:\n" + "\n".join(f"  → {x}" for x in items[:10]))
    if sec_req.get("word_limit"):
        parts.append(f"WORD LIMIT FOR THIS SECTION: {sec_req['word_limit']} words (hard limit)")
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
    refinement_feedback: str = "",
) -> SectionDraftContext:
    """Build unified user/system prompts for any section drafter."""
    sec_req = section_specific_requirements or {}
    tw = target_words or sec_req.get("word_limit")
    mn = min_words or (int(tw * 0.9) if tw else None)

    blocks: list[str] = []

    # ── Header ─────────────────────────────────────────────────────────────────
    header = f"Write the complete **{section_name}** section for a competitive grant proposal."
    if funder:
        header += f"\nFunder: {funder}"
    if section_type and section_type != "other":
        header += f"\nSection type: {section_type}"
    blocks.append(header)

    if tw:
        blocks.append(
            f"WORD TARGET: {mn or int(tw * 0.9)}–{tw} words\n"
            f"  → You MUST reach at least {mn or int(tw * 0.9)} words. This is a hard minimum.\n"
            f"  → Do not exceed {int(tw * 1.05)} words.\n"
            f"  → After writing, count your words and adjust before submitting."
        )

    # ── Refinement pass ─────────────────────────────────────────────────────────
    if refinement_feedback:
        blocks.append(
            f"⚠️  REFINEMENT PASS — FIX THESE ISSUES FROM THE PREVIOUS DRAFT:\n{refinement_feedback}\n"
            f"Do NOT simply repeat the previous draft. Address every issue listed above."
        )

    # ── Grant idea + skeleton ──────────────────────────────────────────────────
    if grant_idea:
        blocks.append(f"GRANT IDEA (team's vision — preserve and expand this framing):\n{grant_idea[:6000]}")
    if skeleton_content:
        blocks.append(
            f"SKELETON CONTENT (team-authored — EXPAND THIS, preserve voice, claims, and terminology):\n"
            f"{skeleton_content[:10000]}"
        )

    # ── Call requirements ──────────────────────────────────────────────────────
    sec_req_block = _format_section_requirements(sec_req)
    if sec_req_block:
        blocks.append(f"CALL REQUIREMENTS FOR THIS SECTION:\n{sec_req_block}")

    if call_narrative_brief:
        blocks.append(f"CALL NARRATIVE BRIEF (overall opportunity summary):\n{call_narrative_brief[:6000]}")
    elif call_requirements:
        blocks.append(f"CALL REQUIREMENTS (extract the requirements relevant to this section):\n{call_requirements[:5000]}")

    if evaluation_criteria:
        blocks.append(
            "EVALUATION CRITERIA (address each of these in your draft — reference them by name):\n"
            + "\n".join(f"  [{i+1}] {c}" for i, c in enumerate(evaluation_criteria[:12]))
        )

    # ── Strategic context ──────────────────────────────────────────────────────
    narrative_ctx = narrative_context or {}
    if narrative_ctx.get("theory_of_change") or narrative_ctx.get("funder_priorities_to_emphasize"):
        toc = narrative_ctx.get("theory_of_change", "")
        themes = ", ".join(narrative_ctx.get("cross_section_themes", []))
        priorities = narrative_ctx.get("funder_priorities_to_emphasize", [])
        blocks.append(
            "NARRATIVE CONTEXT (maintain consistency with these threads across the proposal):\n"
            + (f"Theory of change: {toc}\n" if toc else "")
            + (f"Cross-section themes: {themes}\n" if themes else "")
            + ("Funder priorities to emphasise:\n" + "\n".join(f"  • {p}" for p in priorities[:8]) if priorities else "")
        )

    if strategic_guidance or emphasis_direction:
        blocks.append(
            "SECTION STRATEGY:\n"
            + (f"{strategic_guidance}\n" if strategic_guidance else "")
            + (f"Emphasis direction: {emphasis_direction}" if emphasis_direction else "")
        )
    if opening_hook:
        blocks.append(f"OPENING HOOK (use for introduction beat 1):\n{opening_hook}")
    if strategic_framing:
        blocks.append(f"STRATEGIC FRAMING:\n{strategic_framing[:3000]}")
    if writing_instructions:
        blocks.append(f"SECTION WRITING GUIDE (follow these instructions closely):\n{writing_instructions}")
    if compliance_guidance:
        blocks.append(f"COMPLIANCE NOTES (must satisfy these):\n{compliance_guidance[:3000]}")

    # ── Evidence ───────────────────────────────────────────────────────────────
    if evidence_summary:
        blocks.append(f"RESEARCH EVIDENCE SUMMARY:\n{evidence_summary}")

    ke_block = _format_key_evidence(key_evidence)
    if ke_block:
        blocks.append(ke_block)

    # ── Archive exemplars ──────────────────────────────────────────────────────
    if retrieved_sections:
        blocks.append(
            "ARCHIVE CONTENT EXEMPLARS — incorporate ≥3 specific details (methods, outcomes, phrasing) from these:"
        )
        for i, s in enumerate(retrieved_sections[:8]):
            outcome = s.get("outcome") or "?"
            grant_title = s.get("grant_title") or "?"
            section_t = s.get("section_type") or "?"
            funder_s = s.get("funder") or ""
            text = s.get("full_text") or s.get("text_snippet") or ""
            blocks.append(
                f"\n─── Exemplar {i+1}: '{grant_title}' | {section_t} | {funder_s} | outcome: {outcome} ───\n"
                f"{text[:6000]}"
            )

    if style_exemplars:
        blocks.append("STYLE EXEMPLARS (match tone, sentence rhythm, and register):")
        for i, s in enumerate(style_exemplars[:5]):
            text = s.get("full_text") or s.get("text_snippet") or ""
            blocks.append(
                f"─── Style {i+1}: '{s.get('grant_title', '?')}' ───\n{text[:3500]}"
            )

    if reusable_language:
        blocks.append("APPROVED REUSABLE LANGUAGE (may use verbatim or adapt):")
        for b in reusable_language[:5]:
            text = b.get("full_text") or b.get("text_snippet") or ""
            blocks.append(f"{b.get('title', '?')}:\n{text[:2500]}")

    if concept_bundles:
        blocks.append(
            "ENTITY / PROGRAM CONTEXT (use these named details for specificity — named programs, datasets, platforms):"
        )
        for b in concept_bundles[:8]:
            if b.get("full_text") or b.get("text_snippet"):
                text = b.get("full_text") or b.get("text_snippet") or ""
                blocks.append(
                    f"─── {b.get('grant_title', '?')} ───\n{text[:3000]}"
                )

    # ── Citations ──────────────────────────────────────────────────────────────
    cit_block = _format_citations_block(citations)
    if cit_block:
        blocks.append(cit_block)

    # ── Prior sections digest ──────────────────────────────────────────────────
    if prior_sections_summary:
        blocks.append(
            "PRIOR SECTIONS WRITTEN (maintain continuity — reference by name, do not repeat):\n"
            f"{prior_sections_summary[:4500]}"
        )

    # ── Intro arc ──────────────────────────────────────────────────────────────
    if intro_arc_str and agent_kind == "intro":
        blocks.append(f"6-BEAT INTRODUCTION ARC (follow this structure exactly):\n{intro_arc_str}")

    # ── Style profile ──────────────────────────────────────────────────────────
    if style_profile:
        sp_str = json.dumps(style_profile, indent=2)[:5000]
        blocks.append(
            f"STYLE PROFILE (match voice, terminology, and tone from the organisation's past grants):\n{sp_str}"
        )

    if user_instructions:
        blocks.append(f"ADDITIONAL INSTRUCTIONS (high priority — follow these):\n{user_instructions}")

    # ── Output instruction ─────────────────────────────────────────────────────
    blocks.append(
        "Return JSON with these exact fields:\n"
        "  draft               — full section in HTML (<p>, <h3>, <ul><li>, <table> only; NO markdown)\n"
        "  word_count          — integer word count of draft\n"
        "  citations_used      — list of full APA citations for every source cited inline\n"
        "  citation_markers    — list of {\"marker\": \"(Smith, 2023)\", \"full_citation\": \"Smith, J...\"}\n"
        "  sources_used        — brief list of source titles/names used\n"
        "  warnings            — list of issues for human reviewer\n"
        "  human_review_required — true if any claim needs verification\n"
        "  evaluation_criteria_addressed — list of criteria you addressed\n"
        "  key_asks_addressed  — list of call key asks you addressed\n"
        "  gaps_identified     — things missing that the human reviewer should add"
    )

    # ── System prompt assembly ─────────────────────────────────────────────────
    system = ACADEMIC_SYSTEM_PROMPT
    stype_lower = (section_type or "").lower()
    atype_lower = (agent_kind or "").lower()

    if atype_lower == "methods" or any(k in stype_lower for k in ("method", "approach", "technical", "protocol")):
        system += METHODS_SYSTEM_ADDENDUM
    elif atype_lower == "impact" or any(k in stype_lower for k in ("impact", "dissemination", "sustainability", "outreach")):
        system += IMPACT_SYSTEM_ADDENDUM
    elif atype_lower in ("work_packages", "work_package") or any(k in stype_lower for k in ("work_package", "aim", "objective", "deliverable")):
        system += WP_SYSTEM_ADDENDUM
    elif atype_lower == "intro" or any(k in stype_lower for k in ("intro", "background", "rationale", "motivation")):
        if any(k in stype_lower for k in ("background", "literature", "state of the art", "related")):
            system += BACKGROUND_SYSTEM_ADDENDUM
        else:
            system += INTRO_SYSTEM_ADDENDUM
    elif any(k in stype_lower for k in ("significance", "innovation", "importance", "novelty")):
        system += SIGNIFICANCE_SYSTEM_ADDENDUM

    return SectionDraftContext(
        user_prompt="\n\n".join(blocks),
        system_prompt=system,
        section_name=section_name,
        target_words=tw,
        min_words=mn,
    )


async def compress_prior_sections(sections_done: list[tuple[str, str]]) -> str:
    """Compress completed section drafts into a rolling narrative digest (~3k chars)."""
    if not sections_done:
        return ""
    if len(sections_done) == 1:
        name, text = sections_done[0]
        return f"{name}:\n{(text or '')[:3000]}"
    from app.ai.client import chat_complete

    raw = "\n\n".join(
        f"## {name}\n{(text or '')[:1500]}" for name, text in sections_done[-6:]
    )
    prompt = f"""Summarise these completed proposal sections into a narrative digest for the next section author.

KEEP:
- All named entities (programs, datasets, tools, acronyms — spell them out on first use)
- All quantitative claims and their sources
- Key methods and approaches stated
- All promises or commitments made (partners, deliverables, outcomes)
- The theory of change as articulated

DO NOT:
- Add new claims
- Generalise specific details
- Exceed 3000 characters

SECTIONS:
{raw[:14000]}

Return plain text summary only (no headings, no bullets — prose digest)."""
    try:
        resp = await chat_complete(
            messages=[{"role": "user", "content": prompt}],
            agent_name="draft_narrative_digest",
            json_mode=False,
        )
        return (resp or "")[:3200]
    except Exception:
        return "\n".join(f"{n}: {(t or '')[:500]}" for n, t in sections_done[-4:])


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

    # Inline citation presence check — look for (Author, Year) pattern
    import re
    citation_pattern = re.compile(r'\([A-Z][a-zA-Z]+(?:\s+et\s+al\.)?,\s+\d{4}\)')
    inline_citations = citation_pattern.findall(draft_text)
    inline_citation_count = len(inline_citations)

    # Flag sections that are long but have zero citations
    word_count = len(draft_text.split())
    if word_count > 300 and inline_citation_count == 0 and verify_count == 0:
        issues.append("No inline citations found — section needs evidence grounding with (Author, Year) markers.")

    for term in must_surface_terms or []:
        if term and term.lower() not in text_lower:
            issues.append(f"Required term '{term}' not found in draft.")

    if exemplar_count > 0 and word_count > 400:
        # Check for any indication archive content was used
        archive_signals = [
            "archive", "prior grant", "awarded", "demonstrated", "shown in",
            "previous work", "our team", "we have", "pilot", "preliminary"
        ]
        if not any(sig in text_lower for sig in archive_signals):
            issues.append("Archive exemplars were retrieved but draft shows no evidence of using them.")

    excessive_verify = verify_count > max(3, len(key_evidence or []) // 2)
    if excessive_verify:
        issues.append(
            f"{verify_count} [VERIFY] flags found — too many unsupported claims. "
            "Drafter should use provided evidence or cite real sources."
        )

    return {
        "verify_count": verify_count,
        "inline_citation_count": inline_citation_count,
        "exemplar_count": exemplar_count,
        "issues": issues,
        "passed": len(issues) == 0,
    }


def build_refinement_feedback(coverage_result: dict, section_name: str) -> str:
    """Build targeted feedback string for a re-draft pass."""
    issues = coverage_result.get("issues") or []
    if not issues:
        return ""
    lines = [f"The previous draft of '{section_name}' has these issues that MUST be fixed:"]
    for issue in issues:
        lines.append(f"  • {issue}")
    lines.append("")
    if coverage_result.get("inline_citation_count", 0) == 0:
        lines.append(
            "PRIORITY: Add inline citations using (Author, Year) format after every factual claim. "
            "Use the citations provided in CITATIONS AVAILABLE."
        )
    if coverage_result.get("verify_count", 0) > 3:
        lines.append(
            "PRIORITY: Replace [VERIFY] placeholders with actual citations from the provided evidence. "
            "Only use [VERIFY] for claims you genuinely cannot source from the provided material."
        )
    return "\n".join(lines)

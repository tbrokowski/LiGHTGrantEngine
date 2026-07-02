"""
Agent 4: Proposal Architect
Generates a skeleton draft as a single raw text document grounded in the grant idea and the
team's narrative priorities. Section titles use ## headings. The user edits the document
directly before generating the full draft.
"""
import json
from app.ai.client import chat_complete

SYSTEM_PROMPT = """You are a senior grant proposal writer generating a working skeleton for a competitive proposal.

A skeleton is NOT a template and NOT a list of meta-labels. It is ACTUAL CONTENT in bullet-point form:
- Real arguments and claims drawn directly from the team's grant idea
- Specific methods, technologies, and approaches mentioned in the idea
- Concrete evidence points and metrics where known
- The exact framing and terminology the team will use

Section format — use this ONLY:
## Section Name

- [Real, specific claim from the team's proposal — use their technology names, methods, target populations, outcomes]
- [Another concrete point about what the team will actually do, demonstrate, or argue]
- [Evidence or data point — either from the idea, archive, or a specific type of data needed]
- [Additional claim addressing a key evaluation criterion]
[TBD: describe what specific information is missing — e.g. "pilot dataset size from MOOVE team"]
(Target: N words)

Rules — follow these strictly:
0. SECTION LIMITS in SECTION STRUCTURE AND LIMITS are LOCKED. Each section's (Target: N words) must match the word limit given. Size bullets for the full target (roughly target_words/120 bullets at ~120 words each for long sections). Do NOT invent document totals or per-section limits in JSON — copy from SECTION STRUCTURE AND LIMITS exactly. Sections marked as idea-derived in SECTION STRUCTURE AND LIMITS are real sections the writer must draft — do not fold them back into a generic section.
1. Every bullet must be SPECIFIC and SUBSTANTIVE — use the team's own terminology, name specific technologies/platforms/methods, reference actual target populations, specific disease areas, specific geographies from their idea
2. Never write a generic bullet like "We will demonstrate the effectiveness of our approach" — instead write "We will demonstrate X% improvement in [specific metric] for [specific disease] in [specific setting] using [specific method]"
3. Draw directly from the GRANT IDEA — if they mention MOOVE, write about MOOVE; if they mention SSA, write about SSA; if they mention AI/ML, name the specific technique
4. Call requirements determine SECTION STRUCTURE and TOPICS TO COVER, not the bullet content
5. When PER-SECTION EVIDENCE BUNDLES are provided for a section, at least 2 of its bullets must be grounded in that evidence — quote or paraphrase the specific stat, method, or outcome and tag the bullet with its source in parentheses at the end: "(Archive: <grant title>)" for prior awarded grants, "(Web: <source name>)" for web/news findings, or "(Academic: <author/year>)" for academic citations. Never write a bare, untagged bullet when matching evidence was provided for that claim.
6. [TBD: reason] only for genuine unknowns (specific numbers, named partners, etc.) — not for strategic content
7. No meta-labels like "Purpose:", "Key arguments:", "Evidence to include:" — only bullets and [TBD] markers
8. If you cannot be specific, write [TBD: specific information needed] rather than a vague bullet

Respond with valid JSON."""

async def generate_proposal_outline(
    opportunity_title: str,
    call_analysis: dict,
    similar_grants: list[dict] = None,
    structure_templates: list[dict] = None,
    team_preferences: str = "",
    internal_deadline: str = "",
    external_deadline: str = "",
    grant_idea: str = "",
    aligned_framing: str | None = None,
    style_profile: dict | None = None,
    call_requirements_text: str = "",
    call_strategy: dict | None = None,
    aligned_concept: dict | None = None,
    section_constraints: list[dict] | None = None,
    total_word_limit: int | None = None,
    total_page_limit: str | None = None,
    call_intelligence: dict | None = None,
    section_evidence_bundles: dict[str, dict] | None = None,
) -> dict:
    structure_str = _format_structure_templates(structure_templates or [])
    similar_str = _format_similar_grants(similar_grants or [])
    style_str = _format_style_profile(style_profile or {})
    style_section = f'STYLE PROFILE:\n{style_str}' if style_str else ''
    team_pref_section = f'TEAM PREFERENCES: {team_preferences}' if team_preferences else ''

    # Build enriched strategy sections when available
    strategy_section = _format_call_strategy(call_strategy) if call_strategy else ''
    alignment_section = _format_aligned_concept(aligned_concept) if aligned_concept else ''

    # Build call_intelligence guidance section
    intelligence_section = _format_call_intelligence(call_intelligence) if call_intelligence else ''

    # Build section structure block from constraints
    constraints_section = _format_section_constraints(
        section_constraints, total_word_limit, total_page_limit
    )

    # Format per-section evidence bundles
    evidence_section = _format_section_evidence_bundles(section_evidence_bundles) if section_evidence_bundles else ''

    # Expand CALL ANALYSIS block with full context
    narrative_brief = call_analysis.get("narrative_brief", "")
    thematic_areas = call_analysis.get("thematic_areas") or []
    strategic_objectives = call_analysis.get("strategic_objectives") or []

    # Build idea block: full idea + aligned framing as a lens
    idea_block = _format_idea_block(grant_idea, aligned_framing)

    user_prompt = f"""Think step by step before writing:
1. Extract the core specific elements from GRANT IDEA: technology/platform, problem, target population/geography, specific methods, outcomes, metrics.
2. For each section, identify which specific elements from the idea are most relevant and pull the EXACT terminology, names, and numbers the team uses.
3. Write 5-8 specific bullet points per section. Each bullet must be grounded in the idea AND augmented by the SECTION EVIDENCE where available.
4. For each bullet that uses a statistic, finding, or method from the SECTION EVIDENCE, note the source briefly (e.g. "per [web source]" or "as shown in archive grant").
5. Use [TBD: reason] only for genuinely unknown specifics that are not in the idea or evidence.
Then produce the full JSON response.

IMPORTANT: Every bullet must use specific details from the GRANT IDEA. Generic bullets that could apply to any proposal will be rejected. If SECTION EVIDENCE is provided for a section, you MUST draw at least 2 bullets from that evidence.

---

GRANT: {opportunity_title}
EXTERNAL DEADLINE: {external_deadline or 'Not specified'}
INTERNAL DEADLINE: {internal_deadline or 'Not specified'}

{idea_block}

CALL REQUIREMENTS:
{call_requirements_text or 'Not provided — use call_analysis fields below'}

CALL ANALYSIS (coverage guidance — AI-extracted, use as reference):
Narrative brief: {narrative_brief[:600] if narrative_brief else 'Not available'}
Thematic areas: {thematic_areas[:6]}
Strategic objectives: {strategic_objectives[:5]}
Required sections: {call_analysis.get('required_sections', [])}
Evaluation criteria: {call_analysis.get('evaluation_criteria', [])}
Budget constraints: {call_analysis.get('budget_constraints', '')}

{constraints_section}{intelligence_section}{strategy_section}
{alignment_section}
{evidence_section}
{structure_str}

{similar_str}

{style_section}
{team_pref_section}

---

Produce a JSON object with the following fields:

- raw_text: a single string containing the full skeleton. Use ## Section Name headings (use exact
  section names from SECTION STRUCTURE AND LIMITS if provided). Under each heading write:
    - [specific bullet drawn from the team's idea — include actual names, methods, populations]
    - [specific bullet augmented by evidence — cite briefly if from evidence bundle]
    - ... (5-8 bullets per section, all grounded in the grant idea and evidence)
    [TBD: description] — only if genuinely unknown
    (Target: N words)
  Sections separated by a blank line. No meta-labels (no "Purpose:", "Key arguments:", etc.).
- sections: list of objects, one per section in the skeleton, in order:
    {{"name": str, "word_limit": int|null, "page_limit": str|null, "priority": "high"|"medium"|"low", "order": int}}
  Copy word_limit and page_limit EXACTLY from SECTION STRUCTURE AND LIMITS — do not guess.
- total_word_limit: int|null — copy from SECTION STRUCTURE AND LIMITS only
- total_page_limit: str|null — copy from SECTION STRUCTURE AND LIMITS only
- title_suggestion: a compelling, specific title for the proposal
- narrative_arc: one sentence describing the through-line from problem to solution
- key_messages: list of 3–5 core messages reviewers should take away
- document_checklist: list of required attachments/appendices
- compliance_checklist: list of hard compliance requirements (from call)
- internal_timeline: list of key internal milestones with suggested dates
- warnings: list of risks or concerns about this proposal's competitiveness
- flagged_sections: [] (empty list — the user will flag priority sections in the editor)

Return valid JSON only."""

    response = await chat_complete(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        agent_name="proposal_architect",
        json_mode=True,
    )
    try:
        result = json.loads(response)
    except json.JSONDecodeError:
        return {"error": "Outline generation failed", "raw": response}

    # Ensure sections is always a list — fallback to parsing raw_text headings
    if not result.get("sections"):
        result["sections"] = _extract_sections_from_raw_text(
            result.get("raw_text", ""),
            section_constraints or [],
        )

    # Defensive dedup: the model occasionally repeats a heading verbatim in
    # raw_text (or emits the same section twice in its JSON "sections" array) —
    # keep the first occurrence only, by exact lowercase name match.
    deduped: list[dict] = []
    seen_names: set[str] = set()
    for sec in result.get("sections") or []:
        name_key = (sec.get("name") or "").strip().lower()
        if not name_key or name_key in seen_names:
            continue
        seen_names.add(name_key)
        deduped.append(sec)
    result["sections"] = deduped

    # Carry forward document-level limits if not returned by model
    if total_word_limit and not result.get("total_word_limit"):
        result["total_word_limit"] = total_word_limit
    if total_page_limit and not result.get("total_page_limit"):
        result["total_page_limit"] = total_page_limit

    # Enforce per-section limits from authoritative constraints (not model guesses)
    if section_constraints:
        limits_by_name = {
            sc["name"]: sc for sc in section_constraints if sc.get("name")
        }
        for sec in result.get("sections") or []:
            name = sec.get("name")
            if name and name in limits_by_name:
                src = limits_by_name[name]
                if src.get("word_limit"):
                    sec["word_limit"] = src["word_limit"]
                if src.get("page_limit"):
                    sec["page_limit"] = src["page_limit"]
                if src.get("priority"):
                    sec["priority"] = src["priority"]

    return result


def _format_section_constraints(
    section_constraints: list[dict] | None,
    total_word_limit: int | None,
    total_page_limit: str | None,
) -> str:
    """Format the section structure and limits block for the architect prompt."""
    if not section_constraints and not total_word_limit and not total_page_limit:
        return ""
    lines = ["SECTION STRUCTURE AND LIMITS (authoritative — use these section names exactly):"]
    if total_word_limit:
        lines.append(f"Total document word limit: {total_word_limit:,} words")
    if total_page_limit:
        lines.append(f"Total document page limit: {total_page_limit}")
    if section_constraints:
        lines.append("")
        for sc in sorted(section_constraints, key=lambda x: x.get("order", 99)):
            name = sc.get("name", "Unnamed")
            wl = sc.get("word_limit")
            pl = sc.get("page_limit")
            pri = sc.get("priority", "medium")
            tag = " [idea-derived — not in the call template]" if sc.get("idea_derived") else ""
            parts = [f"  {sc.get('order', '?')}. {name} [{pri}]{tag}"]
            if wl:
                parts.append(f"{wl:,} words")
            if pl:
                parts.append(f"{pl} pages")
            lines.append(" — ".join(parts) if len(parts) > 1 else parts[0])
            if sc.get("rationale"):
                lines.append(f"     Why this section: {sc['rationale'][:200]}")
    return "\n".join(lines) + "\n\n"


def _extract_sections_from_raw_text(
    raw_text: str,
    section_constraints: list[dict],
) -> list[dict]:
    """Parse ## headings from raw_text and merge with any known constraints."""
    import re
    constraints_by_name = {
        sc["name"].lower(): sc for sc in section_constraints if sc.get("name")
    }
    sections = []
    headings = re.findall(r"^##\s+(.+)$", raw_text, re.MULTILINE)
    for i, heading in enumerate(headings):
        matched = constraints_by_name.get(heading.strip().lower(), {})
        sections.append({
            "name": heading.strip(),
            "word_limit": matched.get("word_limit"),
            "page_limit": matched.get("page_limit"),
            "priority": matched.get("priority", "medium"),
            "order": i + 1,
        })
    return sections


def _format_style_profile(profile: dict) -> str:
    if not profile:
        return ""
    lines = []
    for key, val in profile.items():
        if key in ("archive_style_sources",):
            continue
        if isinstance(val, list):
            lines.append(f"{key.replace('_', ' ').title()}: {', '.join(str(v) for v in val[:5])}")
        elif isinstance(val, str) and val:
            lines.append(f"{key.replace('_', ' ').title()}: {val}")
    return "\n".join(lines)


def _format_structure_templates(templates: list[dict]) -> str:
    if not templates:
        return ""
    lines = ["ARCHIVE STRUCTURES (section order and word counts from awarded grants):"]
    for tmpl in templates[:3]:
        lines.append(f"\n--- {tmpl.get('grant_title', '?')} ({tmpl.get('funder', '?')}, {tmpl.get('outcome', '?')}) ---")
        for sec in tmpl.get("sections", []):
            lines.append(
                f"  {sec.get('order', '?')}. {sec.get('title', '?')} "
                f"[{sec.get('section_type', '?')}] ~{sec.get('word_count', '?')} words"
            )
    return "\n".join(lines)


def _format_similar_grants(grants: list[dict]) -> str:
    if not grants:
        return ""

    archive_grants = [g for g in grants if not g.get("is_reference_doc")]
    reference_docs = [g for g in grants if g.get("is_reference_doc")]

    lines = []

    if reference_docs:
        lines.append(
            "REFERENCE DOCUMENTS — uploaded past proposals and project reports for this grant "
            "(use to ground specific data, results, methods, and descriptions in the skeleton):"
        )
        for g in reference_docs[:6]:
            title = g.get("grant_title") or "Reference document"
            section_title = g.get("section_title") or g.get("section_type") or "section"
            snippet = g.get("full_text") or g.get("text_snippet") or ""
            lines.append(f"\n--- {title} — {section_title} ---")
            lines.append(snippet[:1200] + ("..." if len(snippet) > 1200 else ""))

    if archive_grants:
        if lines:
            lines.append("")
        lines.append("RELEVANT AWARDED GRANTS (content and structure reference from org archive):")
        for g in archive_grants[:6]:
            title = g.get("grant_title", "?")
            sec_type = g.get("section_type", "?")
            funder = g.get("funder", "?")
            outcome = g.get("outcome", "?")
            lines.append(f"\n- {title}: {sec_type} section from {funder} ({outcome})")
            snippet = g.get("text_snippet") or g.get("full_text") or ""
            if snippet:
                lines.append(f"  Excerpt: {snippet[:500]}{'...' if len(snippet) > 500 else ''}")

    return "\n".join(lines)


def _format_call_intelligence(ci: dict) -> str:
    """Format call_intelligence as guidance context for the architect prompt."""
    if not ci:
        return ""
    lines = []

    if ci.get("grant_type_context"):
        lines.append(f"GRANT TYPE CONTEXT (what wins for this call):\n{ci['grant_type_context']}")

    blueprint = ci.get("section_blueprint") or []
    if blueprint:
        lines.append("\nSUGGESTED SECTION BLUEPRINT (from call meta-analysis — adapt based on the grant idea):")
        for sec in blueprint[:12]:
            name = sec.get("name", "")
            purpose = sec.get("purpose", "")
            wc = sec.get("suggested_word_count")
            notes = sec.get("writing_notes", "")
            wc_str = f" (~{wc} words)" if wc else ""
            lines.append(f"  {sec.get('order', '?')}. {name}{wc_str}: {purpose}")
            if notes:
                lines.append(f"     Note: {notes[:150]}")

    adversarial = ci.get("adversarial_challenges") or {}
    rejection_risks = adversarial.get("rejection_risks") or []
    compliance_gaps = adversarial.get("compliance_gaps") or []
    if rejection_risks or compliance_gaps:
        lines.append("\nADVERSARIAL CHALLENGES (address these in relevant sections):")
        for r in rejection_risks[:3]:
            lines.append(f"  ⚠ Reviewer risk: {r}")
        for c in compliance_gaps[:3]:
            lines.append(f"  ✗ Compliance gap: {c}")

    gap_questions = ci.get("gap_questions") or []
    if gap_questions:
        lines.append("\nGAP QUESTIONS (use [TBD: reason] for these in the skeleton):")
        for q in gap_questions[:4]:
            lines.append(f"  ? {q}")

    return "\n".join(lines) if lines else ""


def _format_idea_block(grant_idea: str, aligned_framing: str | None) -> str:
    """Format the idea block, showing both full idea and aligned framing lens."""
    parts = []
    if grant_idea:
        parts.append(
            f"GRANT IDEA (the team's full proposed approach — PRIMARY CONTENT SOURCE; "
            f"use their exact terminology, technology names, populations, methods, metrics):\n"
            f"{grant_idea}"
        )
    if aligned_framing:
        parts.append(
            f"ALIGNED FRAMING (how the idea should be positioned for this call — use as a "
            f"strategic lens but ground all bullets in the GRANT IDEA above):\n"
            f"{aligned_framing[:1000]}"
        )
    return "\n\n".join(parts) if parts else "GRANT IDEA: Not provided"


def _format_section_evidence_bundles(bundles: dict[str, dict]) -> str:
    """Format per-section evidence bundles for the architect prompt.

    Each section gets its top web evidence, archive excerpts, and academic citations
    formatted as a concise block. The architect is instructed to anchor at least 2
    bullets per section in this evidence.
    """
    if not bundles:
        return ""
    lines = [
        "PER-SECTION EVIDENCE BUNDLES",
        "(For each section below, you MUST draw at least 2 bullets from the provided evidence.",
        " Use specific statistics, methods, and findings — cite the source briefly inline.)\n",
    ]
    for section_name, bundle in bundles.items():
        if not bundle:
            continue
        lines.append(f"--- {section_name} ---")

        # Key evidence (synthesised by research_agent)
        key_evidence = bundle.get("key_evidence") or []
        if key_evidence:
            lines.append("Key evidence:")
            for ev in key_evidence[:3]:
                claim = ev.get("claim", "")
                excerpt = ev.get("excerpt", "")
                source = ev.get("source_title", "")
                src_type = ev.get("source_type", "")
                if excerpt:
                    lines.append(f"  [{src_type or 'source'}] {claim}: \"{excerpt[:200]}\" — {source[:80]}")
                elif claim:
                    lines.append(f"  [{src_type or 'source'}] {claim} — {source[:80]}")

        # Summary for drafter (synthesised paragraph)
        summary = bundle.get("summary_for_drafter", "")
        if summary:
            lines.append(f"Evidence summary: {summary[:300]}")

        # Archive RAG excerpts (HyDE-retrieved)
        rag_items = bundle.get("rag_content_exemplars") or []
        if rag_items:
            lines.append("Archive excerpts (awarded grants):")
            for item in rag_items[:2]:
                snippet = item.get("text_snippet") or item.get("full_text") or ""
                grant_title = item.get("grant_title", "")
                sec_type = item.get("section_type", "")
                outcome = item.get("outcome", "")
                if snippet:
                    lines.append(
                        f"  [{outcome} grant — {sec_type}] {grant_title}: "
                        f"\"{snippet[:250]}{'...' if len(snippet) > 250 else ''}\""
                    )

        # Academic citations
        citations = bundle.get("suggested_citations") or []
        if citations:
            lines.append("Academic citations to consider:")
            for c in citations[:2]:
                lines.append(f"  • {c[:200]}")

        lines.append("")

    return "\n".join(lines)


def _format_call_strategy(strategy: dict) -> str:
    if not strategy:
        return ""
    lines = ["CALL STRATEGY BRIEF (what a winning proposal must do for THIS call):"]

    if strategy.get("narrative_framing"):
        lines.append(f"OVERALL FRAMING: {strategy['narrative_framing']}")

    if strategy.get("critical_themes"):
        lines.append("CRITICAL THEMES (priority order): " + " | ".join(strategy["critical_themes"][:6]))

    if strategy.get("must_demonstrate"):
        lines.append("MUST DEMONSTRATE:")
        for d in strategy["must_demonstrate"][:6]:
            lines.append(f"  - {d}")

    if strategy.get("winning_differentiators"):
        lines.append("WINNING DIFFERENTIATORS:")
        for d in strategy["winning_differentiators"][:4]:
            lines.append(f"  - {d}")

    if strategy.get("key_phrases_to_echo"):
        lines.append("KEY FUNDER PHRASES TO ECHO: " + " | ".join(
            f'"{p}"' for p in strategy["key_phrases_to_echo"][:5]
        ))

    if strategy.get("red_flags"):
        lines.append("RED FLAGS TO AVOID:")
        for r in strategy["red_flags"][:3]:
            lines.append(f"  - {r}")

    # Wire section_strategy through — previously generated but dropped
    if strategy.get("section_strategy"):
        lines.append("PER-SECTION STRATEGIC GUIDANCE:")
        for sec_name, guidance in list(strategy["section_strategy"].items())[:8]:
            if isinstance(guidance, str) and guidance:
                lines.append(f"  {sec_name}: {guidance[:250]}")

    return "\n".join(lines)


def _format_aligned_concept(concept: dict) -> str:
    if not concept:
        return ""
    lines = ["IDEA ALIGNMENT (how to frame this idea for this funder):"]

    if concept.get("strengths_to_lead_with"):
        lines.append("LEAD WITH THESE STRENGTHS:")
        for s in concept["strengths_to_lead_with"]:
            lines.append(f"  - {s}")

    if concept.get("gaps_to_address"):
        lines.append("GAPS TO INCORPORATE:")
        for g in concept["gaps_to_address"]:
            lines.append(f"  - {g}")

    if concept.get("opening_hook"):
        lines.append(f"SUGGESTED OPENING HOOK:\n{concept['opening_hook']}")

    if concept.get("emphasis_areas"):
        lines.append("SECTION EMPHASIS:")
        for ea in concept["emphasis_areas"][:5]:
            if isinstance(ea, dict):
                lines.append(f"  - {ea.get('section', '')}: {ea.get('emphasis', '')}")

    return "\n".join(lines)

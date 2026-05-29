"""
Agent 4: Proposal Architect
Generates a skeleton draft as a single raw text document grounded in the grant idea and the
team's narrative priorities. Section titles use ## headings. The user edits the document
directly before generating the full draft.
"""
import json
from app.ai.client import chat_complete

SYSTEM_PROMPT = """You are a senior grants strategist and proposal writer with deep expertise in drafting
competitive research proposals across all domains and funders.

Your task is to produce a skeleton draft of a proposal as a single flowing document. The document
should reflect the applicant's own voice and narrative priorities, not be a rigid mapping of the
call's section list. Think of it as the starting canvas: real draft prose that the team will shape
into their proposal, with the call requirements serving as coverage guidance they will verify while
editing.

Document format:
- Use ## Section Name to introduce each section (Markdown-style heading)
- Write 2–4 paragraphs of actual skeleton prose per section — not requirements lists or bullet points
- Separate sections with a blank line before and after the ## heading
- The full document goes in the raw_text field of the JSON response

Guiding principles:
- Base the content on the applicant's grant idea — use their framing, claims, and approach
- Let the grant idea and award-winning archive structures drive section organization, not the call's exact section list
- The call's required sections and evaluation criteria inform THEMATIC COVERAGE across sections, not a 1:1 structural mapping
- Mirror section structures and word distributions from awarded grants shown in the context
- When REFERENCE DOCUMENTS are provided, use the actual data, results, project names, and descriptions from them — do not use [TBD] for information that is already present in the reference docs
- Use [TBD] only for specific data, names, or numbers that are genuinely not available in any provided context
- Ensure the narrative arc creates a compelling through-line from problem to solution across sections

The team will flag priority sections and further edit the document before generating the full draft.

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
    style_profile: dict | None = None,
    call_requirements_text: str = "",
    call_strategy: dict | None = None,
    aligned_concept: dict | None = None,
    section_constraints: list[dict] | None = None,
    total_word_limit: int | None = None,
    total_page_limit: str | None = None,
) -> dict:
    structure_str = _format_structure_templates(structure_templates or [])
    similar_str = _format_similar_grants(similar_grants or [])
    style_str = _format_style_profile(style_profile or {})
    style_section = f'STYLE PROFILE:\n{style_str}' if style_str else ''
    team_pref_section = f'TEAM PREFERENCES: {team_preferences}' if team_preferences else ''

    # Build enriched strategy sections when available
    strategy_section = _format_call_strategy(call_strategy) if call_strategy else ''
    alignment_section = _format_aligned_concept(aligned_concept) if aligned_concept else ''

    # Build section structure block from constraints
    constraints_section = _format_section_constraints(
        section_constraints, total_word_limit, total_page_limit
    )

    user_prompt = f"""Think step by step before producing the skeleton:
1. Identify the grant's core narrative: what problem, what solution, what impact — from the grant idea.
2. Identify the critical themes and must-demonstrate requirements from the call strategy (if provided).
3. Use the SECTION STRUCTURE AND LIMITS below as the authoritative section list — write a section for
   each entry using exactly those section names as ## headings. Respect word limits when drafting.
4. Draft 2–4 paragraphs of actual skeleton prose per section, grounded in the aligned idea and the funder's priorities.
Then produce the full JSON response.

---

GRANT: {opportunity_title}
EXTERNAL DEADLINE: {external_deadline or 'Not specified'}
INTERNAL DEADLINE: {internal_deadline or 'Not specified'}

GRANT IDEA (aligned to funder priorities):
{grant_idea or 'Not provided'}

CALL REQUIREMENTS AND STRATEGY:
{call_requirements_text or 'Not provided — use call_analysis fields below'}

CALL ANALYSIS (coverage guidance):
Coverage themes from required sections: {call_analysis.get('required_sections', [])}
Evaluation criteria (key thematic priorities): {call_analysis.get('evaluation_criteria', [])}
Budget constraints: {call_analysis.get('budget_constraints', '')}

{constraints_section}{strategy_section}
{alignment_section}
{structure_str}

{similar_str}

{style_section}
{team_pref_section}

---

Produce a JSON object with the following fields:

- raw_text: a single string containing the full skeleton document. Use ## Section Name headings
  to introduce each section (use the exact section names from SECTION STRUCTURE AND LIMITS if
  provided). Write 2–4 paragraphs of real draft prose per section, grounded in the grant idea.
  Respect any stated word limits. Use [TBD] for specifics not yet known. Sections are separated
  by a blank line before and after each ## heading.
- sections: list of objects, one per section in the skeleton, in order:
    {{"name": str, "word_limit": int|null, "page_limit": str|null, "priority": "high"|"medium"|"low", "order": int}}
  Use the constraints from SECTION STRUCTURE AND LIMITS if provided, otherwise infer from raw_text.
- total_word_limit: int|null — document-level word limit (from constraints or call)
- total_page_limit: str|null — document-level page limit
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

    # Carry forward document-level limits if not returned by model
    if total_word_limit and not result.get("total_word_limit"):
        result["total_word_limit"] = total_word_limit
    if total_page_limit and not result.get("total_page_limit"):
        result["total_page_limit"] = total_page_limit

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
            parts = [f"  {sc.get('order', '?')}. {name} [{pri}]"]
            if wl:
                parts.append(f"{wl:,} words")
            if pl:
                parts.append(f"{pl} pages")
            lines.append(" — ".join(parts) if len(parts) > 1 else parts[0])
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
            lines.append(
                f"- {g.get('grant_title', '?')}: {g.get('section_type', '?')} section "
                f"from {g.get('funder', '?')} ({g.get('outcome', '?')})"
            )

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

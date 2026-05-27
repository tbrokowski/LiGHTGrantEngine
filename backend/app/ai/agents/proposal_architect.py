"""
Agent 4: Proposal Architect
Generates a detailed proposal outline grounded in the call's specific deliverables,
evaluation criteria, and awarded-grant structures from the archive.
"""
import json
from app.ai.client import chat_complete
from app.ai.context.grant_context import DEFAULT_INTRO_ARC

SYSTEM_PROMPT = """You are a senior grants strategist with deep expertise in structuring
competitive research proposals across all domains and funders.

Your task is to produce a detailed, fundable proposal outline tailored to the specific
call and applicant's idea.

Guiding principles:
- Mirror section structures and word distributions from awarded grants shown in the context
- For every section, surface the funder's specific asks, questions it must answer, and evidence needed
- Ensure the narrative arc creates a compelling through-line from problem to solution
- Be concrete and specific — vague section requirements produce weak drafts
- Sections must map directly to evaluation criteria; make that mapping explicit in each section's requirements
- Use the key_asks and questions_to_address from the call analysis to populate each section's requirements field

Respond with valid JSON."""

INTRO_SECTION_TYPES = {"introduction", "background", "problem_statement", "executive_summary", "justification"}


def _format_style_profile(profile: dict) -> str:
    """Format style profile as readable prose rather than raw JSON."""
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
    """Format archive structure templates with full section detail."""
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
    """Format similar grants with section and funder context."""
    if not grants:
        return ""
    lines = ["RELEVANT AWARDED GRANTS (content and structure reference):"]
    for g in grants[:8]:
        lines.append(
            f"- {g.get('grant_title', '?')}: {g.get('section_type', '?')} section "
            f"from {g.get('funder', '?')} ({g.get('outcome', '?')})"
        )
    return "\n".join(lines)


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
) -> dict:
    structure_str = _format_structure_templates(structure_templates or [])
    similar_str = _format_similar_grants(similar_grants or [])
    style_str = _format_style_profile(style_profile or {})
    style_section = f'STYLE PROFILE:\n{style_str}' if style_str else ''
    team_pref_section = f'TEAM PREFERENCES: {team_preferences}' if team_preferences else ''

    user_prompt = f"""Think step by step before producing the outline:
1. Identify the 3–5 highest-weight evaluation criteria from the call.
2. Assign each criterion to the section(s) best placed to address it.
3. Verify the section list covers all required sections from the call.
Then produce the full JSON outline.

---

GRANT: {opportunity_title}
EXTERNAL DEADLINE: {external_deadline or 'Not specified'}
INTERNAL DEADLINE: {internal_deadline or 'Not specified'}

GRANT IDEA:
{grant_idea or 'Not provided'}

CALL REQUIREMENTS (narrative brief, evaluation criteria, per-section deliverables):
{call_requirements_text or 'Not provided — use call_analysis fields below'}

CALL ANALYSIS (structured):
Required sections: {call_analysis.get('required_sections', [])}
Evaluation criteria: {call_analysis.get('evaluation_criteria', [])}
Budget constraints: {call_analysis.get('budget_constraints', '')}

{structure_str}

{similar_str}

{style_section}
{team_pref_section}

---

Produce a comprehensive proposal outline. For each section include:
- name: section title
- type: standard section type (introduction, background, methods, impact_statement, etc.)
- requirements: a concrete, specific description of what this section must contain — incorporate the
  funder's key_asks and questions_to_address for this section where available
- word_limit: integer or null
- priority: "high" | "medium" | "low"
- suggested_lead: suggested lead author or role
- order: integer

For intro-type sections (introduction, background, problem_statement, executive_summary, justification),
also include intro_arc: the 6-beat narrative arc with beat, label, guidance fields.

Top-level fields to include:
- sections: [array of section objects]
- title_suggestion: a compelling, specific title for the proposal
- narrative_arc: one sentence describing the through-line from problem to solution
- key_messages: list of 3–5 core messages reviewers should take away
- document_checklist: list of required attachments/appendices
- compliance_checklist: list of hard compliance requirements
- internal_timeline: list of key internal milestones with suggested dates
- warnings: list of risks or concerns about this proposal's competitiveness

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

    for sec in result.get("sections", []):
        sec_type = (sec.get("type") or "").lower()
        name_lower = (sec.get("name") or "").lower()
        is_intro = sec_type in INTRO_SECTION_TYPES or any(k in name_lower for k in ("intro", "background", "problem"))
        if is_intro and not sec.get("intro_arc"):
            sec["intro_arc"] = DEFAULT_INTRO_ARC

    return result

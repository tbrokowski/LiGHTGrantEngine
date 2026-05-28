"""
Agent 4: Proposal Architect
Generates a detailed proposal outline grounded in the call's specific deliverables,
evaluation criteria, and awarded-grant structures from the archive.
"""
import json
from app.ai.client import chat_complete
from app.ai.context.grant_context import DEFAULT_INTRO_ARC

SYSTEM_PROMPT = """You are a senior grants strategist and proposal writer with deep expertise in drafting
competitive research proposals across all domains and funders.

Your task is to produce a complete skeleton draft of a proposal — actual written prose for every section,
not just an outline of what should go there. Think of this as the first rough draft that the team will
refine: each section should have real sentences and paragraphs grounded in the applicant's idea and the
call's requirements.

Guiding principles:
- Write actual skeleton prose for each section (2–4 paragraphs), not requirements lists or bullet points
- Base the content on the applicant's grant idea — use their framing, claims, and approach
- Mirror section structures and word distributions from awarded grants shown in the context
- Address the funder's specific asks and evaluation criteria directly in the drafted prose
- Use [TBD] as a placeholder for specific data, names, or numbers not yet available
- Ensure the narrative arc creates a compelling through-line from problem to solution across sections
- Sections must align with the exact structure the call specifies; do not invent sections not required
- Keep requirements field as a concise internal summary of what the section must cover (used by downstream agents)

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

    user_prompt = f"""Think step by step before producing the draft:
1. Identify the 3–5 highest-weight evaluation criteria from the call.
2. Map each criterion to the section(s) best placed to address it.
3. Verify the section list covers all required sections from the call — use the call's exact section names.
4. Draft 2–4 paragraphs of actual skeleton prose per section, grounded in the grant idea and the call's asks.
Then produce the full JSON skeleton.

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

Produce a complete skeleton draft document. For each section include:
- name: section title (use the call's exact section name where specified)
- type: standard section type (introduction, background, methods, impact_statement, etc.)
- content: 2–4 paragraphs of actual skeleton prose for this section written from the applicant's
  perspective. This is real draft text, not instructions. Ground it in the grant idea and directly
  address the call's requirements for this section. Use [TBD] for specifics not yet known (e.g.
  "[TBD: sample size]", "[TBD: partner institution name]"). This is the primary field the team will
  edit and refine.
- requirements: a concise 1–3 sentence internal summary of what this section must cover, incorporating
  the funder's key_asks and questions_to_address. This is used by downstream drafting agents, not
  shown prominently to users.
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

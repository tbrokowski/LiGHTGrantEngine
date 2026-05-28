"""
Agent 4: Proposal Architect
Generates a flexible skeleton draft grounded in the grant idea and the team's narrative priorities.
Call requirements are treated as thematic coverage guidance, not a rigid section-by-section mandate.
The user will then edit and restructure sections in the skeleton editor before generating the full draft.
"""
import json
from app.ai.client import chat_complete
from app.ai.context.grant_context import DEFAULT_INTRO_ARC

SYSTEM_PROMPT = """You are a senior grants strategist and proposal writer with deep expertise in drafting
competitive research proposals across all domains and funders.

Your task is to produce a skeleton draft of a proposal that the team will edit and refine. The skeleton
should reflect the applicant's own voice and narrative priorities, not be a rigid mapping of the call's
section list. Think of it as the starting canvas: real draft prose that the team will shape into their
proposal, with the call requirements serving as coverage guidance they will verify while editing.

Guiding principles:
- Write actual skeleton prose for each section (2–4 paragraphs), not requirements lists or bullet points
- Base the content on the applicant's grant idea — use their framing, claims, and approach
- Let the grant idea and award-winning archive structures drive section organization, not the call's exact section list
- The call's required sections and evaluation criteria inform THEMATIC COVERAGE across sections, not a 1:1 structural mapping
- If the call lists "Section 4: Management Plan", note it in the requirements field as coverage to address, but name and organize sections around the grant's strongest narrative flow
- Mirror section structures and word distributions from awarded grants shown in the context
- Use [TBD] as a placeholder for specific data, names, or numbers not yet available
- Ensure the narrative arc creates a compelling through-line from problem to solution across sections
- Keep the requirements field as a concise note on what coverage this section satisfies from the call (used as guidance by downstream drafting agents, not prescriptive)

The team will flag priority sections and further edit the skeleton before generating the full draft.

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

    user_prompt = f"""Think step by step before producing the skeleton:
1. Identify the grant's core narrative: what problem, what solution, what impact — from the grant idea.
2. Identify the 3–5 highest-weight evaluation criteria from the call — these are thematic coverage goals.
3. Design a section structure that best tells this grant's story (informed by archive structures and the grant idea), ensuring the thematic coverage goals are distributed naturally across sections.
4. Draft 2–4 paragraphs of actual skeleton prose per section, grounded in the grant idea and the funder's goals.
Then produce the full JSON skeleton.

---

GRANT: {opportunity_title}
EXTERNAL DEADLINE: {external_deadline or 'Not specified'}
INTERNAL DEADLINE: {internal_deadline or 'Not specified'}

GRANT IDEA:
{grant_idea or 'Not provided'}

CALL REQUIREMENTS (thematic guidance — coverage goals, not rigid section names):
{call_requirements_text or 'Not provided — use call_analysis fields below'}

CALL ANALYSIS (for coverage guidance only — do not mirror section names 1:1):
Coverage themes from required sections: {call_analysis.get('required_sections', [])}
Evaluation criteria (key thematic priorities): {call_analysis.get('evaluation_criteria', [])}
Budget constraints: {call_analysis.get('budget_constraints', '')}

{structure_str}

{similar_str}

{style_section}
{team_pref_section}

---

Produce a skeleton draft document. For each section include:
- name: section title chosen for narrative clarity and the grant's story (not necessarily the call's exact section name; note call coverage in requirements field)
- type: standard section type (introduction, background, methods, impact_statement, etc.)
- content: 2–4 paragraphs of actual skeleton prose for this section written from the applicant's
  perspective. This is real draft text, not instructions. Ground it in the grant idea and address
  the relevant thematic coverage for this section. Use [TBD] for specifics not yet known (e.g.
  "[TBD: sample size]", "[TBD: partner institution name]"). This is the primary field the team will
  edit and refine.
- requirements: a concise 1–3 sentence note on what call coverage / evaluation criteria this section
  addresses. Used as guidance by downstream drafting agents; shown to the user as a reference, not a constraint.
- word_limit: integer or null (from call if specified for this coverage area)
- priority: "high" | "medium" | "low"
- suggested_lead: suggested lead author or role
- order: integer

For intro-type sections (introduction, background, problem_statement, executive_summary, justification),
also include intro_arc: the 6-beat narrative arc with beat, label, guidance fields.

Top-level fields to include:
- sections: [array of section objects]
- flagged_sections: [] (empty list — the user will flag priority sections in the editor)
- title_suggestion: a compelling, specific title for the proposal
- narrative_arc: one sentence describing the through-line from problem to solution
- key_messages: list of 3–5 core messages reviewers should take away
- document_checklist: list of required attachments/appendices
- compliance_checklist: list of hard compliance requirements (from call)
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

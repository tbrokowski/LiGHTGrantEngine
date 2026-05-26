"""
Agent 4: Proposal Architect
Generates a proposal outline with section assignments and timeline.
"""
import json
from app.ai.client import chat_complete
from app.ai.context.grant_context import DEFAULT_INTRO_ARC

SYSTEM_PROMPT = """You are an expert proposal architect for global health AI research grants.
You create detailed proposal outlines based on call requirements and institutional experience.
Respond with valid JSON."""

INTRO_SECTION_TYPES = {"introduction", "background", "problem_statement", "executive_summary", "justification"}


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
) -> dict:
    sections_req = call_analysis.get("required_sections", [])
    section_requirements = call_analysis.get("section_requirements", {})
    eval_criteria = call_analysis.get("evaluation_criteria", [])
    budget = call_analysis.get("budget_constraints", "")

    prior_str = ""
    if similar_grants:
        prior_str = "\nRELEVANT PRIOR GRANTS (content reference):\n" + "\n".join([
            f"- {g.get('grant_title','?')}: {g.get('section_type','?')} section from {g.get('funder','?')} ({g.get('outcome','?')})"
            for g in similar_grants[:8]
        ])

    structure_str = ""
    if structure_templates:
        structure_str = "\nMATCH THESE ARCHIVE STRUCTURES (section order and word counts from awarded grants):\n"
        for tmpl in structure_templates[:3]:
            structure_str += f"\n--- {tmpl.get('grant_title','?')} ({tmpl.get('funder','?')}, {tmpl.get('outcome','?')}) ---\n"
            for sec in tmpl.get("sections", []):
                structure_str += (
                    f"  {sec.get('order', '?')}. {sec.get('title', '?')} "
                    f"[{sec.get('section_type', '?')}] ~{sec.get('word_count', '?')} words\n"
                )

    user_prompt = f"""Create a detailed proposal outline for: {opportunity_title}

GRANT IDEA:
{grant_idea[:2000] if grant_idea else 'Not provided'}

REQUIRED SECTIONS: {sections_req}
SECTION REQUIREMENTS: {json.dumps(section_requirements)[:2000]}
EVALUATION CRITERIA: {eval_criteria}
BUDGET CONSTRAINTS: {budget}
EXTERNAL DEADLINE: {external_deadline}
INTERNAL DEADLINE: {internal_deadline}
{structure_str}
{prior_str}
{f'TEAM PREFERENCES: {team_preferences}' if team_preferences else ''}
{f'STYLE PROFILE: {json.dumps(style_profile)[:1500]}' if style_profile else ''}

Create a comprehensive proposal outline. For each section include:
- name, type (standard section types), requirements, word_limit (null if unknown),
  priority (high/medium/low), suggested_lead, suggested_prior_material, order (int)

For intro-type sections (introduction, background, problem statement), also include:
- intro_arc: the 6-beat narrative arc with beat, label, guidance fields

Also include: title_suggestion, narrative_arc, document_checklist, compliance_checklist,
internal_timeline, recommended_prior_materials, key_messages, warnings.

Return as JSON."""

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

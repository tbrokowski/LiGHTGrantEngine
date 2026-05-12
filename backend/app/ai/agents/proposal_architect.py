"""
Agent 4: Proposal Architect
Generates a proposal outline with section assignments and timeline.
"""
import json
from app.ai.client import chat_complete

SYSTEM_PROMPT = """You are an expert proposal architect for global health AI research grants.
You create detailed proposal outlines based on call requirements and institutional experience.
Respond with valid JSON."""

async def generate_proposal_outline(
    opportunity_title: str,
    call_analysis: dict,
    similar_grants: list[dict] = None,
    team_preferences: str = "",
    internal_deadline: str = "",
    external_deadline: str = "",
) -> dict:
    """
    Returns:
        {
          "title_suggestion": str,
          "sections": [{"name": str, "type": str, "requirements": str, "word_limit": int|null,
                        "priority": str, "suggested_lead": str, "suggested_prior_material": str}],
          "narrative_arc": str,
          "document_checklist": [str],
          "compliance_checklist": [str],
          "internal_timeline": [{"milestone": str, "suggested_date": str, "owner": str}],
          "recommended_prior_materials": [str],
          "key_messages": [str],
          "warnings": [str],
        }
    """
    sections_req = call_analysis.get("required_sections", [])
    eval_criteria = call_analysis.get("evaluation_criteria", [])
    budget = call_analysis.get("budget_constraints", "")

    prior_str = ""
    if similar_grants:
        prior_str = "\nRELEVANT PRIOR GRANTS:\n" + "\n".join([
            f"- {g.get('grant_title','?')}: {g.get('section_type','?')} section from {g.get('funder','?')} ({g.get('outcome','?')})"
            for g in similar_grants[:8]
        ])

    user_prompt = f"""Create a detailed proposal outline for: {opportunity_title}

REQUIRED SECTIONS: {sections_req}
EVALUATION CRITERIA: {eval_criteria}
BUDGET CONSTRAINTS: {budget}
EXTERNAL DEADLINE: {external_deadline}
INTERNAL DEADLINE: {internal_deadline}
{prior_str}
{f'TEAM PREFERENCES: {team_preferences}' if team_preferences else ''}

Create a comprehensive proposal outline. For each section include: name, type (use standard section types),
requirements based on evaluation criteria, word_limit if determinable (null if not), priority (high/medium/low),
suggested_lead (PI/postdoc/student/operations), and suggested_prior_material (which past sections could help).

Also include: narrative_arc description, document_checklist, compliance_checklist,
internal_timeline with milestones and suggested dates counting back from deadline,
recommended_prior_materials to retrieve, key_messages for the proposal, warnings.

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
        return json.loads(response)
    except json.JSONDecodeError:
        return {"error": "Outline generation failed", "raw": response}

"""
Agent 3: Go/No-Go Assistant
Generates a structured go/no-go memo with recommendation.
"""
import json
from app.ai.client import chat_complete

SYSTEM_PROMPT = """You are a strategic grant advisor for the LiGHT research group at EPFL.
Generate clear, actionable go/no-go memos that help leadership make funding decisions.
Be honest about risks and workload. Respond with valid JSON."""

async def generate_go_no_go_memo(
    opportunity_title: str,
    call_analysis: dict,
    fit_score: float,
    similar_grants: list[dict] = None,
    team_context: str = "",
) -> dict:
    """
    Generate a go/no-go decision memo.

    Returns:
        {
          "recommendation": "pursue"|"watch"|"reject"|"defer",
          "confidence": float (0-1),
          "executive_summary": str,
          "strategic_fit": str,
          "eligibility_assessment": str,
          "estimated_workload": str,
          "partner_needs": str,
          "estimated_competitiveness": str,
          "recommended_lead": str,
          "key_risks": [str],
          "key_strengths": [str],
          "conditions": [str],
          "rationale": str,
          "action_items": [str],
        }
    """
    similar_str = ""
    if similar_grants:
        similar_str = "\nSIMILAR PAST GRANTS:\n" + "\n".join([
            f"- {g.get('grant_title','?')} ({g.get('funder','?')}, {g.get('year','?')}): {g.get('outcome','unknown')}"
            for g in similar_grants[:5]
        ])

    user_prompt = f"""Generate a go/no-go memo for the following grant opportunity.

OPPORTUNITY: {opportunity_title}
FIT SCORE: {fit_score:.0f}/100

CALL ANALYSIS SUMMARY:
- Themes: {call_analysis.get('thematic_areas', [])}
- Eligibility risks: {call_analysis.get('risks', [])}
- Budget: {call_analysis.get('budget_constraints', 'Unknown')}
- Deadline: {call_analysis.get('deadlines', {}).get('full_proposal', 'Unknown')}
- Required sections: {len(call_analysis.get('required_sections', []))} sections
- Partner requirements: {call_analysis.get('required_partners', 'None specified')}
{similar_str}
{f'TEAM CONTEXT: {team_context}' if team_context else ''}

Return a JSON memo with recommendation (pursue/watch/reject/defer), confidence (0-1),
executive_summary, strategic_fit, eligibility_assessment, estimated_workload (weeks of effort),
partner_needs, estimated_competitiveness, recommended_lead, key_risks (list), key_strengths (list),
conditions (list of things that must be true to pursue), rationale, action_items (list)."""

    response = await chat_complete(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        agent_name="go_no_go",
        json_mode=True,
    )
    try:
        return json.loads(response)
    except json.JSONDecodeError:
        return {"recommendation": "watch", "rationale": "Memo generation failed", "error": response}

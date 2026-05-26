"""Grant Reviewer — simulate funder panel quality review."""
import json
from app.ai.client import chat_complete

SYSTEM_PROMPT = """You are an experienced grant reviewer simulating a funder evaluation panel.
Score proposals against evaluation criteria with constructive, specific feedback.
Respond with valid JSON."""


async def review_proposal(
    proposal_draft: str,
    evaluation_criteria: list[str],
    call_analysis: dict,
    style_profile: dict | None = None,
    similar_grants: list[dict] | None = None,
) -> dict:
    prior_str = ""
    if similar_grants:
        for g in similar_grants[:4]:
            prior_str += f"\n- {g.get('grant_title', '?')} ({g.get('outcome', '?')}): {g.get('section_type', '?')}"

    user_prompt = f"""Review this grant proposal as a funder panel member.

EVALUATION CRITERIA:
{chr(10).join(f'- {c}' for c in evaluation_criteria)}

CALL CONTEXT:
{json.dumps({k: call_analysis.get(k) for k in ['summary', 'budget_constraints', 'award_amount', 'thematic_areas'] if call_analysis.get(k)}, indent=2)[:2000]}

STYLE PROFILE:
{json.dumps(style_profile or {}, indent=2)[:1500]}

PRIOR GRANTS FROM INSTITUTION:
{prior_str or 'None'}

PROPOSAL DRAFT:
{proposal_draft[:12000]}

Return JSON with:
- overall_score: 0-100
- criteria_scores: list of {{criterion, score: 1-5, strengths, weaknesses, suggestions}}
- narrative_quality: {{score: 1-5, notes}}
- innovation: {{score: 1-5, notes}}
- feasibility: {{score: 1-5, notes}}
- impact: {{score: 1-5, notes}}
- weak_sections: list of {{section, issue, suggestion}}
- strong_sections: list of {{section, reason}}
- panel_questions: list of questions a reviewer might ask
- recommended_improvements: list of prioritized improvements
"""

    response = await chat_complete(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        agent_name="grant_reviewer",
        json_mode=True,
    )
    try:
        return json.loads(response)
    except json.JSONDecodeError:
        return {"overall_score": 0, "error": "Grant review failed", "raw": response}

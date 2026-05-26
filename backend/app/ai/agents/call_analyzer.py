"""
Agent 1: Call Analyzer
Analyzes a grant call document and extracts structured information.
Uses the AI model to parse the call and produce a plain-language summary,
eligibility checklist, required sections, deadlines, and risks.
"""
import json
from app.ai.client import chat_complete

SYSTEM_PROMPT = """You are an expert grant analyst for a global health AI research team (LiGHT at EPFL).
Your task is to analyze grant calls and extract structured information that helps the team
decide whether to pursue the opportunity.

Always respond with valid JSON matching the schema requested.
Be precise and factual. Flag any missing information explicitly."""

async def analyze_call(
    call_text: str,
    call_url: str = "",
    funder: str = "",
    extra_instructions: str = "",
) -> dict:
    """
    Analyze a grant call and return structured output.

    Returns:
        {
          "summary": str,
          "plain_language_summary": str,
          "eligibility_checklist": [{"item": str, "met": bool|null, "notes": str}],
          "required_sections": [str],
          "deadlines": {"full_proposal": str, "loi": str, "concept_note": str},
          "budget_constraints": str,
          "evaluation_criteria": [str],
          "required_partners": str,
          "risks": [str],
          "missing_information": [str],
          "recommended_next_steps": [str],
          "thematic_areas": [str],
          "geographic_eligibility": str,
          "award_amount": str,
          "project_duration": str,
          "submission_portal": str,
          "page_limit": str,
          "word_limit": str,
        }
    """
    user_prompt = f"""Analyze the following grant call and extract structured information.

FUNDER: {funder}
CALL URL: {call_url}
{f'ADDITIONAL CONTEXT: {extra_instructions}' if extra_instructions else ''}

CALL TEXT:
{call_text[:12000]}

Return a JSON object with these fields:
- summary: 2-3 sentence summary
- plain_language_summary: plain English explanation for non-experts
- eligibility_checklist: list of eligibility items with met (true/false/null if unclear) and notes
- required_sections: list of proposal sections required
- deadlines: object with full_proposal, loi, concept_note (null if not applicable)
- budget_constraints: description of budget rules, limits, indirect costs
- evaluation_criteria: list of evaluation criteria
- required_partners: description of partner requirements
- risks: list of potential risks or concerns for our team
- missing_information: list of things not stated in the call that we need to find out
- recommended_next_steps: list of immediate actions
- thematic_areas: list of themes/topics the call addresses
- geographic_eligibility: geographic scope and restrictions
- award_amount: funding amount description
- project_duration: project duration
- submission_portal: where to submit
- page_limit: page limit if stated (null if not)
- word_limit: word limit if stated (null if not)
- section_requirements: object mapping section name to {{requirements: str, word_limit: int|null, page_limit: str|null, priority: str}}
"""
    response = await chat_complete(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        agent_name="call_analyzer",
        json_mode=True,
    )
    try:
        return json.loads(response)
    except json.JSONDecodeError:
        return {"raw_response": response, "error": "Failed to parse JSON"}

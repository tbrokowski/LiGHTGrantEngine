"""
Agent 6: Compliance Checker
Checks a proposal draft against funder requirements.
"""
import json
from app.ai.client import chat_complete

SYSTEM_PROMPT = """You are a grant compliance expert. You review proposal drafts against funder requirements
and identify missing elements, requirement violations, and submission risks.
Be thorough and precise. Respond with valid JSON."""

async def check_compliance(
    proposal_draft: str,
    call_requirements: dict,
    submission_instructions: str = "",
) -> dict:
    """
    Returns:
        {
          "overall_status": "pass"|"needs_work"|"critical_issues",
          "checklist": [{"item": str, "status": "pass"|"fail"|"warning"|"na", "notes": str}],
          "missing_sections": [str],
          "unanswered_criteria": [str],
          "word_limit_issues": [str],
          "page_limit_issues": [str],
          "formatting_issues": [str],
          "budget_issues": [str],
          "eligibility_concerns": [str],
          "missing_attachments": [str],
          "deadline_risks": [str],
          "critical_blockers": [str],
          "warnings": [str],
          "recommended_fixes": [str],
        }
    """
    required_sections = call_requirements.get("required_sections", [])
    eval_criteria = call_requirements.get("evaluation_criteria", [])
    word_limit = call_requirements.get("word_limit")
    page_limit = call_requirements.get("page_limit")

    actual_words = len(proposal_draft.split())

    user_prompt = f"""Review this proposal draft for compliance with funder requirements.

PROPOSAL DRAFT (first 6000 words shown):
{proposal_draft[:15000]}

REQUIRED SECTIONS: {required_sections}
EVALUATION CRITERIA TO ADDRESS: {eval_criteria}
WORD LIMIT: {word_limit or 'Not specified'}
PAGE LIMIT: {page_limit or 'Not specified'}
ACTUAL WORD COUNT: {actual_words}
SUBMISSION INSTRUCTIONS: {submission_instructions[:1000] if submission_instructions else 'Not provided'}

Check:
1. Are all required sections present?
2. Does the proposal address all evaluation criteria?
3. Are word/page limits met?
4. Any formatting issues?
5. Any budget inconsistencies?
6. Any eligibility concerns?
7. Missing attachments?
8. Deadline risks?

Return JSON with: overall_status, checklist (each requirement with pass/fail/warning/na + notes),
missing_sections, unanswered_criteria, word_limit_issues, page_limit_issues, formatting_issues,
budget_issues, eligibility_concerns, missing_attachments, deadline_risks, critical_blockers,
warnings, recommended_fixes."""

    response = await chat_complete(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        agent_name="compliance_checker",
        json_mode=True,
    )
    try:
        return json.loads(response)
    except json.JSONDecodeError:
        return {"overall_status": "needs_work", "error": "Compliance check failed", "raw": response}

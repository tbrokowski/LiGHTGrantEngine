"""
Agent 9: Reviewer Feedback Analyzer
Extracts lessons and resubmission guidance from reviewer comments.
"""
import json
from app.ai.client import chat_complete

SYSTEM_PROMPT = """You analyze grant reviewer feedback to extract actionable lessons.
Focus on specific, actionable improvements. Respond with valid JSON."""

async def analyze_feedback(
    reviewer_comments: str,
    panel_feedback: str = "",
    outcome: str = "",
    scores: str = "",
    funder: str = "",
) -> dict:
    user_prompt = f"""Analyze the following grant reviewer feedback.

FUNDER: {funder}
OUTCOME: {outcome}
SCORES: {scores}

REVIEWER COMMENTS:
{reviewer_comments[:4000]}

{f'PANEL FEEDBACK: {panel_feedback[:2000]}' if panel_feedback else ''}

Extract:
- key_weaknesses: list of specific weaknesses raised
- key_strengths: list of strengths noted  
- actionable_lessons: specific changes that would improve future applications
- reusable_lessons: lessons applicable to other proposals
- resubmission_suggestions: if resubmission is possible, what to change
- funder_preference_notes: insights about what this funder values
- priority_fixes: most critical issues to address

Return as JSON."""

    response = await chat_complete(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        agent_name="feedback_analyzer",
        json_mode=True,
    )
    try:
        return json.loads(response)
    except json.JSONDecodeError:
        return {"error": "Analysis failed", "raw": response}

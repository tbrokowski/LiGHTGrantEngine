"""
Outreach Draft Agent — generates personalized outreach email drafts
for partner engagement, grant collaboration requests, etc.
"""
import json
from typing import Optional

from app.ai.client import chat_complete


SYSTEM_PROMPT = """You are a research collaboration specialist who writes personalized,
professional outreach emails for academic and research partnerships.
Write naturally and specifically — reference the partner's actual research, not generic phrases.
Respond only with valid JSON."""


async def draft_outreach_email(
    partner_name: str,
    partner_title: Optional[str],
    partner_organization: Optional[str],
    partner_tags: list[str],
    purpose: str,
    grant_context: Optional[str],
    sender_name: str,
    sender_institution: str,
) -> dict:
    """
    Generate a personalized outreach email draft.

    Returns:
        {subject: str, body: str, tone: str}
    """
    expertise_str = ", ".join(partner_tags[:8]) if partner_tags else "their research area"
    partner_str = f"{partner_name}"
    if partner_title:
        partner_str += f", {partner_title}"
    if partner_organization:
        partner_str += f" at {partner_organization}"

    grant_str = f"\nGrant/opportunity context: {grant_context}" if grant_context else ""
    purpose_str = purpose or "explore a potential research collaboration"

    user_prompt = f"""Write a personalized outreach email for:

RECIPIENT: {partner_str}
EXPERTISE: {expertise_str}

SENDER: {sender_name} ({sender_institution})
PURPOSE: {purpose_str}
{grant_str}

Requirements:
- Professional but warm tone
- Reference the partner's specific expertise ({expertise_str})
- Clear, specific purpose — not generic
- 3-4 paragraphs maximum
- End with a clear, low-friction call to action (e.g., 15-min call)
- No hollow phrases like "I hope this email finds you well"

Return JSON:
{{
  "subject": "...",
  "body": "Full email body with proper paragraphs...",
  "tone": "professional" | "warm" | "formal",
  "suggested_follow_up_days": 7
}}"""

    try:
        response = await chat_complete(
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            agent_name="outreach_draft",
            json_mode=True,
        )
        result = json.loads(response)
        return {
            "subject": result.get("subject", f"Research Collaboration Opportunity — {sender_institution}"),
            "body": result.get("body", ""),
            "tone": result.get("tone", "professional"),
            "suggested_follow_up_days": result.get("suggested_follow_up_days", 7),
        }
    except Exception as e:
        return {
            "subject": f"Research Collaboration — {sender_institution}",
            "body": f"Dear {partner_name},\n\nI am reaching out regarding {purpose_str}.\n\nBest regards,\n{sender_name}",
            "tone": "professional",
            "suggested_follow_up_days": 7,
            "error": str(e),
        }

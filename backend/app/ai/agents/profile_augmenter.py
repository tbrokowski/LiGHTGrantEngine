"""
Profile Augmenter Agent
Rewrites and expands raw research interests into structured grant-matching metadata.
Used during org and personal onboarding.
"""
import json
from app.ai.client import chat_complete

SYSTEM_PROMPT = """You are an expert in grant writing and research funding for academic and research institutions.
Your task is to take raw, informal descriptions of research interests and transform them into
clean, structured grant-matching metadata.

Always respond with valid JSON. Be specific, use standard terminology, and expand abbreviations."""


async def augment_profile(
    raw_interests: str,
    org_name: str = "",
    description: str = "",
) -> dict:
    """
    Take raw interest text and return a structured GrantProfile.

    Returns:
        {
          "keywords": [str],
          "domains": [str],
          "methods": [str],
          "populations": [str],
          "geographies": [str],
          "funders": [str],
          "strategic_priorities": [str],
          "fit_summary": str,
        }
    """
    user_prompt = f"""Transform the following research interests into structured grant-matching metadata.

ORGANIZATION: {org_name or "Research Lab"}
DESCRIPTION: {description or "Not provided"}
RAW INTERESTS: {raw_interests[:4000]}

Return a JSON object with these fields:
- keywords: list of 10-20 specific, searchable keywords (e.g. "federated learning", "TB diagnostics", "AI ultrasound")
- domains: list of broad research domains (e.g. "Global Health", "Machine Learning", "Clinical Research")
- methods: list of research methods (e.g. "randomized controlled trial", "deep learning", "implementation science")
- populations: list of target populations (e.g. "low-income countries", "children under 5", "frontline health workers")
- geographies: list of geographic focus areas (e.g. "Sub-Saharan Africa", "South Asia", "global")
- funders: list of likely funder types or specific funders (e.g. "NIH", "Wellcome Trust", "Gates Foundation", "EU Horizon")
- strategic_priorities: list of 3-5 strategic priorities for grant applications
- fit_summary: 2-3 sentence summary of what kinds of grants are the best fit

Be precise and use standard terminology that grant databases use."""

    response = await chat_complete(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        agent_name="profile_augmenter",
        json_mode=True,
        temperature=0.2,
    )
    try:
        return json.loads(response)
    except json.JSONDecodeError:
        return {"raw_response": response, "error": "Failed to parse JSON"}

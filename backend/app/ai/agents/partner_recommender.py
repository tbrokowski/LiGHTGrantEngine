"""
Partner Recommender — suggests relevant CRM partners for a grant or opportunity.
Ranks existing partners by fit using the LLM, based on grant context and partner
tags, project types, organization, and past collaborations.
"""
import json
from typing import Optional

from app.ai.client import chat_complete

SYSTEM_PROMPT = """You are a research partnership recommendation system.
Given a grant opportunity and a list of known partners, rank which partners
would be most valuable to involve in the proposal.
Respond only with valid JSON."""


async def recommend_partners(
    grant_title: str,
    grant_description: str,
    grant_funder: str,
    grant_themes: list[str],
    grant_geographies: list[str],
    partners: list[dict],
    top_n: int = 10,
) -> dict:
    """
    Recommend and rank partners for a given grant.

    Args:
        grant_title: Title of the grant/opportunity
        grant_description: Full description or summary
        grant_funder: Funding organization name
        grant_themes: Thematic areas of the grant
        grant_geographies: Geographic focus areas
        partners: List of partner dicts with id, name, organization, tags,
                  project_types, past_grants (count)
        top_n: Number of top partners to return

    Returns:
        {
          "recommendations": [
            {
              "partner_id": str,
              "name": str,
              "organization": str,
              "score": int (0-100),
              "reason": str,
              "suggested_role": str,
            },
            ...
          ],
          "reasoning": str
        }
    """
    if not partners:
        return {"recommendations": [], "reasoning": "No partners in CRM."}

    partners_text = "\n".join(
        f"- ID: {p['id']} | Name: {p['name']} | Org: {p.get('organization','N/A')} "
        f"| Tags: {', '.join(p.get('tags', []))} "
        f"| Project types: {', '.join(p.get('project_types', []))} "
        f"| Past grant collaborations: {p.get('past_grants', 0)}"
        for p in partners[:80]  # cap at 80 to stay within context
    )

    user_prompt = f"""GRANT OPPORTUNITY:
Title: {grant_title}
Funder: {grant_funder}
Description: {grant_description[:2000]}
Thematic areas: {', '.join(grant_themes)}
Geographies: {', '.join(grant_geographies)}

AVAILABLE PARTNERS ({len(partners)} total):
{partners_text}

TASK:
Identify the top {top_n} most relevant partners for this grant. For each partner:
- Assign a score from 0-100 based on thematic fit, expertise alignment, and past collaboration
- Briefly explain why they are a good fit (1-2 sentences)
- Suggest a role (e.g. PI, co-investigator, implementing partner, advisor, industry partner)

Return JSON:
{{
  "recommendations": [
    {{
      "partner_id": "...",
      "name": "...",
      "organization": "...",
      "score": 85,
      "reason": "...",
      "suggested_role": "..."
    }}
  ],
  "reasoning": "brief overall explanation"
}}

Only include partners with score >= 30. Sort by score descending."""

    response = await chat_complete(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        agent_name="partner_recommender",
        json_mode=True,
    )

    try:
        result = json.loads(response)
        # Ensure recommendations are sorted by score
        recs = result.get("recommendations", [])
        recs.sort(key=lambda x: x.get("score", 0), reverse=True)
        result["recommendations"] = recs[:top_n]
        return result
    except json.JSONDecodeError:
        return {
            "recommendations": [],
            "reasoning": "Recommendation failed to parse.",
            "error": response,
        }

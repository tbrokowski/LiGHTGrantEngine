"""
Fit Scorer — AI-powered fit scoring for opportunities against an org grant profile.
"""
import json
from app.ai.client import chat_complete
from app.schemas.grant_profile import GrantProfile

SYSTEM_PROMPT = """You are a grant fit scoring system for a research team.
Score grant opportunities based on alignment with the team's research profile.
Respond only with valid JSON."""


async def score_opportunity(
    title: str,
    description: str,
    funder: str = "",
    eligibility: str = "",
    geography: str = "",
    award_amount: str = "",
    deadline: str = "",
    profile: GrantProfile | None = None,
) -> dict:
    profile = profile or GrantProfile()
    themes = ", ".join(profile.keywords[:20]) or "general research"
    geos = ", ".join(profile.geographies) or "global"
    institution = profile.institution_name or "the research team"
    projects = profile.projects or "Not specified"

    user_prompt = f"""Score this grant opportunity for {institution}.

TEAM PROFILE:
- Institution: {institution}
- Core themes / keywords: {themes}
- Target geographies: {geos}
- Active projects and context: {projects}

OPPORTUNITY:
Title: {title}
Funder: {funder}
Description: {description[:3000]}
Eligibility: {eligibility[:500]}
Geography: {geography}
Award amount: {award_amount}
Deadline: {deadline}

SCORING WEIGHTS:
- Thematic alignment: 0-35 points
- Eligibility match: 0-20 points
- Deadline feasibility: 0-10 points (>6 months = 10, 3-6 months = 7, 1-3 months = 4, <1 month = 1)
- Strategic funder priority: 0-10 points
- Award size appropriateness: 0-10 points
- Geographic relevance: 0-10 points
- Partner feasibility: 0-5 points

Score each dimension and sum for total (0-100).
Tiers: 80-100 = high_priority, 60-79 = worth_reviewing, 40-59 = watchlist, <40 = low_fit

Return JSON with fit_score, priority, each dimension score, rationale, matched_themes, risks, flagged_keywords."""

    response = await chat_complete(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        agent_name="fit_scorer",
        json_mode=True,
    )
    try:
        return json.loads(response)
    except json.JSONDecodeError:
        return {"fit_score": 0, "priority": "low_fit", "rationale": "Scoring failed", "error": response}

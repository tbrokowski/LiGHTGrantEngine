"""
Fit Scorer — AI-powered fit scoring for opportunities.
Scores opportunities against the team's thematic and strategic priorities
as defined in config.yaml (fit_scoring section).
"""
import json
from app.ai.client import chat_complete
from app.config import get_settings

settings = get_settings()

SYSTEM_PROMPT = """You are a grant fit scoring system for the LiGHT research group at EPFL.
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
) -> dict:
    """
    Score a grant opportunity and return structured fit assessment.

    Returns:
        {
          "fit_score": float (0-100),
          "priority": str ("high_priority"|"worth_reviewing"|"watchlist"|"low_fit"),
          "thematic_alignment": float (0-35),
          "eligibility_match": float (0-20),
          "deadline_feasibility": float (0-10),
          "strategic_funder_priority": float (0-10),
          "award_size_score": float (0-10),
          "geographic_relevance": float (0-10),
          "partner_feasibility": float (0-5),
          "rationale": str,
          "matched_themes": [str],
          "risks": [str],
          "flagged_keywords": [str],
        }
    """
    scoring = settings.fit_scoring
    themes = ", ".join(scoring.team_themes[:15])
    geos = ", ".join(scoring.team_geographies)

    user_prompt = f"""Score this grant opportunity for the LiGHT team at EPFL.

TEAM PROFILE:
- Institution: {scoring.institution_name} (academic)
- Core themes: {themes}
- Target geographies: {geos}

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

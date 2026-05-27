"""
Opportunity Summarizer — generates a structured markdown AI summary for a grant opportunity.

The summary is specifically tailored for the LiGHT research group at EPFL, explaining:
- What the grant funds
- Eligibility requirements in plain language
- Key dates
- How LiGHT could apply and what projects to propose
- Budget and award details
- Immediate action items

Output is stored in Opportunity.ai_summary as markdown for rich rendering in the frontend.
"""
import json
import structlog
from app.ai.client import chat_complete
from app.config import get_settings

logger = structlog.get_logger()
settings = get_settings()

_SYSTEM_PROMPT = """\
You are a grant intelligence analyst for the LiGHT (Learning & Intelligent Health Technologies) \
research group at EPFL (École Polytechnique Fédérale de Lausanne). Your role is to write \
clear, actionable grant opportunity summaries for the team.

The LiGHT team focuses on:
- AI for health, clinical AI, foundation models, federated learning, edge AI
- Global health / LMIC: tuberculosis, maternal health, newborn health, POCUS/ultrasound
- Responsible AI, open-source AI, implementation science
- Partnerships across sub-Saharan Africa, South Asia, Southeast Asia
- Institution: EPFL (academic, Switzerland, EU)

Write summaries in structured markdown. Be concrete and practical — tell the team \
exactly what to do, what projects fit, and flag any eligibility concerns. \
Be direct, not verbose."""


async def generate_opportunity_summary(
    title: str,
    funder: str,
    description: str,
    eligibility: str = "",
    geography: str = "",
    award_min: float | None = None,
    award_max: float | None = None,
    currency: str = "USD",
    deadline: str = "",
    loi_deadline: str = "",
    thematic_areas: list[str] | None = None,
    opportunity_url: str = "",
    fit_score: float | None = None,
    fit_rationale: str = "",
) -> str:
    """
    Generate a structured markdown AI summary for a grant opportunity.

    Returns a markdown string with sections covering funding scope, eligibility,
    key dates, LiGHT fit, proposed projects, and action items.
    """
    scoring = settings.fit_scoring
    team_themes = ", ".join(scoring.team_themes[:15])
    team_geos = ", ".join(scoring.team_geographies)

    award_range = ""
    if award_min and award_max:
        award_range = f"{currency} {award_min:,.0f} – {award_max:,.0f}"
    elif award_max:
        award_range = f"Up to {currency} {award_max:,.0f}"
    elif award_min:
        award_range = f"From {currency} {award_min:,.0f}"
    else:
        award_range = "Not specified"

    themes_str = ", ".join(thematic_areas) if thematic_areas else "Not specified"

    user_prompt = f"""Generate a thorough, detailed grant opportunity summary for the LiGHT team.

GRANT DETAILS:
Title: {title}
Funder: {funder}
Award: {award_range}
Deadline: {deadline or "Not specified"}
LOI Deadline: {loi_deadline or "N/A"}
Geography: {geography or "Not specified"}
Thematic Areas: {themes_str}
Fit Score: {f"{fit_score:.0f}/100" if fit_score else "Not scored yet"}
URL: {opportunity_url or "N/A"}

DESCRIPTION:
{description or "No description available."}

ELIGIBILITY:
{eligibility or "Not specified."}

EXISTING FIT RATIONALE:
{fit_rationale or "None."}

TEAM PROFILE:
- Core themes: {team_themes}
- Target geographies: {team_geos}
- Institution: EPFL (academic, Switzerland, EU member)

Generate a comprehensive markdown summary using EXACTLY these sections (use ## for each header).
Be detailed and specific — this summary is used by the team to decide whether to pursue the grant
and to brief new team members. Do not be vague or generic.

## What This Grant Funds
2–3 paragraphs: what the funder is trying to achieve, the specific problem they want to solve,
the types of projects and approaches they want to support, and what a successful grantee looks like.

## Eligibility at a Glance
Bullet list of ALL key eligibility requirements. Flag any that LiGHT may not meet with ⚠️.
Include institution type, nationality, prior funding restrictions, co-PI requirements, etc.

## Key Dates
Bullet list: all deadlines (full proposal, LOI, concept note, questions), estimated announcement date if known.

## Fit for LiGHT / EPFL
3–4 sentences explaining why (or why not) this is a strong fit.
Reference specific LiGHT research areas, past projects, or capabilities that align.
Be honest about gaps or risks.

## Potential Projects to Propose
Bullet list of 4–6 concrete, specific project ideas LiGHT could submit, each 2–3 sentences.
Align each idea directly to the funder's stated priorities. Include rough methodologies.

## Partnership Opportunities
Which external partners, institutions, or NGOs would strengthen a LiGHT proposal for this call?
Mention specific organization types or named organizations if relevant.

## Budget & Award Details
Award size, duration, number of expected awards, indirect cost rules, cost-sharing requirements,
sub-award eligibility. Be specific about what can and cannot be funded.

## Risk Flags
Bullet list of reasons this grant might be difficult to win or implement for LiGHT.
Include competition level, eligibility uncertainty, scope mismatches, or capacity concerns.

## Action Items
Numbered list of concrete immediate next steps: who should be contacted, what documents to prepare,
internal discussions needed, and a realistic go/no-go decision timeline."""

    try:
        response = await chat_complete(
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            agent_name="opportunity_summarizer",
        )
        # Response is already markdown — return as-is
        return response.strip()
    except Exception as e:
        logger.error("Opportunity summarizer failed", title=title, error=str(e))
        return f"## Summary Unavailable\n\nFailed to generate AI summary: {e}"

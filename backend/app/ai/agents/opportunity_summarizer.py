"""
Opportunity Summarizer — translates, reformats, and summarises a grant opportunity.

Produces two distinct outputs:

  Global (org-agnostic) — stored in opportunities.ai_summary
  ─────────────────────
    short_description  — 2–3 sentence card teaser (plain prose, no markdown)
    full_summary       — markdown with sections: What This Grant Funds,
                         Eligibility at a Glance, Key Dates,
                         Budget & Award Details, Risk Flags

  Org-specific — stored in institution_opportunities.ai_summary
  ────────────
    org_summary        — markdown with sections: Fit Assessment,
                         Potential Projects to Propose
                         (generated only when org profile context is supplied)

Both are returned as a single JSON object so one LLM call handles
translation + formatting, regardless of the original source language.
"""
import json
import structlog
from app.ai.client import chat_complete

logger = structlog.get_logger()

_GLOBAL_SYSTEM_PROMPT = """\
You are a grant intelligence analyst. Your job is to read grant call text and
produce clear, objective, English-language summaries that any research team
can use to evaluate whether to apply.

IMPORTANT RULES:
1. ALL output must be in clear, fluent English — translate any non-English source text first.
2. Return ONLY a valid JSON object with exactly two keys: "short_description" and "full_summary".
3. Do not wrap the JSON in markdown code fences or add any text outside the JSON.
4. Write for a general research audience — do not assume any specific team context.

short_description format:
  2–3 sentences of plain prose (no markdown, no bullets). Clearly state what
  the grant funds, who is eligible, and the award size / deadline if known.
  Written for a researcher scanning a card who needs to decide in 5 seconds
  whether to click through.

full_summary format:
  Rich markdown document using ## headers. Use **bold** for key terms, bullet
  lists for eligibility / dates / action items, and normal paragraphs for
  explanatory sections. Be concrete — give the reader everything they need to
  assess eligibility and timeline at a glance."""

_ORG_SYSTEM_PROMPT = """\
You are a grant intelligence analyst helping a specific research team evaluate
a grant opportunity. Given a grant's core details and the team's research
profile, produce a concise, honest org-specific analysis.

IMPORTANT RULES:
1. Return ONLY a valid JSON object with exactly one key: "org_summary".
2. Do not wrap the JSON in markdown code fences or add any text outside the JSON.
3. Be honest about gaps and risks — do not over-sell fit.

org_summary format:
  Rich markdown document using ## headers. Use **bold** for key terms and
  bullet lists for action items."""


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
) -> dict:
    """
    Generate org-agnostic global sections for a grant opportunity.

    Returns a dict with:
      "short_description" — plain-prose English card teaser (2–3 sentences)
      "full_summary"      — markdown with global sections only
    """
    award_range = _format_award(award_min, award_max, currency)
    themes_str = ", ".join(thematic_areas) if thematic_areas else "Not specified"

    user_prompt = f"""Translate (if needed) and summarise this grant opportunity.
Return a JSON object with "short_description" and "full_summary".

─── SOURCE DETAILS ───────────────────────────────────────
Title:        {title}
Funder:       {funder}
Award:        {award_range}
Deadline:     {deadline or "Not specified"}
LOI Deadline: {loi_deadline or "N/A"}
Geography:    {geography or "Not specified"}
Themes:       {themes_str}
URL:          {opportunity_url or "N/A"}

DESCRIPTION (may be in any language — translate to English):
{description or "No description available."}

ELIGIBILITY (may be in any language — translate to English):
{eligibility or "Not specified."}
──────────────────────────────────────────────────────────

"short_description": 2–3 sentences of plain English prose for the opportunity
  card. State what the grant funds, who qualifies, and the award/deadline.
  No markdown.

"full_summary": Markdown document with EXACTLY these ## sections:

## What This Grant Funds
2–3 paragraphs: funder's goal, problem they want to solve, types of projects
supported, what a successful grantee looks like.

## Eligibility at a Glance
Bullet list of ALL eligibility requirements. Use ⚠️ to flag restrictive
requirements (institution type, nationality, prior funding restrictions, co-PI rules).

## Key Dates
Bullet list of all deadlines (full proposal, LOI, concept note, Q&A window).

## Budget & Award Details
Award size, duration, number of awards, indirect cost rules, sub-award eligibility.

## Risk Flags
Bullet list: competition level, eligibility uncertainty, scope mismatches,
capacity concerns that any applicant should weigh."""

    return await _call_summarizer(
        system_prompt=_GLOBAL_SYSTEM_PROMPT,
        user_prompt=user_prompt,
        title=title,
        expected_keys=["short_description", "full_summary"],
        fallback_key="full_summary",
    )


async def generate_org_sections(
    title: str,
    funder: str,
    description: str,
    institution_name: str,
    team_themes: list[str],
    team_geographies: list[str],
    fit_score: float | None = None,
    fit_rationale: str = "",
    eligibility: str = "",
    thematic_areas: list[str] | None = None,
) -> dict:
    """
    Generate org-specific sections (Fit Assessment, Potential Projects to Propose)
    for a particular institution.

    Returns a dict with:
      "org_summary" — markdown with org-specific sections only
    """
    themes_str = ", ".join(thematic_areas) if thematic_areas else "Not specified"
    team_themes_str = ", ".join(team_themes[:15]) if team_themes else "Not specified"
    team_geos_str = ", ".join(team_geographies) if team_geographies else "Not specified"

    user_prompt = f"""Evaluate this grant opportunity for the research team described below.
Return a JSON object with "org_summary".

─── GRANT DETAILS ────────────────────────────────────────
Title:         {title}
Funder:        {funder}
Themes:        {themes_str}
Fit Score:     {f"{fit_score:.0f}/100" if fit_score is not None else "Not scored"}
Fit Rationale: {fit_rationale or "None provided."}

DESCRIPTION EXCERPT:
{description[:2000] if description else "No description available."}

ELIGIBILITY EXCERPT:
{eligibility[:1000] if eligibility else "Not specified."}

─── TEAM PROFILE ─────────────────────────────────────────
Institution:        {institution_name or "Not specified"}
Core themes:        {team_themes_str}
Target geographies: {team_geos_str}
──────────────────────────────────────────────────────────

"org_summary": Markdown document with EXACTLY these ## sections:

## Fit Assessment
3–4 sentences on why (or why not) this is a strong fit for this specific team.
Reference the funder's stated priorities and the team's research themes.
Be honest about gaps or risks. Reference the fit score if available.

## Potential Projects to Propose
4–6 concrete project ideas this team could submit, each 2–3 sentences.
Align each to the funder's stated priorities with rough methodology."""

    return await _call_summarizer(
        system_prompt=_ORG_SYSTEM_PROMPT,
        user_prompt=user_prompt,
        title=title,
        expected_keys=["org_summary"],
        fallback_key="org_summary",
    )


def _format_award(award_min: float | None, award_max: float | None, currency: str) -> str:
    if award_min and award_max:
        return f"{currency} {award_min:,.0f} – {award_max:,.0f}"
    elif award_max:
        return f"Up to {currency} {award_max:,.0f}"
    elif award_min:
        return f"From {currency} {award_min:,.0f}"
    return "Not specified"


async def _call_summarizer(
    system_prompt: str,
    user_prompt: str,
    title: str,
    expected_keys: list[str],
    fallback_key: str,
) -> dict:
    try:
        raw = await chat_complete(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            agent_name="opportunity_summarizer",
        )
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("```", 2)[1]
            if cleaned.startswith("json"):
                cleaned = cleaned[4:]
            cleaned = cleaned.rsplit("```", 1)[0].strip()

        result = json.loads(cleaned)
        return {k: result.get(k, "").strip() for k in expected_keys}
    except json.JSONDecodeError:
        logger.warning(
            "Opportunity summarizer returned non-JSON, using as fallback",
            title=title,
            fallback_key=fallback_key,
        )
        fallback = raw.strip() if raw else f"## Summary Unavailable\n\nFailed to parse AI response."
        return {k: (fallback if k == fallback_key else "") for k in expected_keys}
    except Exception as e:
        logger.error("Opportunity summarizer failed", title=title, error=str(e))
        return {k: (f"## Summary Unavailable\n\nFailed to generate AI summary: {e}" if k == fallback_key else "") for k in expected_keys}

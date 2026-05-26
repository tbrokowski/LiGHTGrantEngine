"""Style Reviewer — compare draft against archive-derived style profile."""
import json
from app.ai.client import chat_complete

SYSTEM_PROMPT = """You are a grant writing style reviewer for the LiGHT group at EPFL.
Compare proposal drafts against the institutional style profile and archive exemplars.
Respond with valid JSON."""


async def review_style(
    proposal_draft: str,
    style_profile: dict,
    archive_exemplars: list[dict] | None = None,
) -> dict:
    exemplar_str = ""
    if archive_exemplars:
        for s in archive_exemplars[:3]:
            exemplar_str += f"\n[{s.get('section_type', '?')} — {s.get('grant_title', '?')}]\n{s.get('full_text', '')[:1000]}\n"

    user_prompt = f"""Review this proposal draft for style alignment.

STYLE PROFILE:
{json.dumps(style_profile, indent=2)[:3000]}

ARCHIVE EXEMPLARS:
{exemplar_str or 'None provided'}

PROPOSAL DRAFT:
{proposal_draft[:12000]}

Return JSON with:
- match_score: 0-100 overall style match
- section_scores: list of {{section, score, notes}}
- deviations: list of {{section, issue, suggestion, severity: high|medium|low}}
- strengths: list of style strengths
- recommended_rewrites: list of {{section, original_excerpt, suggested_rewrite}}
"""

    response = await chat_complete(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        agent_name="style_reviewer",
        json_mode=True,
    )
    try:
        return json.loads(response)
    except json.JSONDecodeError:
        return {"match_score": 0, "error": "Style review failed", "raw": response}

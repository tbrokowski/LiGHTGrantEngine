"""Intro Architect — draft introduction following the 6-beat narrative arc."""
import json
from app.ai.client import chat_complete
from app.ai.context.grant_context import DEFAULT_INTRO_ARC

SYSTEM_PROMPT = """You are an expert grant writer specializing in compelling proposal introductions.
Follow the 6-beat narrative arc precisely. Write in the institutional style provided.
Respond with valid JSON."""


async def draft_introduction(
    grant_idea: str,
    call_requirements: str,
    evaluation_criteria: list[str],
    intro_arc: list[dict] | None = None,
    style_profile: dict | None = None,
    style_exemplars: list[dict] | None = None,
    retrieved_sections: list[dict] | None = None,
    citations: list[dict] | None = None,
    funder: str = "",
    word_limit: int | None = None,
) -> dict:
    arc = intro_arc or DEFAULT_INTRO_ARC
    arc_str = "\n".join(
        f"{i + 1}. {beat.get('label', beat.get('beat', ''))}: {beat.get('guidance', '')}"
        for i, beat in enumerate(arc)
    )

    prior_str = ""
    if retrieved_sections:
        prior_str += "\nCONTENT EXEMPLARS (substance reference):\n"
        for s in retrieved_sections[:3]:
            prior_str += f"\n--- {s.get('section_type', '?')} from {s.get('grant_title', '?')} ---\n{s.get('full_text', '')[:1500]}\n"

    if style_exemplars:
        prior_str += "\nSTYLE EXEMPLARS (match voice and openings):\n"
        for s in style_exemplars[:3]:
            prior_str += f"\n--- {s.get('section_type', '?')} from {s.get('grant_title', '?')} ({s.get('outcome', '?')}) ---\n{s.get('full_text', '')[:1200]}\n"

    cite_str = ""
    if citations:
        cite_str = "\nAVAILABLE CITATIONS:\n" + "\n".join(
            f"- {c.get('formatted_citation', c.get('title', ''))}" for c in citations[:8]
        )

    limit_str = f"TARGET: ~{word_limit} words\n" if word_limit else ""

    user_prompt = f"""Draft the Introduction section for a grant proposal.

FUNDER: {funder}
{limit_str}
GRANT IDEA:
{grant_idea[:2000]}

CALL REQUIREMENTS:
{call_requirements[:3000]}

EVALUATION CRITERIA:
{chr(10).join(f'- {c}' for c in evaluation_criteria)}

NARRATIVE ARC (follow this structure exactly):
{arc_str}

STYLE PROFILE:
{json.dumps(style_profile or {}, indent=2)[:2000]}

ARCHIVE EXEMPLARS:
{prior_str}
{cite_str}

Write the introduction following all 6 beats in order. Use [CUSTOMIZE:] and [VERIFY:] markers where needed.

Return JSON with:
- draft: the full introduction text (HTML paragraphs allowed)
- beats_covered: list of {{beat, excerpt}} showing each beat was addressed
- citations_used: list of citations incorporated
- word_count: int
- assumptions: list
- customization_points: list
- warnings: list
"""

    response = await chat_complete(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        agent_name="intro_architect",
        json_mode=True,
    )
    try:
        return json.loads(response)
    except json.JSONDecodeError:
        return {"draft": "", "error": "Intro drafting failed", "raw": response}

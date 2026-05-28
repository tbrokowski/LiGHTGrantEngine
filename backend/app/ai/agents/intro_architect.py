"""
Intro Architect — expands the user-authored skeleton into a full introduction
following the 6-beat narrative arc. The skeleton content is the primary input;
call requirements serve as compliance guidance.
"""
import json
from app.ai.client import chat_complete
from app.ai.context.grant_context import DEFAULT_INTRO_ARC

SYSTEM_PROMPT = """You are an expert grant writer specializing in compelling proposal introductions.

YOUR PRIMARY JOB:
Take the team's skeleton content for the introduction and expand it into a full, compelling
opening section following the 6-beat narrative arc. Preserve the team's framing and key claims;
enrich with evidence, specificity, and narrative momentum.

Follow the 6-beat narrative arc precisely. Write in the institutional style provided.
Call requirements are compliance guidance — ensure key funder themes are woven in naturally.
Respond with valid JSON."""


async def draft_introduction(
    grant_idea: str,
    call_requirements: str,
    evaluation_criteria: list[str] = None,
    intro_arc: list[dict] | None = None,
    style_profile: dict | None = None,
    style_exemplars: list[dict] | None = None,
    retrieved_sections: list[dict] | None = None,
    citations: list[dict] | None = None,
    funder: str = "",
    word_limit: int | None = None,
    skeleton_content: str = "",
    compliance_guidance: str = "",
    evidence_summary: str = "",
    narrative_context: dict | None = None,
    user_instructions: str = "",
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
            prior_str += f"\n--- {s.get('section_type', '?')} from {s.get('grant_title', '?')} ---\n{s.get('full_text', '')[:4000]}\n"

    if style_exemplars:
        prior_str += "\nSTYLE EXEMPLARS (match voice and openings):\n"
        for s in style_exemplars[:3]:
            prior_str += f"\n--- {s.get('section_type', '?')} from {s.get('grant_title', '?')} ({s.get('outcome', '?')}) ---\n{s.get('full_text', '')[:3000]}\n"

    cite_str = ""
    if citations:
        cite_str = "\nAVAILABLE CITATIONS:\n" + "\n".join(
            f"- {c.get('formatted_citation', c.get('title', ''))}" for c in citations[:8]
        )

    limit_str = f"TARGET: ~{word_limit} words\n" if word_limit else ""

    narrative_ctx = narrative_context or {}
    theory_of_change = narrative_ctx.get("theory_of_change", "")
    funder_priorities = "\n".join(
        f"- {p}" for p in narrative_ctx.get("funder_priorities_to_emphasize", [])
    )

    skeleton_block = (
        f"\nSKELETON CONTENT (team-authored — EXPAND THIS, preserve the framing):\n{skeleton_content}\n"
        if skeleton_content else ""
    )
    evidence_block = (
        f"\nRESEARCH EVIDENCE SUMMARY (weave in naturally):\n{evidence_summary}\n"
        if evidence_summary else ""
    )
    compliance_block = (
        f"\nCOMPLIANCE COVERAGE NOTES (ensure these themes appear across the 6 beats):\n{compliance_guidance}\n"
        if compliance_guidance else ""
    )

    user_instructions_block = (
        f"\nSPECIFIC REVISION INSTRUCTIONS (incorporate these changes):\n{user_instructions}\n"
        if user_instructions else ""
    )
    eval_criteria = evaluation_criteria or []

    user_prompt = f"""Expand the skeleton content below into a full Introduction section for a grant proposal.
Follow the 6-beat narrative arc, preserving the team's framing and voice.

FUNDER: {funder}
{limit_str}

GRANT IDEA:
{grant_idea[:4000]}

OVERALL NARRATIVE CONTEXT:
Theory of change: {theory_of_change or 'See grant idea and skeleton'}
{f'Funder priorities to emphasise:{chr(10)}{funder_priorities}' if funder_priorities else ''}
{skeleton_block}
{evidence_block}
{compliance_block}
{user_instructions_block}

CALL REQUIREMENTS (guidance — ensure key funder themes are woven in):
{call_requirements[:4000]}

EVALUATION CRITERIA (address across the 6 beats):
{chr(10).join(f'- {c}' for c in eval_criteria)}

NARRATIVE ARC (follow this structure exactly):
{arc_str}

STYLE PROFILE:
{json.dumps(style_profile or {}, indent=2)[:4000]}

ARCHIVE EXEMPLARS:
{prior_str}
{cite_str}

Expand the skeleton into the full introduction following all 6 beats in order.
Preserve the team's voice. Use [CUSTOMIZE:] and [VERIFY:] markers where needed.

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

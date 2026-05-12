"""
Agent 5: Section Drafting Assistant
Drafts individual proposal sections using retrieved prior material.
Drafts section-by-section, never a full proposal in one pass.
"""
from app.ai.client import chat_complete

SYSTEM_PROMPT = """You are an expert scientific proposal writer for global health AI research at EPFL (LiGHT group).
You draft proposal sections by combining call requirements with institutional experience.

IMPORTANT RULES:
1. Always cite which prior materials you used
2. Flag any assumptions you made
3. Mark text that must be customized for this specific call [CUSTOMIZE: reason]
4. Do not directly reproduce restricted text — paraphrase or note permission status
5. Never claim facts you don't know; use [VERIFY: item] for uncertain claims
6. Write for the intended funder's evaluation criteria
"""

async def draft_section(
    section_name: str,
    section_type: str,
    call_requirements: str,
    evaluation_criteria: list[str] = None,
    retrieved_sections: list[dict] = None,
    reusable_language: list[dict] = None,
    word_limit: int = None,
    user_instructions: str = "",
    funder: str = "",
) -> dict:
    """
    Draft a proposal section.

    Returns:
        {
          "draft": str,
          "word_count": int,
          "sources_used": [{"title": str, "type": str, "permission": str}],
          "assumptions": [str],
          "customization_points": [str],
          "warnings": [str],
          "suggested_next_edits": [str],
          "human_review_required": bool,
        }
    """
    prior_str = ""
    if retrieved_sections:
        prior_str = "\n\nRELEVANT PRIOR SECTIONS (use as context and inspiration):\n"
        for s in retrieved_sections[:4]:
            perm = s.get("reuse_permission", "context_only")
            warnings = s.get("warnings", [])
            prior_str += f"\n--- {s.get('section_type','?')} from {s.get('grant_title','?')} ({s.get('funder','?')}, {s.get('outcome','?')}) | Permission: {perm}"
            if warnings:
                prior_str += f" | WARNINGS: {'; '.join(warnings)}"
            prior_str += f"\n{s.get('full_text','')[:1500]}\n"

    lang_str = ""
    if reusable_language:
        lang_str = "\n\nAPPROVED REUSABLE LANGUAGE:\n"
        for block in reusable_language[:3]:
            note = " [PARAPHRASE ONLY]" if block.get("paraphrase_only") else " [DIRECT USE OK]"
            lang_str += f"\n{block.get('title','?')}{note}:\n{block.get('full_text','')[:800]}\n"

    limit_str = f"TARGET LENGTH: ~{word_limit} words.\n" if word_limit else ""

    user_prompt = f"""Draft the {section_name} section for a grant proposal.

FUNDER: {funder}
SECTION TYPE: {section_type}
{limit_str}
CALL REQUIREMENTS FOR THIS SECTION:
{call_requirements}

EVALUATION CRITERIA TO ADDRESS:
{chr(10).join(f'- {c}' for c in (evaluation_criteria or []))}

{f'ADDITIONAL INSTRUCTIONS: {user_instructions}' if user_instructions else ''}
{prior_str}
{lang_str}

Write the section now. Then provide:
1. A list of sources_used with title, type (section/language_block), and permission status
2. A list of assumptions you made
3. A list of customization_points that must be tailored
4. Any warnings about restricted content
5. Suggested next edits

Return as a JSON object with: draft, word_count, sources_used, assumptions, customization_points, warnings, suggested_next_edits, human_review_required."""

    response = await chat_complete(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        agent_name="section_drafter",
        json_mode=True,
    )
    import json
    try:
        return json.loads(response)
    except json.JSONDecodeError:
        return {
            "draft": response,
            "word_count": len(response.split()),
            "sources_used": [],
            "assumptions": [],
            "customization_points": [],
            "warnings": ["Response was not valid JSON — review draft manually"],
            "human_review_required": True,
        }

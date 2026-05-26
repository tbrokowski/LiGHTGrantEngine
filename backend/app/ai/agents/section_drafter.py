"""
Agent 5: Section Drafting Assistant
Drafts individual proposal sections using retrieved prior material.
"""
import json
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
7. Match the institutional style profile when provided
"""


async def draft_section(
    section_name: str,
    section_type: str,
    call_requirements: str,
    evaluation_criteria: list[str] = None,
    retrieved_sections: list[dict] = None,
    style_exemplars: list[dict] = None,
    reusable_language: list[dict] = None,
    word_limit: int = None,
    user_instructions: str = "",
    funder: str = "",
    style_profile: dict | None = None,
    prior_sections_summary: str = "",
    citations: list[dict] | None = None,
    grant_idea: str = "",
) -> dict:
    prior_str = ""
    if retrieved_sections:
        prior_str = "\n\nCONTENT EXEMPLARS (substance and topic reference):\n"
        for s in retrieved_sections[:4]:
            perm = s.get("reuse_permission", "context_only")
            warnings = s.get("warnings", [])
            prior_str += f"\n--- {s.get('section_type','?')} from {s.get('grant_title','?')} ({s.get('funder','?')}, {s.get('outcome','?')}) | Permission: {perm}"
            if warnings:
                prior_str += f" | WARNINGS: {'; '.join(warnings)}"
            prior_str += f"\n{s.get('full_text','')[:1500]}\n"

    if style_exemplars:
        prior_str += "\n\nSTYLE EXEMPLARS (match voice, tone, and paragraph patterns):\n"
        for s in style_exemplars[:3]:
            prior_str += f"\n--- {s.get('section_type','?')} from {s.get('grant_title','?')} ({s.get('outcome','?')}) ---\n{s.get('full_text','')[:1200]}\n"

    lang_str = ""
    if reusable_language:
        lang_str = "\n\nAPPROVED REUSABLE LANGUAGE:\n"
        for block in reusable_language[:3]:
            note = " [PARAPHRASE ONLY]" if block.get("paraphrase_only") else " [DIRECT USE OK]"
            lang_str += f"\n{block.get('title','?')}{note}:\n{block.get('full_text','')[:800]}\n"

    cite_str = ""
    if citations:
        cite_str = "\n\nCITATIONS TO USE:\n" + "\n".join(
            f"- {c.get('formatted_citation', c.get('title', ''))}" for c in citations[:6]
        )

    style_str = ""
    if style_profile:
        style_str = f"\n\nSTYLE PROFILE:\n{json.dumps(style_profile, indent=2)[:2000]}\n"

    limit_str = f"TARGET LENGTH: ~{word_limit} words.\n" if word_limit else ""

    user_prompt = f"""Draft the {section_name} section for a grant proposal.

FUNDER: {funder}
SECTION TYPE: {section_type}
{limit_str}
GRANT IDEA:
{grant_idea[:1500] if grant_idea else 'See call requirements'}

CALL REQUIREMENTS FOR THIS SECTION:
{call_requirements}

EVALUATION CRITERIA TO ADDRESS:
{chr(10).join(f'- {c}' for c in (evaluation_criteria or []))}

PRIOR SECTIONS SUMMARY (maintain narrative continuity):
{prior_sections_summary[:2000] if prior_sections_summary else 'This may be the first section.'}

{f'ADDITIONAL INSTRUCTIONS: {user_instructions}' if user_instructions else ''}
{style_str}
{prior_str}
{lang_str}
{cite_str}

Write the section now. Return JSON with: draft, word_count, sources_used, assumptions,
customization_points, warnings, suggested_next_edits, human_review_required."""

    response = await chat_complete(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        agent_name="section_drafter",
        json_mode=True,
    )
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

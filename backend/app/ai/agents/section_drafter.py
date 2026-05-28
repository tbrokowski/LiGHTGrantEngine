"""
Agent 5: Section Drafting Assistant
Expands user-authored skeleton content into a full, polished draft section.
The skeleton content is the primary structural and tonal foundation; call requirements
serve as compliance guidance to verify coverage, not as the section's driver.
"""
import json
from app.ai.client import chat_complete

SYSTEM_PROMPT = """You are an expert scientific proposal writer for global health AI research at EPFL (LiGHT group).
You expand user-authored skeleton content into full, compelling proposal sections.

YOUR PRIMARY JOB:
Take the skeleton content the team has written and expand it into a complete, polished section.
Preserve the team's voice, framing, and structure — your job is to make it fuller and stronger,
not to rewrite it from scratch according to the call requirements.

WRITING STANDARDS:
- Expand and enrich the skeleton prose; do not discard or overwrite the team's content and framing
- Write comprehensive, substantive prose — full paragraphs with evidence and reasoning, not bullet points
- Be specific and concrete: name methodologies, data sources, geographies, and outcomes
- Aim for the upper end of any word limit; reviewers reward completeness
- Incorporate research evidence and citations naturally into the expanded prose
- Connect to the grant's overall theory of change and the funder's goals

COMPLIANCE GUIDANCE (verify coverage, do not restructure around these):
1. Check the compliance notes and ensure the key call coverage areas are addressed somewhere in the section
2. Strictly respect any per-section word/page limits from the call
3. Mark text that must be customized for this specific call with [CUSTOMIZE: reason]
4. Do not directly reproduce restricted text — paraphrase or note permission status
5. Never claim facts you don't know; use [VERIFY: item] for uncertain claims
6. Match the institutional style profile when provided
7. Flag any compliance risks with [COMPLIANCE RISK: description]
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
    section_specific_requirements: dict | None = None,
    call_narrative_brief: str = "",
    skeleton_content: str = "",
    compliance_guidance: str = "",
    evidence_summary: str = "",
    narrative_context: dict | None = None,
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
            prior_str += f"\n{s.get('full_text','')[:4000]}\n"

    if style_exemplars:
        prior_str += "\n\nSTYLE EXEMPLARS (match voice, tone, and paragraph patterns):\n"
        for s in style_exemplars[:3]:
            prior_str += f"\n--- {s.get('section_type','?')} from {s.get('grant_title','?')} ({s.get('outcome','?')}) ---\n{s.get('full_text','')[:3000]}\n"

    lang_str = ""
    if reusable_language:
        lang_str = "\n\nAPPROVED REUSABLE LANGUAGE:\n"
        for block in reusable_language[:3]:
            note = " [PARAPHRASE ONLY]" if block.get("paraphrase_only") else " [DIRECT USE OK]"
            lang_str += f"\n{block.get('title','?')}{note}:\n{block.get('full_text','')[:2000]}\n"

    cite_str = ""
    if citations:
        cite_str = "\n\nCITATIONS TO USE:\n" + "\n".join(
            f"- {c.get('formatted_citation', c.get('title', ''))}" for c in citations[:6]
        )

    style_str = ""
    if style_profile:
        style_str = f"\n\nSTYLE PROFILE:\n{json.dumps(style_profile, indent=2)[:6000]}\n"

    # Per-section word/page limit from call analysis takes precedence over generic limit
    sec_req = section_specific_requirements or {}
    effective_word_limit = sec_req.get("word_limit") or word_limit
    effective_page_limit = sec_req.get("page_limit")
    sec_priority = sec_req.get("priority", "medium")
    sec_specific_reqs = sec_req.get("requirements", "")

    limit_parts = []
    if effective_word_limit:
        limit_parts.append(f"WORD LIMIT: {effective_word_limit} words (write close to this limit — reviewers expect full use)")
    if effective_page_limit:
        limit_parts.append(f"PAGE LIMIT: {effective_page_limit}")
    limit_str = "\n".join(limit_parts)

    narrative_ctx = narrative_context or {}
    theory_of_change = narrative_ctx.get("theory_of_change", "")
    cross_themes = ", ".join(narrative_ctx.get("cross_section_themes", []))
    funder_priorities = "\n".join(
        f"- {p}" for p in narrative_ctx.get("funder_priorities_to_emphasize", [])
    )

    skeleton_block = (
        f"\nSKELETON CONTENT (team-authored — EXPAND THIS, do not replace it):\n{skeleton_content}\n"
        if skeleton_content else ""
    )
    evidence_block = (
        f"\nRESEARCH EVIDENCE SUMMARY (incorporate naturally where relevant):\n{evidence_summary}\n"
        if evidence_summary else ""
    )
    compliance_block = (
        f"\nCOMPLIANCE COVERAGE NOTES (verify these themes are addressed; do not restructure around them):\n{compliance_guidance}\n"
        if compliance_guidance else ""
    )

    user_prompt = f"""Expand the skeleton content below into a comprehensive, detailed {section_name} section for a grant proposal.
Your job is to take the team's draft and make it fuller, stronger, and more compelling — preserve their framing and voice.

FUNDER: {funder}
SECTION TYPE: {section_type}
SECTION PRIORITY: {sec_priority.upper()}
{limit_str}

GRANT IDEA:
{grant_idea[:4000] if grant_idea else 'See skeleton content'}

OVERALL NARRATIVE CONTEXT:
Theory of change: {theory_of_change or 'See grant idea'}
Cross-section themes to maintain: {cross_themes or 'Coherence and impact'}
{f'Funder priorities to emphasise:{chr(10)}{funder_priorities}' if funder_priorities else ''}
{skeleton_block}
{evidence_block}
{compliance_block}

CALL NARRATIVE BRIEF (overall funder goals — treat as guidance):
{call_narrative_brief[:6000] if call_narrative_brief else call_requirements[:4000]}

EVALUATION CRITERIA (ensure these are addressed somewhere in the expanded section):
{chr(10).join(f'- {c}' for c in (evaluation_criteria or []))}

PRIOR SECTIONS SUMMARY (maintain narrative continuity and avoid repetition):
{prior_sections_summary[:4000] if prior_sections_summary else 'This may be the first section.'}

{f'ADDITIONAL INSTRUCTIONS: {user_instructions}' if user_instructions else ''}
{style_str}
{prior_str}
{lang_str}
{cite_str}

Expand the skeleton content into a complete section now. Write in full paragraphs, not bullet points.
Preserve the team's voice and structure; enrich with evidence and specificity.
Every key claim should be supported or flagged with [VERIFY:].

Return JSON with:
- draft: the full expanded section text (HTML paragraphs preferred)
- word_count: approximate word count
- sources_used: list of archive/exemplar sources referenced
- assumptions: list of assumptions made
- customization_points: list of [CUSTOMIZE] flags and what is needed
- warnings: list of any issues, compliance risks, or areas needing human review
- suggested_next_edits: specific improvements a human reviewer should make
- human_review_required: true/false
- evaluation_criteria_addressed: list of criteria explicitly addressed in this draft"""

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

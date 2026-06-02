"""Expand or compress draft sections to meet word targets."""
from __future__ import annotations
import json
from app.ai.client import chat_complete

async def expand_section(
    section_name: str,
    draft_html: str,
    target_words: int,
    min_words: int,
    grant_idea: str = "",
    evidence_summary: str = "",
    key_evidence: list | None = None,
    retrieved_sections: list | None = None,
) -> str:
    current = len(draft_html.split())
    if current >= min_words:
        return draft_html
    archive_snip = ""
    if retrieved_sections:
        archive_snip = "\nARCHIVE EXCERPTS:\n" + "\n".join(
            (s.get("full_text") or "")[:1500] for s in retrieved_sections[:3]
        )
    ke_snip = ""
    if key_evidence:
        ke_snip = "\nKEY EVIDENCE:\n" + "\n".join(
            str(e) if isinstance(e, str) else f"- {e.get('claim', '')}" for e in key_evidence[:8]
        )

    prompt = f"""Expand this grant proposal section to at least {min_words} words (target {target_words}).
Preserve structure and voice. Add specific evidence, methods, and archive-grounded detail.
Do not add generic filler.

SECTION: {section_name}
GRANT IDEA: {grant_idea[:2000]}
EVIDENCE: {evidence_summary[:1500]}
{ke_snip}
{archive_snip}

CURRENT DRAFT ({current} words):
{draft_html[:12000]}

Return JSON: {{"draft": "full HTML section"}}"""
    resp = await chat_complete(
        messages=[{"role": "user", "content": prompt}],
        agent_name="section_expander",
        json_mode=True,
    )
    try:
        return json.loads(resp).get("draft") or draft_html
    except Exception:
        return draft_html


async def compress_section(
    section_name: str,
    draft_html: str,
    max_words: int,
) -> str:
    current = len(draft_html.split())
    if current <= int(max_words * 1.1):
        return draft_html
    prompt = f"""Compress this section to at most {max_words} words without losing key technical claims.

SECTION: {section_name}
DRAFT ({current} words):
{draft_html[:15000]}

Return JSON: {{"draft": "compressed HTML"}}"""
    resp = await chat_complete(
        messages=[{"role": "user", "content": prompt}],
        agent_name="section_compressor",
        json_mode=True,
    )
    try:
        return json.loads(resp).get("draft") or draft_html
    except Exception:
        return draft_html

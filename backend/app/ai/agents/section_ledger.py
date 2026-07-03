"""
Document ledger — a compact, factual running record of completed sections.

Replaces compress_prior_sections' lossy prose-digest approach. Each entry is a
tight, structured extraction (not a re-summarized paragraph), so later sections
get real facts about earlier ones instead of a paraphrase of a paraphrase.
Rendered compactly for all completed sections except the ones immediately
preceding the section being drafted, which get their full text instead —
adjacent sections need full context for local coherence/transitions; distant
sections only need the facts a later section must stay consistent with.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field

from app.ai.client import chat_complete


@dataclass
class LedgerEntry:
    section_name: str
    key_claims: list[str] = field(default_factory=list)
    named_entities: list[str] = field(default_factory=list)
    citations_used: list[str] = field(default_factory=list)
    commitments: list[str] = field(default_factory=list)


_SYSTEM_PROMPT = """Extract a tight factual record of a completed grant-proposal section for
downstream sections to stay consistent with. Do NOT summarize the prose — extract facts.

Return JSON:
{
  "key_claims": ["3-5 specific factual or quantitative claims made in this section"],
  "named_entities": ["programs, tools, datasets, platforms, partners, technologies introduced by name"],
  "citations_used": ["(Author, Year) markers already used in this section"],
  "commitments": ["promises this section makes that later sections must honor — deliverables, timelines, roles"]
}

Keep every list short (3-6 items max) and every item under 15 words. Omit fields with nothing to report
as empty lists. Extract only what's explicitly stated — do not infer or invent."""


async def build_ledger_entry(section_name: str, section_html: str) -> LedgerEntry:
    """One small, cheap LLM call per completed section."""
    if not (section_html or "").strip():
        return LedgerEntry(section_name=section_name)
    try:
        response = await chat_complete(
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": f"SECTION: {section_name}\n\n{section_html[:8000]}"},
            ],
            agent_name="section_ledger",
            json_mode=True,
        )
        data = json.loads(response)
        return LedgerEntry(
            section_name=section_name,
            key_claims=list(data.get("key_claims") or [])[:5],
            named_entities=list(data.get("named_entities") or [])[:6],
            citations_used=list(data.get("citations_used") or [])[:8],
            commitments=list(data.get("commitments") or [])[:5],
        )
    except Exception:
        return LedgerEntry(section_name=section_name)


def render_ledger_for_prompt(entries: list[LedgerEntry]) -> str:
    """Compact bullet-list rendering of the ledger for sections beyond the adjacent window."""
    if not entries:
        return ""
    lines: list[str] = []
    for e in entries:
        parts = []
        if e.key_claims:
            parts.append("claims: " + "; ".join(e.key_claims))
        if e.named_entities:
            parts.append("named: " + ", ".join(e.named_entities))
        if e.citations_used:
            parts.append("cites: " + ", ".join(e.citations_used))
        if e.commitments:
            parts.append("commits: " + "; ".join(e.commitments))
        if parts:
            lines.append(f"- {e.section_name} — " + " | ".join(parts))
        else:
            lines.append(f"- {e.section_name} — (no extractable facts)")
    return "\n".join(lines)

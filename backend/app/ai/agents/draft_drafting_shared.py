"""Shared helpers for specialized section drafters."""
from __future__ import annotations

def format_evidence_context(
    retrieved_sections: list[dict] | None,
    style_exemplars: list[dict] | None,
    reusable_language: list[dict] | None,
    concept_bundles: list[dict] | None,
    evidence_summary: str = "",
    citations: list[dict] | None = None,
) -> str:
    parts = []
    if evidence_summary:
        parts.append(f"RESEARCH EVIDENCE:\n{evidence_summary}")
    if concept_bundles:
        parts.append("ENTITY / ARCHIVE CONTEXT (use for MOOVE, DISCO, named programs):")
        for b in concept_bundles[:5]:
            if b.get("full_text"):
                parts.append(f"--- {b.get('grant_title','?')} ---\n{b['full_text'][:2000]}")
    if retrieved_sections:
        parts.append("CONTENT EXEMPLARS:")
        for s in retrieved_sections[:4]:
            parts.append(f"--- {s.get('grant_title','?')} ({s.get('outcome','?')}) ---\n{s.get('full_text','')[:4000]}")
    if style_exemplars:
        parts.append("STYLE EXEMPLARS:")
        for s in style_exemplars[:2]:
            parts.append(s.get("full_text", "")[:2000])
    if reusable_language:
        parts.append("REUSABLE LANGUAGE:")
        for b in reusable_language[:2]:
            parts.append(b.get("full_text", "")[:1500])
    if citations:
        parts.append("CITATIONS:\n" + "\n".join(
            f"- {c.get('formatted_citation', c.get('title',''))}" for c in citations[:8]
        ))
    return "\n\n".join(parts)


def word_target_block(target_words: int | None, min_words: int | None) -> str:
    if not target_words:
        return ""
    mn = min_words or int(target_words * 0.9)
    return (
        f"WORD TARGET: Write {mn}-{target_words} words. "
        f"This is a minimum requirement — under-length sections fail review."
    )

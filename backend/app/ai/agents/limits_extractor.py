"""
Limits Extractor — extract verbatim page/word limits from call documents.
"""
from __future__ import annotations

import json

from app.ai.client import chat_complete

SYSTEM_PROMPT = """You are a grant compliance analyst extracting FORMAT and LENGTH limits from a funding call.

Extract ONLY limits explicitly stated in the document. For each limit include a verbatim quote.
Distinguish:
- total_page_limit: entire application package including annexes
- narrative_page_limit: main proposal body only (if stated separately)
- annex_page_limit: annexes only (if stated)
- total_word_limit: document-level word count if stated
- per_section_limits: only when the call gives explicit limits per section

Return valid JSON only."""


async def extract_limits(
    call_requirements: str,
    call_analysis: dict,
    funder: str = "",
    title: str = "",
) -> dict:
    """
    Returns:
      {
        "total_page_limit": str|null,
        "narrative_page_limit": int|null,
        "annex_page_limit": int|null,
        "total_word_limit": int|null,
        "per_section_limits": {section_name: {word_limit, page_limit, quote}},
        "sources": [{field, quote, page_or_section}],
        "extraction_notes": str
      }
    """
    ca_summary = {
        "page_limit": call_analysis.get("page_limit"),
        "word_limit": call_analysis.get("word_limit"),
        "format_requirements": (call_analysis.get("format_requirements") or "")[:1500],
        "required_sections": call_analysis.get("required_sections") or [],
        "section_requirements": {
            k: {
                "word_limit": v.get("word_limit") if isinstance(v, dict) else None,
                "page_limit": v.get("page_limit") if isinstance(v, dict) else None,
            }
            for k, v in (call_analysis.get("section_requirements") or {}).items()
            if isinstance(v, dict)
        },
    }

    user_prompt = f"""GRANT: {title}
FUNDER: {funder}

CALL REQUIREMENTS TEXT (primary source):
{(call_requirements or 'Not provided')[:12000]}

PRIOR EXTRACTION (may contain errors — verify against text above):
{json.dumps(ca_summary, indent=2)[:4000]}

Return JSON:
{{
  "total_page_limit": "string or null — e.g. '70 pages'",
  "narrative_page_limit": int or null,
  "annex_page_limit": int or null,
  "total_word_limit": int or null,
  "per_section_limits": {{
    "Section Name": {{
      "word_limit": int or null,
      "page_limit": "string or null",
      "quote": "verbatim from call"
    }}
  }},
  "sources": [
    {{"field": "total_page_limit", "quote": "...", "page_or_section": "..."}}
  ],
  "extraction_notes": "brief notes on ambiguities"
}}"""

    try:
        response = await chat_complete(
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            agent_name="limits_extractor",
            json_mode=True,
        )
        return json.loads(response)
    except Exception:
        return _fallback_from_call_analysis(call_analysis)


def _fallback_from_call_analysis(call_analysis: dict) -> dict:
    from app.ai.services.constraint_allocator import parse_int_limit

    return {
        "total_page_limit": call_analysis.get("page_limit"),
        "narrative_page_limit": None,
        "annex_page_limit": None,
        "total_word_limit": parse_int_limit(call_analysis.get("word_limit")),
        "per_section_limits": {},
        "sources": [],
        "extraction_notes": "Fallback from call_analysis only.",
    }

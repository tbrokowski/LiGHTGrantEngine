"""
Limits Verifier — cross-check extracted limits against call source text.
"""
from __future__ import annotations

import json

from app.ai.client import chat_complete

SYSTEM_PROMPT = """You verify grant call limit extractions against the original call text.

Assign confidence:
- high: quotes match clearly, no contradictions
- medium: limits plausible but partial or annex/narrative split unclear
- low: contradictions, missing quotes, or likely misread (e.g. 70 pages is total package not narrative)

Return valid JSON only."""


async def verify_limits(
    extracted: dict,
    call_requirements: str,
    call_analysis: dict | None = None,
) -> dict:
    """
    Returns:
      {
        "confidence": "high"|"medium"|"low",
        "verified": { ... corrected limits ... },
        "contradictions": [str],
        "verification_notes": [str]
      }
    """
    user_prompt = f"""EXTRACTED LIMITS:
{json.dumps(extracted, indent=2)[:3500]}

CALL REQUIREMENTS TEXT:
{(call_requirements or '')[:10000]}

Return JSON:
{{
  "confidence": "high" or "medium" or "low",
  "verified": {{
    "total_page_limit": "string or null",
    "narrative_page_limit": int or null,
    "annex_page_limit": int or null,
    "total_word_limit": int or null,
    "per_section_limits": {{}}
  }},
  "contradictions": ["list of conflicting statements found"],
  "verification_notes": ["human-readable notes for the team"]
}}"""

    try:
        response = await chat_complete(
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            agent_name="limits_verifier",
            json_mode=True,
        )
        result = json.loads(response)
        verified = result.get("verified") or {}
        merged = {**extracted, **{k: v for k, v in verified.items() if v is not None}}
        return {
            "confidence": result.get("confidence") or "medium",
            "verified": merged,
            "contradictions": result.get("contradictions") or [],
            "verification_notes": result.get("verification_notes") or [],
        }
    except Exception:
        return {
            "confidence": "low",
            "verified": extracted,
            "contradictions": [],
            "verification_notes": ["Verification step failed — review limits manually."],
        }

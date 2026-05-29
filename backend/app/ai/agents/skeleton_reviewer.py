"""
Skeleton Reviewer (Stage 6) — Adversarial Alignment Review
Lightweight gpt-4o-mini pass that receives the generated skeleton text,
call requirements, and call strategy, then flags:
  - Compliance gaps (mandatory call requirements not addressed)
  - Weak sections (thin, generic, or underdeveloped)
  - Missing call requirements (specific asks from the funder not present)
  - An overall alignment score (0–100)

Results are stored in the skeleton output and surfaced in the UI as
actionable flags — not blockers. The pipeline always delivers the skeleton.
"""
from __future__ import annotations

import json

from app.ai.client import chat_complete

SYSTEM_PROMPT = """You are an adversarial grant proposal reviewer.

Your job is to critically evaluate a skeleton (outline) of a grant proposal and identify:
1. COMPLIANCE GAPS: mandatory requirements from the call that are missing or inadequately addressed
2. WEAK SECTIONS: sections that are too generic, thin, or lack specific content
3. MISSING REQUIREMENTS: specific asks from the funder that do not appear anywhere in the skeleton
4. ALIGNMENT SCORE: 0-100 rating of how well the skeleton aligns with the call (be strict)

Be specific: name the section and the exact missing requirement, not just "needs more detail."
Do NOT rewrite or suggest full rewrites — flag issues concisely so the team can fix them.

Return valid JSON only."""

USER_PROMPT_TEMPLATE = """Review this grant proposal skeleton for compliance and quality.

CALL REQUIREMENTS:
{call_requirements}

CALL STRATEGY (what a winning proposal must demonstrate):
{strategy_block}

GRANT IDEA (to check if the skeleton actually reflects the team's approach):
{grant_idea}

---

SKELETON TO REVIEW:
{skeleton_text}

---

Return JSON:
{{
  "compliance_gaps": [
    "Specific mandatory requirement missing: describe exactly what is missing and where it should appear"
  ],
  "weak_sections": [
    "Section Name: specific weakness (too generic / missing evidence / wrong framing)"
  ],
  "missing_call_requirements": [
    "Exact funder ask not found in skeleton"
  ],
  "alignment_score": 0-100,
  "alignment_notes": "2-3 sentences: overall assessment of how well the skeleton addresses the call"
}}"""


def _format_strategy_for_review(call_strategy: dict) -> str:
    parts = []
    if call_strategy.get("must_demonstrate"):
        parts.append("Must demonstrate: " + "; ".join(call_strategy["must_demonstrate"][:5]))
    if call_strategy.get("critical_themes"):
        parts.append("Critical themes: " + " | ".join(call_strategy["critical_themes"][:5]))
    if call_strategy.get("evaluation_criteria"):
        parts.append("Evaluation criteria: " + "; ".join(call_strategy["evaluation_criteria"][:5]))
    return "\n".join(parts) if parts else "Not available"


async def review_skeleton(
    skeleton_text: str,
    call_requirements: str,
    call_analysis: dict,
    call_strategy: dict,
    grant_idea: str,
) -> dict:
    """
    Run an adversarial compliance review on the generated skeleton.

    Returns:
      {
        "compliance_gaps": list[str],
        "weak_sections": list[str],
        "missing_call_requirements": list[str],
        "alignment_score": int,
        "alignment_notes": str,
      }
    Always returns a dict (empty on failure) so the pipeline is never blocked.
    """
    if not skeleton_text:
        return {}

    # Include call analysis evaluation criteria in the strategy block
    eval_criteria = call_analysis.get("evaluation_criteria") or []
    required_sections = call_analysis.get("required_sections") or []
    strategy_block = _format_strategy_for_review(call_strategy)
    if eval_criteria:
        strategy_block += "\nEvaluation criteria: " + "; ".join(eval_criteria[:6])
    if required_sections:
        strategy_block += "\nRequired sections: " + ", ".join(required_sections[:10])

    user_prompt = USER_PROMPT_TEMPLATE.format(
        call_requirements=(call_requirements or "Not provided")[:2500],
        strategy_block=strategy_block[:1500],
        grant_idea=(grant_idea or "Not provided")[:1000],
        skeleton_text=skeleton_text[:4000],
    )

    try:
        response = await chat_complete(
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            agent_name="skeleton_reviewer",
            json_mode=True,
        )
        result = json.loads(response)
        # Normalise fields
        return {
            "compliance_gaps": result.get("compliance_gaps") or [],
            "weak_sections": result.get("weak_sections") or [],
            "missing_call_requirements": result.get("missing_call_requirements") or [],
            "alignment_score": result.get("alignment_score"),
            "alignment_notes": result.get("alignment_notes") or "",
        }
    except Exception:
        return {}

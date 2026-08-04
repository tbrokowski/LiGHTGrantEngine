"""Reviewer-grade critique of a funding call.

Reads the call the way an evaluation panel would — extracting the scoring rubric,
weightings, what wins vs. loses points, eligibility red flags, common rejection
reasons, and a per-section "what a reviewer wants here." The result is threaded
into the formatted call_requirements so the architect, writers, and critic all
draft against how the proposal will actually be judged.
"""
import json

import structlog

from app.ai.client import chat_complete

logger = structlog.get_logger()

_SYSTEM = (
    "You are a senior grant reviewer and evaluation-panel chair for this funder. "
    "You have scored hundreds of proposals for this exact programme. Read the call "
    "as an EVALUATOR: what earns points, what loses them, what gets desk-rejected. "
    "Be specific and grounded ONLY in the call text — do not invent criteria the call "
    "doesn't state. Return STRICT JSON only."
)

_SCHEMA_HINT = """Return a JSON object with these keys:
{
  "scoring_rubric": [
    {"criterion": "...", "weight": "e.g. 40% / high / pass-fail", "scores_high": "what a top-scoring answer does", "scores_low": "what a weak answer does"}
  ],
  "weightings_summary": "one sentence on where the points concentrate",
  "winning_factors": ["concrete things reviewers reward for THIS call"],
  "losing_factors": ["concrete things that cost points"],
  "eligibility_red_flags": ["hard requirements that cause rejection if missed"],
  "common_rejection_reasons": ["typical reasons a proposal to this call fails"],
  "per_section_expectations": {"Section name": "what a reviewer specifically wants to see here"},
  "overall_reviewer_summary": "3-5 sentences: how to win this call, in a reviewer's voice"
}"""


async def review_call(call_text: str, call_analysis: dict | None = None, funder: str = "") -> dict:
    """Produce a reviewer brief from the full call text (+ the extracted analysis)."""
    call_analysis = call_analysis or {}
    # Focused context: the call text (bounded) + the fields most relevant to scoring.
    ctx_bits: list[str] = []
    if call_analysis.get("evaluation_criteria"):
        ctx_bits.append("Extracted evaluation criteria:\n" + "\n".join(
            f"- {c}" for c in call_analysis["evaluation_criteria"]))
    if call_analysis.get("required_sections"):
        ctx_bits.append("Required sections:\n" + "\n".join(
            f"- {s}" for s in call_analysis["required_sections"]))
    if call_analysis.get("winning_factors"):
        ctx_bits.append("Winning factors (from first pass):\n" + "\n".join(
            f"- {c}" for c in call_analysis["winning_factors"]))
    ctx = ("\n\n".join(ctx_bits) + "\n\n") if ctx_bits else ""

    user = (
        f"FUNDER: {funder or 'unknown'}\n\n"
        f"{ctx}"
        f"CALL TEXT (read as a reviewer):\n{(call_text or '')[:80000]}\n\n"
        f"{_SCHEMA_HINT}"
    )
    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": user},
    ]
    try:
        content = await chat_complete(
            messages, agent_name="call_reviewer", json_mode=True, max_tokens=4000, temperature=0.2
        )
        data = json.loads(content)
        return data if isinstance(data, dict) else {}
    except Exception as exc:
        logger.warning("call_reviewer failed", error=str(exc))
        return {}

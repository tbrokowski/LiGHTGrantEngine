"""
Whole-document alignment editor — replaces check_narrative_coherence.

Reviewer: reads the FULL assembled proposal (not per-section summaries) plus
call_intelligence.evaluation_framework (criterion -> weighted section mapping)
and adversarial_challenges (rejection risks, compliance gaps), and produces
structured, section-targeted findings — the first time this data is actually
used for anything beyond display.

Rewriter: an agentic tool-executor loop (same pattern as meta_agent.py's
per-section critique loop) that takes those findings and actually edits the
document via insert_section_content, instead of only reporting them.
"""
from __future__ import annotations

import json
from typing import Any, TYPE_CHECKING

from app.ai.client import chat_complete, chat_complete_with_tools
from app.ai.context.grant_context import insert_section_content, parse_document_sections

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


# ── Reviewer ──────────────────────────────────────────────────────────────────

def _format_evaluation_framework(ci: dict) -> str:
    ef = (ci or {}).get("evaluation_framework") or {}
    criteria = ef.get("criteria") or []
    if not criteria:
        return "Not available."
    lines = []
    for c in criteria[:12]:
        if not isinstance(c, dict):
            continue
        name = c.get("name", "?")
        weight = c.get("weight_pct")
        relevant = ", ".join(c.get("relevant_sections") or []) or "not mapped"
        looks_for = c.get("what_reviewers_look_for", "")
        weight_str = f"{weight}%" if weight is not None else "?%"
        lines.append(f"- {name} ({weight_str} weight) — mapped to: {relevant}\n  Reviewers look for: {looks_for}")
    return "\n".join(lines) if lines else "Not available."


def _format_adversarial_challenges(ci: dict) -> str:
    ac = (ci or {}).get("adversarial_challenges") or {}
    risks = ac.get("rejection_risks") or []
    gaps = ac.get("compliance_gaps") or []
    if not risks and not gaps:
        return "Not available."
    lines = []
    if risks:
        lines.append("Rejection risks:")
        lines.extend(f"  - {r}" for r in risks[:8])
    if gaps:
        lines.append("Compliance gaps:")
        lines.extend(f"  - {g}" for g in gaps[:8])
    return "\n".join(lines)


async def review_document_alignment(
    html: str,
    call_intelligence: dict,
    document_constraints: dict,
    call_requirements: str,
    grant_idea: str,
    narrative_context: dict | None = None,
) -> dict:
    """Reviewer stage: read the whole document, cross-reference call intelligence,
    produce structured section-targeted findings.

    Returns the same top-level schema the old check_narrative_coherence produced
    (overall, narrative_arc, issues, strengths, criteria_coverage,
    fundability_assessment, top_priority_fixes) so no frontend changes are needed —
    "issues" entries now carry real, section-targeted recommended_edit actions
    grounded in the call's actual evaluation criteria, not just narrative prose.
    """
    sections = parse_document_sections(html)
    if not sections:
        return {"issues": [], "overall": "adequate", "strengths": []}

    doc_text = "\n\n".join(
        f"## {s.title} ({s.section_type})\n{s.plain_text[:3500]}" for s in sections
    )
    narrative_context = narrative_context or {}
    theory = narrative_context.get("theory_of_change", "")
    themes = ", ".join(narrative_context.get("cross_section_themes", []))
    priorities = narrative_context.get("funder_priorities_to_emphasize", [])
    dc_summary = ""
    if document_constraints:
        dc_summary = (
            f"Total word limit: {document_constraints.get('total_word_limit', '?')}\n"
            f"Required sections: {', '.join(document_constraints.get('required_sections') or [])}"
        )

    prompt = f"""You are doing the FINAL WHOLE-DOCUMENT ALIGNMENT REVIEW of an assembled grant proposal.
Every section has already been individually drafted. Your job is to find issues that are only
visible at the document level, and — critically — map every issue to the SPECIFIC section(s)
that need to change, with a concrete edit instruction. A downstream agent will execute your
recommended_edit verbatim against the named section, so it must be specific and actionable.

THEORY OF CHANGE: {theory or 'See grant idea and sections'}
CROSS-SECTION THEMES: {themes or 'Not specified'}
FUNDER PRIORITIES: {', '.join(priorities[:8]) if priorities else 'See call requirements'}
GRANT IDEA: {grant_idea[:800]}
CALL REQUIREMENTS (summary): {call_requirements[:1500]}

DOCUMENT CONSTRAINTS:
{dc_summary or 'Not available.'}

EVALUATION FRAMEWORK (criterion -> which sections the funder expects it addressed in, with weight):
{_format_evaluation_framework(call_intelligence)}

ADVERSARIAL CHALLENGES (known rejection risks and compliance gaps for this call):
{_format_adversarial_challenges(call_intelligence)}

ASSEMBLED PROPOSAL — ALL SECTIONS, IN ORDER:
{doc_text}

EVALUATE ACROSS THESE DIMENSIONS:

1. CRITERION COVERAGE — For each evaluation-framework criterion, check whether its mapped
   sections actually address it. If a high-weight criterion is thin or absent in its mapped
   section(s), that is a HIGH severity issue with a specific recommended_edit.

2. ADVERSARIAL GAPS — For each known rejection risk / compliance gap, check whether any
   section addresses it. If not, flag which section should be edited to cover it.

3. CONSISTENCY — Do sections agree with each other on methodology, timelines, team roles,
   budget implications, outcome claims? Flag contradictions with both sections named.

4. NARRATIVE ARC — Does the proposal tell a coherent problem -> solution -> evidence -> impact
   story from first to last section?

5. REDUNDANCY — Which sections repeat each other? Name both sections and what to cut.

6. OVERALL STRENGTH — Synthesise: is this fundable as written?

Return JSON exactly:
{{
  "overall": "strong" | "adequate" | "weak",
  "narrative_arc": "strong" | "adequate" | "weak",
  "issues": [
    {{
      "section": "<EXACT section name as it appears above>",
      "dimension": "<criterion_coverage|adversarial_gap|consistency|arc|redundancy>",
      "issue": "<specific issue>",
      "severity": "high" | "medium" | "low",
      "recommended_edit": "<specific, actionable instruction for what to change in this section>"
    }}
  ],
  "strengths": ["<strength 1>", ...],
  "criteria_coverage": {{ "<criterion>": "strong" | "partial" | "absent" }},
  "fundability_assessment": "<1-2 sentence overall verdict>",
  "top_priority_fixes": ["<most important fix 1>", "<fix 2>", "<fix 3>"]
}}"""

    response = await chat_complete(
        messages=[{"role": "user", "content": prompt}],
        agent_name="document_editor",
        json_mode=True,
    )
    try:
        result = json.loads(response)
        result.setdefault("issues", [])
        return result
    except (json.JSONDecodeError, TypeError):
        return {"issues": [], "overall": "adequate", "strengths": []}


# ── Rewriter ──────────────────────────────────────────────────────────────────

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "edit_section",
            "description": (
                "Apply a targeted edit to a named section of the document to fix a specific "
                "finding. section_name must exactly match one of the section names listed in "
                "the document — if it doesn't, you'll get an error listing the valid names."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "section_name": {"type": "string", "description": "Exact section name to edit"},
                    "instruction": {"type": "string", "description": "Specific instruction: what to fix and how"},
                    "reason": {"type": "string", "description": "Brief label for the activity log"},
                },
                "required": ["section_name", "instruction", "reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "accept_document",
            "description": "Call when all warranted edits have been applied and the document is ready.",
            "parameters": {
                "type": "object",
                "properties": {
                    "verdict": {"type": "string", "description": "Brief summary of what was changed and why"},
                },
                "required": ["verdict"],
            },
        },
    },
]

SYSTEM_PROMPT = """You are the final editor for a grant proposal, applying fixes identified by a
whole-document alignment review. You have the full list of findings and the current document.

RULES:
- Only edit sections that have a real, substantive finding — do not make cosmetic changes.
- Combine multiple findings about the same section into one edit_section call when sensible.
- Skip low-severity findings if fixing them would risk destabilizing an otherwise strong section.
- Each edit_section call rewrites the WHOLE section — preserve everything that isn't part of
  the finding being fixed.
- Call accept_document when you've applied every warranted edit."""


async def _rewrite_section_for_finding(
    section_name: str,
    current_body_html: str,
    instruction: str,
    grant_idea: str,
    funder: str,
    style_profile: dict,
) -> str:
    style_str = ""
    if style_profile:
        voice = style_profile.get("voice_summary", "")
        tone = style_profile.get("tone", "")
        if voice or tone:
            style_str = f"\nINSTITUTIONAL VOICE: {voice} {tone}".strip()

    prompt = f"""You are doing a targeted rewrite of a grant proposal section as part of a
whole-document alignment pass — this fix was identified by cross-referencing the document
against the funder's actual evaluation criteria.

SECTION: {section_name}
FUNDER: {funder}
GRANT IDEA: {grant_idea[:1200]}
{style_str}

CURRENT CONTENT:
{current_body_html}

EDIT INSTRUCTION:
{instruction}

RULES:
- Preserve the section's voice, structure, and existing content not related to this instruction
- Make the specific improvement described in the instruction
- Use (Author, Year) format for any new inline citations; use [VERIFY: claim] if you cannot source one
- Return ONLY the improved section HTML (<p>, <h3>, <ul><li>, <table> tags only)
- Do NOT include the section heading in the output"""

    result = await chat_complete(
        messages=[{"role": "user", "content": prompt}],
        agent_name="document_editor",
    )
    if result and not result.strip().startswith("<"):
        result = "".join(f"<p>{p.strip()}</p>" for p in result.split("\n\n") if p.strip())
    return result or current_body_html


def _section_body(section) -> str:
    """Strip the leading <h2>...</h2> from a parsed DocumentSection's html."""
    import re
    return re.sub(r"^<h2[^>]*>.*?</h2>\s*", "", section.html, count=1, flags=re.IGNORECASE | re.DOTALL)


async def apply_document_edits(
    html: str,
    findings: list[dict],
    grant_idea: str,
    funder: str,
    style_profile: dict | None,
    db: "AsyncSession",
) -> tuple[str, list[dict]]:
    """Rewriter stage: agentic loop that applies edits for the Reviewer's findings.

    Returns (updated_html, edit_log).
    """
    if not findings:
        return html, []

    state = {"html": html, "edit_log": []}

    def executor_factory() -> Any:
        async def executor(tool_name: str, arguments: dict) -> dict:
            if tool_name == "edit_section":
                section_name = arguments.get("section_name", "")
                instruction = arguments.get("instruction", "")
                reason = arguments.get("reason", "Alignment fix")
                sections = parse_document_sections(state["html"])
                match = next(
                    (s for s in sections if s.title.lower() == section_name.lower()), None
                )
                if not match:
                    valid = [s.title for s in sections]
                    return {"error": f"No section named '{section_name}' found.", "valid_section_names": valid}
                body = _section_body(match)
                rewritten = await _rewrite_section_for_finding(
                    section_name=match.title,
                    current_body_html=body,
                    instruction=instruction,
                    grant_idea=grant_idea,
                    funder=funder,
                    style_profile=style_profile or {},
                )
                state["html"] = insert_section_content(state["html"], match.title, rewritten)
                state["edit_log"].append({"section": match.title, "reason": reason, "instruction": instruction})
                return {"success": True, "message": f"Edited '{match.title}': {reason}"}

            elif tool_name == "accept_document":
                return {"accepted": True}

            return {"error": f"Unknown tool: {tool_name}"}

        return executor

    findings_block = "\n".join(
        f"- [{f.get('severity', 'medium')}] {f.get('section', 'unknown')}: {f.get('issue', '')}\n"
        f"  Recommended edit: {f.get('recommended_edit', '')}"
        for f in findings[:20]
    )
    sections = parse_document_sections(html)
    section_names = ", ".join(s.title for s in sections)

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"DOCUMENT SECTIONS: {section_names}\n\n"
                f"FINDINGS FROM THE ALIGNMENT REVIEW:\n{findings_block}\n\n"
                "Apply the warranted edits, then call accept_document."
            ),
        },
    ]

    await chat_complete_with_tools(
        messages=messages,
        tools=TOOLS,
        tool_executor=executor_factory(),
        agent_name="document_editor",
        max_rounds=min(len(findings), 10) + 2,
    )

    return state["html"], state["edit_log"]

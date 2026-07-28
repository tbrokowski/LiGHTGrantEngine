"""LEAD ARCHITECT — the orchestrator's planning brain (one grounded reasoning call).

Replaces the ~10-phase skeleton + the planning_agent / skeleton_planning_agent /
draft_orchestrator fan-out with a single reasoning pass that:
  1. starts from LiGHT's house proposal structure (below),
  2. grounds it in the call requirements + our funded-proposal structure/exemplars
     from the archive + the grant idea,
  3. emits an outline (sections with word limits, drafting-compatible) PLUS a
     per-section brief (topic sentence, key points, which archive material grounds
     each, which claims need a citation) PLUS a coordination map + dependency graph
     so the parallel writers don't overlap.

Output stays compatible with the existing `proposal_skeleton` shape
(`sections: [{name, word_limit, page_limit, priority, order}], total_word_limit,
document_checklist`) and adds `brief` per section + `coordination`.
"""
from __future__ import annotations

import json
import structlog

from app.ai.client import chat_complete

logger = structlog.get_logger()

# LiGHT's house structure — the default backbone, adapted to what the call asks.
HOUSE_STRUCTURE = """\
1. Executive summary
2. Introduction (~1-2 pages, one flowing section) — why it matters / the problem and
   its significance -> the existing solution / status quo -> why that solution isn't
   good enough (the gap) -> OUR PROPOSED CHANGE (the core idea / innovation)
3. Background — deeper context: partners, overview, prior work, setting
4. Objectives — organized into pillars / tasks / work packages (the high-level plan)
5. Detailed description of each pillar / task / work package
6. End matter the call requires — governance, timeline/work plan, budget justification,
   ethics, impact, dissemination, etc."""

_SYSTEM = """\
You are the lead architect and orchestrator for a competitive scientific grant proposal
(LiGHT group, EPFL — Global Health AI). Plan the whole proposal before any prose is written.

Think hard, then output a plan that maximizes for FOUR things at every step:
(i) the MOST SPECIFIC, least generic content — concrete methods, numbers, named programs;
    no filler;
(ii) WHERE TO DRAW FROM OUR ARCHIVE — which past-proposal material grounds each point and
     lets the writer reuse our own language/voice;
(iii) the NEWEST, most relevant EXTERNAL sources needed to back each claim;
(iv) CLEAN, LOGICAL FLOW and a coherent structure across the whole document.

Start from the house structure, then ADAPT it to what THIS call actually requires
(fold/rename/reorder sections to match the funder's required sections and page/word limits).

Return ONLY JSON:
{
  "sections": [
    {
      "name": str,
      "order": int,
      "word_limit": int|null,           // copy funder limits exactly when given
      "page_limit": str|null,
      "priority": "high"|"medium"|"low",
      "brief": {
        "topic_sentence": str,          // the one-sentence claim this section makes
        "points": [str, ...],           // 3-5 specific supporting points to cover
        "archive_grounding": [str, ...],// which prior-grant material/sections to pull from
        "citation_needs": [str, ...],   // claims that will need an external citation
        "owns": str,                    // what this section covers (to avoid overlap)
        "defers": [str, ...]            // topics it should NOT cover (another section owns)
      }
    }
  ],
  "total_word_limit": int|null,
  "document_checklist": [str, ...],     // required attachments/appendices
  "coordination": {
    "dependencies": [ [ "Section B", "Section A" ], ... ],  // B depends on A (draft A first)
    "throughline": str                 // the single argument the whole proposal advances
  }
}
No prose outside the JSON."""


async def build_proposal_plan(
    *,
    grant_title: str,
    funder: str,
    grant_idea: str,
    call_requirements: str,
    call_analysis: dict | None,
    archive_structures: list[dict] | None,
    archive_exemplars: list[dict] | None,
    section_constraints: list[dict] | None = None,
    total_word_limit: int | None = None,
    total_page_limit: str | None = None,
) -> dict:
    """One grounded reasoning call → the full proposal plan (see module docstring)."""
    ca = call_analysis or {}
    structures = archive_structures or []
    exemplars = archive_exemplars or []

    struct_lines = "\n".join(
        f"- {s.get('grant_title', '?')} ({s.get('funder', '')}, {s.get('outcome', '?')}): "
        + ", ".join(f"{x.get('title', '?')} [{x.get('word_count', '?')}w]" for x in (s.get("sections") or [])[:12])
        for s in structures[:3]
    ) or "(no archived proposal structures available)"

    exemplar_lines = "\n\n".join(
        f"[{e.get('section_type', '?')} — {e.get('grant_title', '?')}]\n{(e.get('full_text') or '')[:900]}"
        for e in exemplars[:6]
    ) or "(no archive exemplars available)"

    limits = ""
    if section_constraints:
        limits += "\nUSER SECTION LIMITS (copy exactly):\n" + "\n".join(
            f"- {c.get('name')}: {c.get('word_limit') or '?'} words / {c.get('page_limit') or '?'} pages"
            for c in section_constraints if c.get("name")
        )
    if total_word_limit:
        limits += f"\nTOTAL WORD LIMIT: {total_word_limit}"
    if total_page_limit:
        limits += f"\nTOTAL PAGE LIMIT: {total_page_limit}"

    user = f"""HOUSE STRUCTURE (default backbone):
{HOUSE_STRUCTURE}

GRANT: {grant_title}
FUNDER: {funder}

GRANT IDEA (what we're proposing):
{grant_idea[:6000]}

CALL REQUIREMENTS / ANALYSIS:
{call_requirements[:6000]}
Required sections (from call analysis): {ca.get('required_sections', [])}
{limits}

HOW OUR FUNDED PROPOSALS ARE STRUCTURED (mirror this where it fits):
{struct_lines}

ARCHIVE EXCERPTS (our voice + reusable material to ground sections in):
{exemplar_lines}

Produce the plan now."""

    try:
        raw = await chat_complete(
            messages=[{"role": "system", "content": _SYSTEM}, {"role": "user", "content": user}],
            agent_name="lead_architect",
            json_mode=True,
        )
        plan = json.loads(raw)
    except Exception as exc:
        logger.warning("lead_architect plan failed", error=str(exc))
        return {"error": "architect_failed", "sections": []}

    # Normalize ordering + carry user limits through, mirroring proposal_architect.
    sections = [s for s in (plan.get("sections") or []) if s.get("name")]
    for i, s in enumerate(sections):
        s.setdefault("order", i)
        s.setdefault("priority", "medium")
    sections.sort(key=lambda s: s.get("order", 0))
    if section_constraints:
        by_name = {c["name"]: c for c in section_constraints if c.get("name")}
        for s in sections:
            src = by_name.get(s.get("name"))
            if src and src.get("word_limit"):
                s["word_limit"] = src["word_limit"]
    plan["sections"] = sections
    if total_word_limit and not plan.get("total_word_limit"):
        plan["total_word_limit"] = total_word_limit
    return plan

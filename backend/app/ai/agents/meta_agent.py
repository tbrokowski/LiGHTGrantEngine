"""
Grant Meta-Agent Coordinator — 3-round critique → refine loop per section.

Each section goes through three explicit, escalating critique rounds before
being accepted:

  Round 1 — EVIDENCE GROUNDING
    Focus: citation completeness, claim support, factual specificity.
    Actions: RAG corpus search, web search, targeted rewrite to embed evidence.

  Round 2 — CALL COMPLIANCE & STRUCTURAL STRENGTH
    Focus: evaluation-criteria coverage, section structure, gap-filling.
    Actions: RAG for coverage exemplars, rewrite to address missed criteria.

  Round 3 — NARRATIVE COHERENCE & VOICE POLISH
    Focus: consistency with proposal narrative, institutional voice, final polish.
    Actions: targeted rewrite for coherence, accept when section passes all checks.

After all sections complete their per-section loop the orchestrator runs a
separate high-level overview pass (check_narrative_coherence) across the full
assembled document.
"""
from __future__ import annotations

import json
import uuid
from typing import AsyncIterator, TYPE_CHECKING

from app.ai.client import chat_complete, chat_complete_with_tools
from app.ai.rag.retriever import retrieve_content_exemplars
from app.services.web_search import search_web_multi

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


# ── Round-specific critique focus ─────────────────────────────────────────────

_ROUND_FOCUS = {
    1: """ROUND 1 — EVIDENCE GROUNDING
Your primary mission this round:
• Check EVERY quantitative claim — does it have an inline citation (Author, Year)?
  If not, search_rag_corpus or search_web to find one, then rewrite_section to embed it.
• Flag any [VERIFY: ...] placeholders — search for the actual evidence and replace them.
• Check that statistics, prevalence rates, model performance numbers, and outcome data
  are all backed by real sources, not generic assertions.
• If archive exemplars show better-evidenced versions of any claim, incorporate them.
Do NOT focus on structure or narrative this round — just evidence and citations.""",

    2: """ROUND 2 — CALL COMPLIANCE & STRUCTURAL STRENGTH
Your primary mission this round:
• Map every evaluation criterion from the call requirements against this section.
  For each criterion that is under-addressed, use search_rag_corpus to find strong
  exemplar language, then rewrite_section to fill the gap.
• Check section structure: does it have a clear topic sentence per paragraph?
  Does it address all key asks in the funder's requirements?
• Identify any section-type requirements not yet met
  (e.g. Methods needs: study design, population, analysis plan, feasibility).
• Add any missing structural elements via targeted rewrite.
Do NOT focus on citations this round — they were handled in Round 1.""",

    3: """ROUND 3 — NARRATIVE COHERENCE & VOICE POLISH
Your primary mission this round:
• Check that this section connects to the proposal's theory of change and cross-section themes.
• Ensure it builds on or references prior sections without redundancy.
• Verify the institutional voice and tone matches the style profile.
• Check the opening and closing sentences — the opener should hook, the closer should
  bridge toward what comes next or land the section's key contribution.
• Make only targeted polish rewrites — do not restructure if the section is fundamentally sound.
• Call accept_section when the section is ready. Be decisive: if it passed Round 1 and 2, it
  likely just needs minor polish. Do not over-critique at this stage.""",
}

# ── System prompt ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a rigorous grant quality auditor embedded inside a proposal writing pipeline.

You are running one round of a 3-round critique-refine loop on a single section.
Each round has a specific focus (provided in the user message) — concentrate on THAT focus only.

QUALITY DIMENSIONS (assess all, but prioritise this round's focus):

1. SPECIFICITY: Name concrete methods, datasets, geographies, timelines, model architectures,
   sample sizes. "We will use AI" is not specific. "We will fine-tune a ResNet-50 on the X
   dataset across 3 LMIC sites" is specific.

2. CLAIM SUPPORT: Every factual claim (prevalence, performance, outcomes) needs (Author, Year)
   inline citation or [VERIFY: claim] placeholder. Unsupported claims are a red flag.

3. RAG ALIGNMENT: Search the corpus for concepts, methods, or claims that likely exist in our
   archive of prior successful proposals. Incorporate strong archive language where found.

4. NARRATIVE COHERENCE: Does this section connect to the theory of change? Does it build on
   prior sections without repeating them?

5. CALL COMPLIANCE: Does the section address the relevant evaluation criteria?
   Are there coverage gaps relative to what the funder asked for?

6. VOICE/STYLE: Does the language match the institutional style profile? Is it appropriately
   formal, technical, and impact-focused?

TOOL PROTOCOL:
- search_rag_corpus → retrieve prior awarded proposal excerpts on a concept
- search_web → retrieve current evidence, statistics, or citations
- rewrite_section → targeted rewrite to incorporate what you found (always pair with a search)
- ask_user → LAST RESORT for data the AI cannot have (team prelim results, partner names,
  budget figures, PI credentials). Maximum 1 ask_user call per round.
- accept_section → call when this round's focus is satisfied

RULES:
- Be decisive. If the section already passes this round's focus, call accept_section immediately.
- Do NOT rewrite for cosmetic reasons — only when there is a substantive quality gap.
- After a rewrite, briefly re-evaluate before deciding to accept or search more.
- Do not repeat work from prior rounds (citations from Round 1, structure from Round 2).
"""

# ── Tool definitions ──────────────────────────────────────────────────────────

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_rag_corpus",
            "description": (
                "Search the institutional archive of prior awarded and submitted proposals "
                "for sections matching a concept, methodology, disease area, or geography. "
                "Use when the drafted section mentions something that likely exists in the archive."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Concept, method, claim, or topic to search for"},
                    "section_type": {"type": "string", "description": "Optional section type filter"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_web",
            "description": (
                "Search the web for evidence, statistics, or citations to support a specific claim. "
                "Use when a factual claim needs backing or a statistic is missing."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "queries": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "1–3 targeted search queries",
                    },
                },
                "required": ["queries"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "rewrite_section",
            "description": (
                "Rewrite the current section to fix a specific quality issue. "
                "Provide the exact instruction (what to fix) and any new evidence to incorporate. "
                "Always pair this with a prior search call — don't rewrite blindly."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "instruction": {"type": "string", "description": "Specific instruction: what to fix and how"},
                    "evidence_to_incorporate": {"type": "string", "description": "New content, citations, or RAG excerpts to weave in"},
                    "reason": {"type": "string", "description": "Brief label for the activity log (e.g. 'Added TB prevalence citation')"},
                },
                "required": ["instruction", "reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ask_user",
            "description": (
                "Surface a targeted question when a quality issue requires institutional data "
                "the AI cannot have (preliminary results, partner names, budget details, PI credentials). "
                "LAST RESORT — only after attempting autonomous fixes. Max 1 call per round."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {"type": "string", "description": "The specific question to ask"},
                    "why": {"type": "string", "description": "Why this information is needed"},
                    "section_context": {"type": "string", "description": "Which part of the section needs this"},
                },
                "required": ["question", "why"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "accept_section",
            "description": (
                "Mark the section as passing this round's quality check. "
                "Call this when the round's focus is satisfied — the next round will handle other dimensions."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "verdict": {"type": "string", "description": "Brief quality summary for this round"},
                    "issues_remaining": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List any remaining issues for later rounds (do not fix them now)",
                    },
                },
                "required": ["verdict"],
            },
        },
    },
]


# ── State ─────────────────────────────────────────────────────────────────────

class _SectionRewriteState:
    def __init__(self, content: str):
        self.current_content = content
        self.accepted = False
        self.user_questions: list[dict] = []
        self.events: list[dict] = []
        self.round_verdicts: list[str] = []
        self.issues_for_next_round: list[str] = []


# ── Tool executor ─────────────────────────────────────────────────────────────

async def _build_tool_executor(
    state: _SectionRewriteState,
    section_name: str,
    section_type: str,
    call_requirements: str,
    narrative_context: dict,
    style_profile: dict,
    grant_idea: str,
    funder: str,
    db: "AsyncSession",
    round_num: int,
):
    async def executor(tool_name: str, arguments: dict) -> dict:
        if tool_name == "search_rag_corpus":
            query = arguments.get("query", "")
            sec_type = arguments.get("section_type", section_type)
            results = await retrieve_content_exemplars(
                query=query, db=db, section_type=sec_type, funder=funder, top_k=4,
            )
            state.events.append({
                "event": "meta_agent_action",
                "tool": "search_rag_corpus",
                "query": query,
                "section": section_name,
                "round": round_num,
                "results_count": len(results),
            })
            if not results:
                return {"found": False, "results": []}
            return {
                "found": True,
                "results": [
                    {
                        "grant_title": r.get("grant_title", ""),
                        "section_type": r.get("section_type", ""),
                        "outcome": r.get("outcome", ""),
                        "excerpt": r.get("full_text", "")[:1000],
                    }
                    for r in results[:4]
                ],
            }

        elif tool_name == "search_web":
            queries = arguments.get("queries", [])
            if not queries:
                return {"found": False, "results": []}
            state.events.append({
                "event": "meta_agent_action",
                "tool": "search_web",
                "query": "; ".join(queries[:2]),
                "section": section_name,
                "round": round_num,
            })
            results = await search_web_multi(queries[:3], max_results_per_query=3)
            if not results:
                return {"found": False, "results": []}
            return {
                "found": True,
                "results": [
                    {"title": r["title"], "url": r["url"], "content": r["content"][:600]}
                    for r in results[:5]
                ],
            }

        elif tool_name == "rewrite_section":
            instruction = arguments.get("instruction", "")
            evidence = arguments.get("evidence_to_incorporate", "")
            reason = arguments.get("reason", f"Round {round_num} improvement")
            state.events.append({
                "event": "meta_agent_action",
                "tool": "rewrite_section",
                "query": reason,
                "section": section_name,
                "round": round_num,
            })
            rewritten = await _rewrite_section_content(
                section_name=section_name,
                section_type=section_type,
                current_content=state.current_content,
                instruction=instruction,
                evidence=evidence,
                call_requirements=call_requirements,
                narrative_context=narrative_context,
                style_profile=style_profile,
                grant_idea=grant_idea,
                funder=funder,
                round_num=round_num,
            )
            state.current_content = rewritten
            state.events.append({
                "event": "meta_agent_revision",
                "section": section_name,
                "reason": reason,
                "round": round_num,
            })
            return {"success": True, "message": f"Section rewritten: {reason}"}

        elif tool_name == "ask_user":
            question_id = str(uuid.uuid4())
            q = {
                "event": "meta_agent_question",
                "question_id": question_id,
                "section": section_name,
                "question": arguments.get("question", ""),
                "why": arguments.get("why", ""),
                "section_context": arguments.get("section_context", ""),
                "round": round_num,
            }
            state.user_questions.append(q)
            state.events.append(q)
            return {"acknowledged": True, "question_id": question_id}

        elif tool_name == "accept_section":
            state.accepted = True
            verdict = arguments.get("verdict", "Accepted")
            state.round_verdicts.append(f"Round {round_num}: {verdict}")
            remaining = arguments.get("issues_remaining") or []
            state.issues_for_next_round = remaining
            state.events.append({
                "event": "meta_agent_accepted",
                "section": section_name,
                "verdict": verdict,
                "round": round_num,
            })
            return {"accepted": True}

        return {"error": f"Unknown tool: {tool_name}"}

    return executor


# ── Rewriter ──────────────────────────────────────────────────────────────────

async def _rewrite_section_content(
    section_name: str,
    section_type: str,
    current_content: str,
    instruction: str,
    evidence: str,
    call_requirements: str,
    narrative_context: dict,
    style_profile: dict,
    grant_idea: str,
    funder: str,
    round_num: int = 1,
) -> str:
    evidence_block = f"\nNEW EVIDENCE/CONTENT TO INCORPORATE:\n{evidence}\n" if evidence else ""
    style_str = ""
    if style_profile:
        voice = style_profile.get("voice_summary", "")
        tone = style_profile.get("tone", "")
        if voice or tone:
            style_str = f"\nINSTITUTIONAL VOICE: {voice} {tone}".strip()

    round_label = {
        1: "evidence grounding (add citations, replace [VERIFY] placeholders, back all claims)",
        2: "call compliance & structure (fill evaluation-criteria gaps, improve section structure)",
        3: "narrative coherence & voice polish (connect to theory of change, final polish)",
    }.get(round_num, "quality improvement")

    prompt = f"""You are doing a targeted rewrite of a grant proposal section.
Round {round_num} focus: {round_label}

SECTION: {section_name} (type: {section_type})
FUNDER: {funder}
GRANT IDEA: {grant_idea[:1200]}
{style_str}

CURRENT CONTENT:
{current_content}
{evidence_block}
CALL REQUIREMENTS:
{call_requirements[:2500]}

THEORY OF CHANGE: {narrative_context.get('theory_of_change', 'See grant idea')}
FUNDER PRIORITIES: {', '.join(narrative_context.get('funder_priorities_to_emphasize', [])[:6])}

REWRITE INSTRUCTION (Round {round_num}):
{instruction}

RULES:
- Preserve the section's voice, structure, and core content
- Make the targeted improvement described in the instruction
- Preserve [TBD] and [CUSTOMIZE:] markers unless replacing with real content
- Use (Author, Year) format for all inline citations
- Return ONLY the improved section HTML (<p>, <h3>, <ul><li>, <table> tags only)
- Do NOT include the section heading in the output"""

    result = await chat_complete(
        messages=[{"role": "user", "content": prompt}],
        agent_name="meta_agent",
    )
    if result and not result.strip().startswith("<"):
        result = "".join(f"<p>{p.strip()}</p>" for p in result.split("\n\n") if p.strip())
    return result or current_content


# ── Main entry point: 3-round loop ────────────────────────────────────────────

async def evaluate_and_improve_section(
    section_name: str,
    section_content: str,
    section_type: str,
    prior_sections_summary: str,
    call_requirements: str,
    narrative_context: dict,
    style_profile: dict,
    db: "AsyncSession",
    funder: str = "",
    grant_idea: str = "",
    max_rounds: int = 3,
    initial_issues: list[str] | None = None,
) -> AsyncIterator[dict]:
    """
    Run 3 explicit critique-refine rounds on a section.

    Round 1: Evidence grounding (citations, claim support)
    Round 2: Call compliance & structure (criteria coverage, section completeness)
    Round 3: Narrative coherence & voice polish

    Yields SSE-compatible event dicts:
      meta_agent_thinking   — starting a round
      meta_agent_action     — tool being called (rag / web / rewrite)
      meta_agent_revision   — section was rewritten
      meta_agent_question   — user input needed
      meta_agent_round_complete — one round finished
      meta_agent_accepted   — all rounds done; final content in event["content"]
    """
    state = _SectionRewriteState(content=section_content)
    num_rounds = min(max_rounds, 3)

    theory_of_change = narrative_context.get("theory_of_change", "")
    funder_priorities = ", ".join(narrative_context.get("funder_priorities_to_emphasize", []))
    style_voice = (style_profile or {}).get("voice_summary", "")
    cross_themes = ", ".join(narrative_context.get("cross_section_themes", []))

    carry_issues: list[str] = list(initial_issues or [])

    for round_num in range(1, num_rounds + 1):
        round_focus = _ROUND_FOCUS.get(round_num, _ROUND_FOCUS[3])

        yield {
            "event": "meta_agent_thinking",
            "section": section_name,
            "round": round_num,
            "total_rounds": num_rounds,
            "message": f"Round {round_num}/{num_rounds}: {round_focus.split(chr(10))[0]}",
        }

        # Reset accept flag for this round
        state.accepted = False
        state.events = []

        executor = await _build_tool_executor(
            state=state,
            section_name=section_name,
            section_type=section_type,
            call_requirements=call_requirements,
            narrative_context=narrative_context,
            style_profile=style_profile or {},
            grant_idea=grant_idea,
            funder=funder,
            db=db,
            round_num=round_num,
        )

        carry_block = ""
        if carry_issues:
            carry_block = (
                "\nISSUES CARRIED FROM PRIOR ROUNDS (handle if within this round's focus):\n"
                + "\n".join(f"  • {iss}" for iss in carry_issues[:6])
            )

        user_prompt = f"""You are running Round {round_num} of a 3-round critique-refine loop.

{round_focus}

━━━ PROPOSAL CONTEXT ━━━
Grant: {grant_idea[:700]}
Funder: {funder}
Theory of change: {theory_of_change or 'See grant idea'}
Funder priorities: {funder_priorities or 'See call requirements'}
Cross-section themes: {cross_themes or 'See narrative context'}
Institutional voice: {style_voice or 'Professional academic'}

━━━ SECTION ━━━
Section name: {section_name}
Section type: {section_type}

CURRENT CONTENT (after any rewrites from prior rounds):
{state.current_content}

━━━ CALL REQUIREMENTS ━━━
{call_requirements[:2000]}

━━━ PRIOR SECTIONS (for coherence) ━━━
{prior_sections_summary[:1200] if prior_sections_summary else 'No prior sections yet.'}
{carry_block}
━━━ YOUR TASK ━━━
Focus ONLY on the Round {round_num} dimensions above.
Use tools to search and fix. Then call accept_section with your verdict and any
issues_remaining for the next round.
Do not address issues outside this round's focus."""

        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ]

        await chat_complete_with_tools(
            messages=messages,
            tools=TOOLS,
            tool_executor=executor,
            agent_name="meta_agent",
            max_rounds=4,  # tool-call budget per critique round
        )

        # Yield all events from this round
        for event in state.events:
            yield event

        if not state.accepted:
            # Agent didn't call accept_section — treat as auto-accepted
            yield {
                "event": "meta_agent_round_complete",
                "section": section_name,
                "round": round_num,
                "verdict": "Round completed (auto-accepted)",
            }

        # Carry unresolved issues into the next round
        carry_issues = list(state.issues_for_next_round)
        state.issues_for_next_round = []

        yield {
            "event": "meta_agent_round_complete",
            "section": section_name,
            "round": round_num,
            "total_rounds": num_rounds,
            "verdict": state.round_verdicts[-1] if state.round_verdicts else f"Round {round_num} complete",
        }

    # All rounds done — emit final accepted event with current content
    yield {
        "event": "meta_agent_accepted",
        "section": section_name,
        "verdict": " | ".join(state.round_verdicts) or "3-round critique complete",
        "content": state.current_content,
        "rounds_completed": num_rounds,
    }

    # Surface any collected user questions
    for q in state.user_questions:
        if q.get("event") == "meta_agent_question":
            yield q


# ── High-level overview pass ──────────────────────────────────────────────────

async def check_narrative_coherence(
    sections: list[dict],
    narrative_context: dict,
    call_requirements: str,
    grant_idea: str,
) -> dict:
    """
    Final high-level overview pass across the assembled proposal.

    Checks:
    - Narrative arc: does the proposal tell a coherent story from start to finish?
    - Cross-section consistency: do sections contradict each other?
    - Evaluation criteria coverage: which criteria are addressed, which are thin?
    - Redundancy: which sections repeat each other unnecessarily?
    - Missing bridges: where does the reader need a transition?

    Returns {"issues": [...], "overall": "strong|adequate|weak", "strengths": [...],
             "criteria_coverage": {...}, "recommended_edits": [...]}
    """
    if not sections:
        return {"issues": [], "overall": "adequate"}

    summaries = "\n\n".join(
        f"## {s.get('name', '?')} ({s.get('type', 'section')})\n{(s.get('content') or '')[:600]}"
        for s in sections[:12]
    )
    theory = narrative_context.get("theory_of_change", "")
    themes = ", ".join(narrative_context.get("cross_section_themes", []))
    priorities = narrative_context.get("funder_priorities_to_emphasize", [])

    prompt = f"""You are doing the FINAL HIGH-LEVEL OVERVIEW PASS on an assembled grant proposal.

All sections have already been individually critiqued and refined across 3 rounds.
Your job now is to assess the proposal AS A WHOLE and identify any remaining issues
that only become visible at the document level.

THEORY OF CHANGE: {theory or 'See grant idea and sections'}
CROSS-SECTION THEMES: {themes or 'Not specified'}
FUNDER PRIORITIES: {', '.join(priorities[:8]) if priorities else 'See call requirements'}
GRANT IDEA: {grant_idea[:600]}
CALL REQUIREMENTS (summary): {call_requirements[:1200]}

ASSEMBLED PROPOSAL SECTIONS:
{summaries}

EVALUATE ACROSS THESE DIMENSIONS:

1. NARRATIVE ARC — Does the proposal tell a coherent story from first to last section?
   Is there a clear problem → solution → evidence → impact thread?

2. CONSISTENCY — Do the sections agree with each other on: methodology, timelines,
   team roles, budget implications, outcome claims? Flag any contradictions.

3. EVALUATION CRITERIA COVERAGE — For each funder evaluation criterion you can identify
   in the call requirements, rate coverage: "strong / partial / absent".

4. REDUNDANCY — Which sections repeat each other? What should be cut or consolidated?

5. MISSING BRIDGES — Where does the reader need a transition paragraph or forward reference?

6. OVERALL PROPOSAL STRENGTH — Synthesise: is this fundable as written?

Return JSON exactly:
{{
  "overall": "strong" | "adequate" | "weak",
  "narrative_arc": "strong" | "adequate" | "weak",
  "issues": [
    {{
      "section": "<section name or 'global'>",
      "dimension": "<arc|consistency|coverage|redundancy|bridge>",
      "issue": "<specific issue>",
      "severity": "high" | "medium" | "low",
      "recommended_edit": "<specific action to fix>"
    }}
  ],
  "strengths": ["<strength 1>", ...],
  "criteria_coverage": {{
    "<criterion>": "strong" | "partial" | "absent"
  }},
  "fundability_assessment": "<1-2 sentence overall verdict>",
  "top_priority_fixes": ["<most important fix 1>", "<fix 2>", "<fix 3>"]
}}"""

    response = await chat_complete(
        messages=[{"role": "user", "content": prompt}],
        agent_name="meta_agent",
        json_mode=True,
    )
    try:
        return json.loads(response)
    except (json.JSONDecodeError, TypeError):
        return {"issues": [], "overall": "adequate", "strengths": []}

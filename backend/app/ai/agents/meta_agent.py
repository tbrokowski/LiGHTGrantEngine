"""
Grant Meta-Agent Coordinator — single combined critique -> refine pass per section.

Runs one agentic critique-refine pass covering evidence grounding, call
compliance, and narrative/voice coherence together — reserved for
user-flagged priority sections and sections the execution plan singles out,
not every section. Agentic drafting (section_drafter_agentic.py) already
self-corrects most evidence/citation gaps inline, and the whole-document
alignment pass (document_editor.py, which replaces the old
check_narrative_coherence) catches cross-section issues with full-document
visibility a per-section loop never had anyway — so this pass exists for the
smaller set of sections that warrant an extra, deliberate look.
"""
from __future__ import annotations

import uuid
from typing import AsyncIterator, TYPE_CHECKING

from app.ai.client import chat_complete, chat_complete_with_tools
from app.ai.agents.rag_tools import RAG_TOOL_DEFS, build_rag_tool_executor

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


# ── Combined critique focus ────────────────────────────────────────────────────

_COMBINED_FOCUS = """Your mission, covering all of the following together:
• EVIDENCE — Check every quantitative claim for an inline citation (Author, Year). If missing,
  search_rag_corpus or search_web to find one, then rewrite_section to embed it. Replace any
  [VERIFY: ...] placeholders you can source; leave genuinely unsourceable ones as-is.
• CALL COMPLIANCE — Map every evaluation criterion from the call requirements against this
  section. For any that are under-addressed, use search_rag_corpus for strong exemplar language,
  then rewrite_section to fill the gap.
• COHERENCE & VOICE — Check that this section connects to the proposal's theory of change and
  cross-section themes without repeating prior sections, and that voice/tone matches the style
  profile.
Be decisive: only rewrite where there's a substantive gap in one of these dimensions, not for
cosmetic reasons. Call accept_section once the section is solid across all three."""

# ── System prompt ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a rigorous grant quality auditor embedded inside a proposal writing pipeline.

You are running a single combined critique-refine pass on one section — evidence grounding,
call compliance, and narrative coherence/voice are all in scope for this one pass.

QUALITY DIMENSIONS (assess all):

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
- search_rag_corpus → retrieve prior awarded proposal excerpts on a concept (search by the
  underlying method/concept, never by this proposal's own named platforms/tools/acronyms)
- search_named_archive → look up a SPECIFIC prior proposal by name and search within it
- search_web → retrieve current evidence, statistics, or citations
- search_academic → retrieve a peer-reviewed citation for a scientific/clinical/technical claim
- rewrite_section → targeted rewrite to incorporate what you found (always pair with a search)
- ask_user → LAST RESORT for data the AI cannot have (team prelim results, partner names,
  budget figures, PI credentials). Maximum 1 ask_user call per pass.
- accept_section → call when the section is solid across all dimensions

RULES:
- Be decisive. If the section already passes, call accept_section immediately.
- Do NOT rewrite for cosmetic reasons — only when there is a substantive quality gap.
- After a rewrite, briefly re-evaluate before deciding to accept or search more.
"""

# ── Tool definitions ──────────────────────────────────────────────────────────

TOOLS = RAG_TOOL_DEFS + [
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
    def _log_search(tool_name: str, arguments: dict, result: dict) -> None:
        if tool_name == "search_named_archive":
            query_label = f"{arguments.get('archive_name', '')}: {arguments.get('query', '')}"
        elif tool_name == "search_web":
            query_label = "; ".join((arguments.get("queries") or [])[:2])
        else:
            query_label = arguments.get("query", "")
        state.events.append({
            "event": "meta_agent_action",
            "tool": tool_name,
            "query": query_label,
            "section": section_name,
            "round": round_num,
            "results_count": len(result.get("results") or []),
        })

    rag_executor = build_rag_tool_executor(db, section_type, funder, on_result=_log_search)

    async def executor(tool_name: str, arguments: dict) -> dict:
        if tool_name in ("search_rag_corpus", "search_named_archive", "search_web", "search_academic"):
            return await rag_executor(tool_name, arguments)

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

    prompt = f"""You are doing a targeted rewrite of a grant proposal section as part of a
combined evidence/compliance/coherence critique pass.

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

REWRITE INSTRUCTION:
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
    initial_issues: list[str] | None = None,
) -> AsyncIterator[dict]:
    """
    Run one combined critique-refine pass on a section — evidence grounding,
    call compliance, and narrative coherence/voice together (see _COMBINED_FOCUS).

    Yields SSE-compatible event dicts:
      meta_agent_thinking  — pass starting
      meta_agent_action    — tool being called (rag / web / rewrite)
      meta_agent_revision  — section was rewritten
      meta_agent_question  — user input needed
      meta_agent_round_complete — pass finished
      meta_agent_accepted  — final content in event["content"]
    """
    state = _SectionRewriteState(content=section_content)
    round_num = 1

    theory_of_change = narrative_context.get("theory_of_change", "")
    funder_priorities = ", ".join(narrative_context.get("funder_priorities_to_emphasize", []))
    style_voice = (style_profile or {}).get("voice_summary", "")
    cross_themes = ", ".join(narrative_context.get("cross_section_themes", []))

    yield {
        "event": "meta_agent_thinking",
        "section": section_name,
        "round": round_num,
        "total_rounds": 1,
        "message": f"Combined critique pass: {_COMBINED_FOCUS.split(chr(10))[0]}",
    }

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

    issues_block = ""
    if initial_issues:
        issues_block = (
            "\nKNOWN ISSUES (from a deterministic pre-check — fix these):\n"
            + "\n".join(f"  • {iss}" for iss in initial_issues[:6])
        )

    user_prompt = f"""You are running a combined critique-refine pass on one section.

{_COMBINED_FOCUS}

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

CURRENT CONTENT:
{state.current_content}

━━━ CALL REQUIREMENTS ━━━
{call_requirements[:2000]}

━━━ DOCUMENT SO FAR (for coherence) ━━━
{prior_sections_summary[:4500] if prior_sections_summary else 'No prior sections yet.'}
{issues_block}
━━━ YOUR TASK ━━━
Use tools to search and fix substantive gaps. Then call accept_section with your verdict."""

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]

    await chat_complete_with_tools(
        messages=messages,
        tools=TOOLS,
        tool_executor=executor,
        agent_name="meta_agent",
        max_rounds=6,  # tool-call budget for the combined pass
    )

    for event in state.events:
        yield event

    if not state.accepted:
        yield {
            "event": "meta_agent_round_complete",
            "section": section_name,
            "round": round_num,
            "verdict": "Pass completed (auto-accepted)",
        }
    else:
        yield {
            "event": "meta_agent_round_complete",
            "section": section_name,
            "round": round_num,
            "total_rounds": 1,
            "verdict": state.round_verdicts[-1] if state.round_verdicts else "Pass complete",
        }

    yield {
        "event": "meta_agent_accepted",
        "section": section_name,
        "verdict": " | ".join(state.round_verdicts) or "Combined critique pass complete",
        "content": state.current_content,
        "rounds_completed": 1,
    }

    for q in state.user_questions:
        if q.get("event") == "meta_agent_question":
            yield q

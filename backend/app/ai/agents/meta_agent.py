"""
Grant Meta-Agent Coordinator
The quality-gating brain of the draft generation pipeline.

After each section is drafted, this agent:
1. Evaluates it across 6 quality dimensions
2. For each issue, calls tools to attempt an autonomous fix (RAG, web search, rewrite)
3. Only surfaces a question to the user when a fix requires institutional data it cannot infer
4. Yields SSE-compatible event dicts as it works so the frontend can show live activity

Loop pattern (up to max_rounds per section):
  Evaluate → tool calls (RAG / web / rewrite) → re-evaluate → accept or collect question
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


# ── System prompt ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a rigorous grant quality auditor embedded inside a proposal writing pipeline.

You receive a drafted proposal section and must evaluate it across these dimensions:

1. SPECIFICITY: Is the section too generic? Must name concrete methods, datasets, geographies, timelines, model architectures, sample sizes. "We will use AI" is not specific. "We will fine-tune a ResNet-50 on the X dataset across 3 LMIC sites" is specific.

2. CLAIM SUPPORT: Every factual claim (prevalence rates, model performance numbers, outcome statistics) must be backed by a citation or marked [VERIFY]. Unsupported claims are a reviewer red flag.

3. RAG ALIGNMENT: Call search_rag_corpus when you identify a key concept (a methodology, a disease area, a geography, a model type) that might exist in our archive of prior successful proposals. If found, the prior language should be incorporated.

4. NARRATIVE COHERENCE: Does this section connect to the overall theory of change? Does it build on or reference prior sections? Does it move the story forward?

5. CALL COMPLIANCE: Does the section address the relevant evaluation criteria? Are there coverage gaps relative to what the funder asked for?

6. VOICE/STYLE: Does the language match the institutional style profile? Is it appropriately formal, technical, and impact-focused?

FOR EACH ISSUE FOUND:
- First attempt an AUTONOMOUS FIX:
  a. Call search_rag_corpus for concepts/methods/claims that might be in the archive
  b. Call search_web for specific statistics, recent evidence, or citations
  c. If you found useful material, call rewrite_section with specific instructions
- Only call ask_user if the fix requires data the AI cannot have:
  - Specific team preliminary results or data
  - Named partner institutions or contacts
  - Budget line items or institutional costs
  - PI names, roles, or credentials

IMPORTANT:
- Be decisive. If a section is good enough, accept it without rewriting.
- Do not rewrite for cosmetic reasons — only rewrite when there is a substantive quality problem.
- After rewriting, re-evaluate. If the section now passes all checks, accept it.
- Maximum 3 tool-calling rounds per section.
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
                    "query": {
                        "type": "string",
                        "description": "The concept, method, claim, or topic to search for in the corpus",
                    },
                    "section_type": {
                        "type": "string",
                        "description": "Optional section type filter (e.g. methods, background, impact_statement)",
                    },
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
                "Use when the section makes a factual claim that needs backing or a statistic is missing."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "queries": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "1–3 targeted search queries for the claim or evidence needed",
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
                "Provide the exact instruction (what to fix) and any new evidence/content to incorporate. "
                "The rewrite preserves the section's structure and voice."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "instruction": {
                        "type": "string",
                        "description": "Specific instruction: what to fix and how (e.g. 'Add TB prevalence statistic from search results; name the specific ML model being used')",
                    },
                    "evidence_to_incorporate": {
                        "type": "string",
                        "description": "New content, citations, or RAG excerpts to weave into the rewrite",
                    },
                    "reason": {
                        "type": "string",
                        "description": "Brief label for the frontend activity log (e.g. 'Added technical specificity', 'Incorporated corpus language')",
                    },
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
                "Surface a targeted question to the user when a quality issue cannot be resolved "
                "without institutional data the AI does not have (preliminary results, partner names, "
                "budget details, PI credentials). Only call this as a last resort after attempting "
                "autonomous fixes."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {
                        "type": "string",
                        "description": "The specific question to ask the user (be concise and actionable)",
                    },
                    "why": {
                        "type": "string",
                        "description": "Why this information is needed and how it will improve the section",
                    },
                    "section_context": {
                        "type": "string",
                        "description": "Which part of the section needs this information",
                    },
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
                "Mark the section as accepted — it has passed all quality checks "
                "and is ready to be included in the final draft. "
                "Call this when the section is good enough or after a successful rewrite."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "verdict": {
                        "type": "string",
                        "description": "Brief summary of quality assessment (e.g. 'Strong methods section with good specificity')",
                    },
                },
                "required": ["verdict"],
            },
        },
    },
]


# ── Tool executor ─────────────────────────────────────────────────────────────

class _SectionRewriteState:
    """Mutable state passed through tool calls for the current section."""
    def __init__(self, content: str):
        self.current_content = content
        self.accepted = False
        self.user_questions: list[dict] = []
        self.events: list[dict] = []


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
):
    """
    Returns an async callable(tool_name, arguments) -> dict
    that dispatches tool calls and updates state.
    """
    async def executor(tool_name: str, arguments: dict) -> dict:
        if tool_name == "search_rag_corpus":
            query = arguments.get("query", "")
            sec_type = arguments.get("section_type", section_type)
            results = await retrieve_content_exemplars(
                query=query,
                db=db,
                section_type=sec_type,
                funder=funder,
                top_k=3,
            )
            state.events.append({
                "event": "meta_agent_action",
                "tool": "search_rag_corpus",
                "query": query,
                "section": section_name,
                "results_count": len(results),
            })
            if not results:
                return {"found": False, "results": []}
            excerpts = [
                {
                    "grant_title": r.get("grant_title", ""),
                    "section_type": r.get("section_type", ""),
                    "outcome": r.get("outcome", ""),
                    "excerpt": r.get("full_text", "")[:800],
                }
                for r in results[:3]
            ]
            return {"found": True, "results": excerpts}

        elif tool_name == "search_web":
            queries = arguments.get("queries", [])
            if not queries:
                return {"found": False, "results": []}
            state.events.append({
                "event": "meta_agent_action",
                "tool": "search_web",
                "query": "; ".join(queries[:2]),
                "section": section_name,
            })
            results = await search_web_multi(queries[:3], max_results_per_query=3)
            if not results:
                return {"found": False, "results": []}
            return {
                "found": True,
                "results": [
                    {"title": r["title"], "url": r["url"], "content": r["content"][:500]}
                    for r in results[:5]
                ],
            }

        elif tool_name == "rewrite_section":
            instruction = arguments.get("instruction", "")
            evidence = arguments.get("evidence_to_incorporate", "")
            reason = arguments.get("reason", "Quality improvement")

            state.events.append({
                "event": "meta_agent_action",
                "tool": "rewrite_section",
                "query": reason,
                "section": section_name,
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
            )
            state.current_content = rewritten
            state.events.append({
                "event": "meta_agent_revision",
                "section": section_name,
                "reason": reason,
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
            }
            state.user_questions.append(q)
            state.events.append(q)
            return {"acknowledged": True, "question_id": question_id}

        elif tool_name == "accept_section":
            state.accepted = True
            state.events.append({
                "event": "meta_agent_accepted",
                "section": section_name,
                "verdict": arguments.get("verdict", "Accepted"),
            })
            return {"accepted": True}

        return {"error": f"Unknown tool: {tool_name}"}

    return executor


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
) -> str:
    """
    Targeted rewrite of a section to fix a specific quality issue.
    Returns improved HTML content.
    """
    evidence_block = f"\nNEW EVIDENCE/CONTENT TO INCORPORATE:\n{evidence}\n" if evidence else ""
    style_str = ""
    if style_profile:
        voice = style_profile.get("voice_summary", "")
        tone = style_profile.get("tone", "")
        if voice or tone:
            style_str = f"\nSTYLE: {voice} {tone}".strip()

    prompt = f"""You are rewriting a grant proposal section to fix a specific quality issue.
Preserve the section's voice, structure, and core content. Make only the targeted improvements.

SECTION: {section_name}
FUNDER: {funder}
GRANT IDEA (for context): {grant_idea[:1000]}
{style_str}

CURRENT CONTENT:
{current_content}
{evidence_block}
CALL REQUIREMENTS (compliance guidance):
{call_requirements[:2000]}

REWRITE INSTRUCTION:
{instruction}

Rewrite the section now. Return ONLY the improved section text (HTML paragraphs).
Do not include the section heading. Preserve [TBD], [CUSTOMIZE:], and [VERIFY:] markers
unless you are specifically replacing them with real content."""

    result = await chat_complete(
        messages=[{"role": "user", "content": prompt}],
        agent_name="meta_agent",
    )
    # If the response doesn't look like HTML, wrap it
    if result and not result.strip().startswith("<"):
        result = "".join(f"<p>{p.strip()}</p>" for p in result.split("\n\n") if p.strip())
    return result or current_content


# ── Main entry point ──────────────────────────────────────────────────────────

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
) -> AsyncIterator[dict]:
    """
    Evaluate a drafted section and attempt autonomous quality improvements.

    Yields SSE-compatible event dicts:
      meta_agent_thinking  — agent is evaluating
      meta_agent_action    — tool being called (rag / web / rewrite)
      meta_agent_revision  — section was rewritten
      meta_agent_question  — user input needed
      meta_agent_accepted  — section passed and is final

    The last yielded event is always meta_agent_accepted with the final
    `content` field containing the improved section HTML.
    """
    state = _SectionRewriteState(content=section_content)

    # Initial thinking event
    yield {
        "event": "meta_agent_thinking",
        "section": section_name,
        "message": f"Evaluating {section_name}…",
    }

    executor = await _build_tool_executor(
        state=state,
        section_name=section_name,
        section_type=section_type,
        call_requirements=call_requirements,
        narrative_context=narrative_context,
        style_profile=style_profile,
        grant_idea=grant_idea,
        funder=funder,
        db=db,
    )

    theory_of_change = narrative_context.get("theory_of_change", "")
    funder_priorities = ", ".join(narrative_context.get("funder_priorities_to_emphasize", []))
    style_voice = style_profile.get("voice_summary", "") if style_profile else ""

    evaluation_user_prompt = f"""Evaluate this proposal section and fix any quality issues using the tools available.

GRANT: {grant_idea[:600]}
FUNDER: {funder}
THEORY OF CHANGE: {theory_of_change or 'See grant idea'}
FUNDER PRIORITIES: {funder_priorities or 'See call requirements'}
INSTITUTIONAL VOICE: {style_voice or 'Professional academic'}

SECTION NAME: {section_name}
SECTION TYPE: {section_type}

SECTION CONTENT:
{state.current_content}

PRIOR SECTIONS SUMMARY (for coherence check):
{prior_sections_summary[:1500] if prior_sections_summary else 'This is the first or only section.'}

CALL REQUIREMENTS (for compliance check):
{call_requirements[:2000]}

Evaluate the section across all 6 quality dimensions. Use tools to fix issues.
When done (either the section passes or you've addressed what you can), call accept_section."""

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": evaluation_user_prompt},
    ]

    # Run the tool-calling loop
    _final_text, _tool_log = await chat_complete_with_tools(
        messages=messages,
        tools=TOOLS,
        tool_executor=executor,
        agent_name="meta_agent",
        max_rounds=max_rounds,
    )

    # Yield all events that were collected during tool execution
    for event in state.events:
        yield event

    # If the agent never explicitly called accept_section, accept anyway
    if not state.accepted:
        yield {
            "event": "meta_agent_accepted",
            "section": section_name,
            "verdict": "Accepted (max rounds reached)",
            "content": state.current_content,
        }
    else:
        # Find the accept event and add the final content
        for event in state.events:
            if event.get("event") == "meta_agent_accepted":
                event["content"] = state.current_content
                break
        else:
            yield {
                "event": "meta_agent_accepted",
                "section": section_name,
                "verdict": "Accepted",
                "content": state.current_content,
            }


async def check_narrative_coherence(
    sections: list[dict],
    narrative_context: dict,
    call_requirements: str,
    grant_idea: str,
) -> dict:
    """
    One-shot check of narrative coherence across all sections.
    Returns {"issues": [...], "overall": "strong|adequate|weak"}.
    """
    if not sections:
        return {"issues": [], "overall": "adequate"}

    summaries = "\n\n".join(
        f"## {s.get('name', '?')}\n{(s.get('content') or '')[:400]}"
        for s in sections[:10]
    )
    theory = narrative_context.get("theory_of_change", "")
    themes = ", ".join(narrative_context.get("cross_section_themes", []))

    prompt = f"""Assess the narrative coherence of this multi-section grant proposal.

THEORY OF CHANGE: {theory or 'Not specified'}
CROSS-SECTION THEMES: {themes or 'Not specified'}
GRANT IDEA: {grant_idea[:400]}
CALL REQUIREMENTS (summary): {call_requirements[:800]}

SECTION SUMMARIES:
{summaries}

Identify:
1. Any sections that feel disconnected from the overall narrative
2. Redundant content across sections
3. Missing transitions or logical gaps between sections
4. Any evaluation criteria from the call not addressed anywhere

Return JSON:
{{
  "overall": "strong" | "adequate" | "weak",
  "issues": [
    {{"section": "name or global", "issue": "description", "severity": "high|medium|low"}}
  ],
  "strengths": ["strength 1", ...]
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

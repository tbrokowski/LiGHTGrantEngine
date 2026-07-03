"""
Agentic section drafter.

Replaces the old "draft once, then redraft-if-evidence-check-fails" pair of
top-level LLM calls with a single tool-calling session: the model gets a
warm-start evidence bundle (from the existing Phase 2 research pass) but can
also call search_rag_corpus / search_web / search_academic mid-draft to pull
more evidence on demand, then calls submit_draft when the section is done.
This lets the model self-correct citation/grounding gaps inline instead of
needing a separate redraft pass.
"""
from __future__ import annotations

import json
from typing import Any, TYPE_CHECKING

from app.ai.client import chat_complete_with_tools
from app.ai.agents.draft_section_context import build_section_draft_context
from app.ai.context.grant_context import DEFAULT_INTRO_ARC
from app.ai.rag.retriever import retrieve_content_exemplars
from app.services.web_search import search_web_multi
from app.services.citation_lookup import search_citations

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_rag_corpus",
            "description": (
                "Search the institutional archive of prior awarded and submitted proposals "
                "for excerpts matching a concept, methodology, disease area, or geography. "
                "Use while writing whenever you need a specific detail, number, or framing "
                "not already covered in the evidence provided below."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Concept, method, claim, or topic to search for"},
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
                "Search the web for current evidence, statistics, or citations to support a specific claim. "
                "Use when a factual claim needs backing you don't already have."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "queries": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "1-3 targeted search queries",
                    },
                },
                "required": ["queries"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_academic",
            "description": (
                "Search academic literature (PubMed, OpenAlex) for a peer-reviewed citation backing "
                "a specific scientific, clinical, or technical claim."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The specific claim or topic needing a citation"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "submit_draft",
            "description": (
                "Submit the finished section. Call this exactly once, when the section is complete, "
                "specific, evidence-grounded (every quantitative/comparative claim has an inline "
                "(Author, Year) citation or a [VERIFY: ...] marker), and within the word target."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "draft": {"type": "string", "description": "Full section HTML (<p>, <h3>, <ul><li>, <table> only, no markdown)"},
                    "word_count": {"type": "integer"},
                    "citations_used": {"type": "array", "items": {"type": "string"}},
                    "citation_markers": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {"marker": {"type": "string"}, "full_citation": {"type": "string"}},
                        },
                    },
                    "sources_used": {"type": "array", "items": {"type": "string"}},
                    "warnings": {"type": "array", "items": {"type": "string"}},
                    "human_review_required": {"type": "boolean"},
                    "evaluation_criteria_addressed": {"type": "array", "items": {"type": "string"}},
                    "key_asks_addressed": {"type": "array", "items": {"type": "string"}},
                    "gaps_identified": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["draft", "word_count"],
            },
        },
    },
]

_TOOL_MODE_ADDENDUM = """

═══════════════════════════════════════════════════════════════
TOOL-CALLING MODE
═══════════════════════════════════════════════════════════════
Ignore the "Return valid JSON" instruction above — this session uses tool-calling instead:
- Call search_rag_corpus / search_web / search_academic whenever you need a specific detail,
  statistic, or citation you don't already have from the evidence provided.
- When the section is complete, call submit_draft exactly once with the same fields
  (draft, word_count, citations_used, citation_markers, sources_used, warnings,
  human_review_required, evaluation_criteria_addressed, key_asks_addressed, gaps_identified).
- Do not return the draft as plain text — it must go through submit_draft."""


def _build_tool_executor(
    db: "AsyncSession",
    section_type: str,
    funder: str,
    submitted: dict,
) -> Any:
    async def executor(tool_name: str, arguments: dict) -> dict:
        if tool_name == "search_rag_corpus":
            query = arguments.get("query", "")
            if not query:
                return {"found": False, "results": []}
            results = await retrieve_content_exemplars(
                query=query, db=db, section_type=section_type, funder=funder, top_k=4,
            )
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

        elif tool_name == "search_academic":
            query = arguments.get("query", "")
            if not query:
                return {"found": False, "results": []}
            results = await search_citations(query, max_results=5)
            if not results:
                return {"found": False, "results": []}
            return {"found": True, "results": results[:5]}

        elif tool_name == "submit_draft":
            submitted.update(arguments)
            return {"received": True}

        return {"error": f"Unknown tool: {tool_name}"}

    return executor


def _render_document_so_far(adjacent_sections: list[tuple[str, str]], ledger_block: str) -> str:
    """Full text of the 1-2 immediately preceding sections, plus a compact ledger
    of everything earlier. Adjacent sections need full context for local
    coherence/transitions; distant sections only need the facts a later
    section must stay consistent with — not their full prose."""
    if not adjacent_sections and not ledger_block:
        return ""
    parts = ["DOCUMENT SO FAR (maintain continuity — reference by name, do not repeat):"]
    if ledger_block:
        parts.append("Earlier sections (factual record):\n" + ledger_block)
    for name, html in adjacent_sections:
        parts.append(f"─── Immediately preceding section: '{name}' (full text) ───\n{(html or '')[:6000]}")
    return "\n\n".join(parts)


async def draft_section_agentic(
    agent: str,
    section_name: str,
    db: "AsyncSession",
    funder: str = "",
    section_type: str = "other",
    adjacent_sections: list[tuple[str, str]] | None = None,
    ledger_block: str = "",
    outline: list[str] | None = None,
    **kwargs: Any,
) -> dict:
    """Agentic replacement for section_router.draft_section_routed.

    Returns the same JSON shape the old pipeline produced (draft, word_count,
    citations_used, warnings, ...), so downstream code needs no changes.
    """
    is_intro = bool(kwargs.pop("is_intro", False))
    agent_kind = "intro" if is_intro else agent

    intro_arc_str = ""
    if agent_kind == "intro":
        arc = kwargs.get("intro_arc") or DEFAULT_INTRO_ARC
        intro_arc_str = "\n".join(
            f"{i + 1}. {beat.get('label', beat.get('beat', ''))}: {beat.get('guidance', '')}"
            for i, beat in enumerate(arc)
        )

    ctx = build_section_draft_context(
        section_name=section_name,
        section_type=section_type,
        agent_kind=agent_kind,
        grant_idea=kwargs.get("grant_idea", ""),
        skeleton_content=kwargs.get("skeleton_content", ""),
        call_requirements=kwargs.get("call_requirements", ""),
        call_narrative_brief=kwargs.get("call_narrative_brief", ""),
        evaluation_criteria=kwargs.get("evaluation_criteria"),
        section_specific_requirements=kwargs.get("section_specific_requirements"),
        evidence_summary=kwargs.get("evidence_summary", ""),
        key_evidence=kwargs.get("key_evidence"),
        retrieved_sections=kwargs.get("retrieved_sections"),
        style_exemplars=kwargs.get("style_exemplars"),
        reusable_language=kwargs.get("reusable_language"),
        concept_bundles=kwargs.get("concept_bundles"),
        citations=kwargs.get("citations"),
        narrative_context=kwargs.get("narrative_context"),
        strategic_guidance=kwargs.get("strategic_guidance", ""),
        emphasis_direction=kwargs.get("emphasis_direction", ""),
        writing_instructions=kwargs.get("writing_instructions", ""),
        compliance_guidance=kwargs.get("compliance_guidance", ""),
        opening_hook=kwargs.get("opening_hook", ""),
        strategic_framing=kwargs.get("strategic_framing", ""),
        funder=funder,
        style_profile=kwargs.get("style_profile"),
        target_words=kwargs.get("target_words"),
        min_words=kwargs.get("min_words"),
        user_instructions=kwargs.get("user_instructions", ""),
        intro_arc_str=intro_arc_str,
        refinement_feedback=kwargs.get("refinement_feedback", ""),
    )

    user_prompt = ctx.user_prompt
    doc_so_far = _render_document_so_far(adjacent_sections or [], ledger_block)
    if doc_so_far:
        user_prompt += "\n\n" + doc_so_far
    if outline:
        user_prompt += "\n\nSTRUCTURE THIS SECTION USING THE FOLLOWING OUTLINE (write it as ONE continuous " \
            "section in a single pass — do not fragment it into separate documents):\n" + \
            "\n".join(f"  {i+1}. {item}" for i, item in enumerate(outline))

    system_prompt = ctx.system_prompt + _TOOL_MODE_ADDENDUM

    submitted: dict = {}
    executor = _build_tool_executor(db, section_type, funder, submitted)

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    final_text, _tool_log = await chat_complete_with_tools(
        messages=messages,
        tools=TOOLS,
        tool_executor=executor,
        agent_name="section_drafter_agentic",
        max_rounds=8,
    )

    if submitted.get("draft"):
        draft_text = submitted["draft"]
        return {
            "draft": draft_text,
            "word_count": submitted.get("word_count") or len(draft_text.split()),
            "citations_used": submitted.get("citations_used") or [],
            "citation_markers": submitted.get("citation_markers") or [],
            "sources_used": submitted.get("sources_used") or [],
            "warnings": submitted.get("warnings") or [],
            "human_review_required": submitted.get("human_review_required", False),
            "evaluation_criteria_addressed": submitted.get("evaluation_criteria_addressed") or [],
            "key_asks_addressed": submitted.get("key_asks_addressed") or [],
            "gaps_identified": submitted.get("gaps_identified") or [],
        }

    # Fallback: model never called submit_draft (exhausted tool budget or replied
    # with plain text) — use whatever text it returned rather than losing the section.
    text = final_text or ""
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict) and parsed.get("draft"):
            return parsed
    except (json.JSONDecodeError, TypeError):
        pass
    if text and not text.strip().startswith("<"):
        text = "".join(f"<p>{p.strip()}</p>" for p in text.split("\n\n") if p.strip())
    return {
        "draft": text,
        "word_count": len(text.split()),
        "warnings": ["Model did not call submit_draft — used fallback text extraction"],
        "human_review_required": True,
    }

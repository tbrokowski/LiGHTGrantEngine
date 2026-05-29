"""
Research Agent
Per-section subagent that gathers an evidence bundle by running Tavily web search,
OpenAlex/PubMed academic search, and RAG corpus retrieval in parallel.
Returns a structured evidence_bundle for the section drafter to incorporate.
"""
from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING

from app.ai.client import chat_complete
from app.services.citation_lookup import search_citations
from app.services.web_search import search_web_multi

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

SYNTHESIS_SYSTEM_PROMPT = """You are a research synthesis specialist supporting grant proposal writing.

Given raw search results (web sources and academic citations), your task is to:
1. Identify the most relevant and credible sources for the section's claims
2. Extract key statistics, findings, or evidence that directly support the section content
3. Note any important context, caveats, or contradictions in the evidence
4. Rank sources by relevance and credibility

Return valid JSON."""

SYNTHESIS_USER_PROMPT = """Section: {section_name}
Section content (user skeleton):
{section_content}

Key claims to support: {key_claims}

WEB SEARCH RESULTS:
{web_results}

ACADEMIC CITATIONS:
{academic_results}

ARCHIVE EXCERPTS (prior awarded grants — prioritize for named programs):
{archive_results}

Select and synthesise the most useful evidence. Return JSON:
{{
  "key_evidence": [
    {{
      "claim": "the claim or stat this supports",
      "source_title": "...",
      "source_url": "...",
      "source_type": "web" | "academic",
      "excerpt": "the specific text or stat to use",
      "formatted_citation": "author (year) title. url"
    }}
  ],
  "summary_for_drafter": "2–3 sentence summary of the most important evidence found",
  "suggested_citations": ["formatted citation 1", "formatted citation 2"]
}}"""


async def gather_section_evidence(
    section_name: str,
    section_content: str,
    section_brief: dict,
    db: "AsyncSession",
    funder: str = "",
    section_type: str = "other",
    rag_style_exemplars: list[dict] | None = None,
    rag_content_exemplars: list[dict] | None = None,
    rag_reusable_language: list[dict] | None = None,
) -> dict:
    """
    Gather an evidence bundle for a single section.

    Returns:
      {
        "key_evidence": [...],
        "summary_for_drafter": "...",
        "suggested_citations": [...],
        "web_results": [...],       # raw for downstream reference
        "academic_results": [...],  # raw for downstream reference
        "rag_style_exemplars": [...],
        "rag_content_exemplars": [...],
        "rag_reusable_language": [...],
      }
    """
    web_queries: list[str] = section_brief.get("web_search_queries") or []
    academic_queries: list[str] = section_brief.get("academic_search_queries") or []

    # Fall back to a generic query if the planning agent produced none
    if not web_queries:
        web_queries = [f"{section_name} {section_content[:120]}"]
    if not academic_queries:
        academic_queries = [f"{section_name}"]

    # Parallel: web search + academic citations
    web_task = search_web_multi(web_queries, max_results_per_query=4)
    academic_task = _gather_academic(academic_queries)

    web_results, academic_results = await asyncio.gather(
        web_task, academic_task, return_exceptions=True
    )
    if isinstance(web_results, Exception):
        web_results = []
    if isinstance(academic_results, Exception):
        academic_results = []

    # Synthesise with LLM to extract the most useful evidence
    synthesis = await _synthesise_evidence(
        section_name=section_name,
        section_content=section_content,
        key_claims=section_brief.get("key_claims_to_support") or [],
        web_results=web_results,
        academic_results=academic_results,
    )

    return {
        "key_evidence": synthesis.get("key_evidence", []),
        "summary_for_drafter": synthesis.get("summary_for_drafter", ""),
        "suggested_citations": synthesis.get("suggested_citations", []),
        "web_results": web_results[:8],
        "academic_results": academic_results[:8],
        "rag_style_exemplars": rag_style_exemplars or [],
        "rag_content_exemplars": rag_content_exemplars or [],
        "rag_reusable_language": rag_reusable_language or [],
    }


async def _gather_academic(queries: list[str]) -> list[dict]:
    """Run academic citation searches in parallel and deduplicate."""
    tasks = [search_citations(q, max_results=4) for q in queries[:3]]
    results_nested = await asyncio.gather(*tasks, return_exceptions=True)
    seen: set[str] = set()
    merged: list[dict] = []
    for batch in results_nested:
        if isinstance(batch, Exception):
            continue
        for r in batch:
            key = (r.get("title") or "").lower()[:80]
            if key and key not in seen:
                seen.add(key)
                merged.append(r)
    return merged[:10]


async def _synthesise_evidence(
    section_name: str,
    section_content: str,
    key_claims: list[str],
    web_results: list[dict],
    academic_results: list[dict],
    rag_content_exemplars: list[dict] | None = None,
) -> dict:
    """Use LLM to select and synthesise the most relevant evidence."""
    if not web_results and not academic_results and not rag_content_exemplars:
        return {"key_evidence": [], "summary_for_drafter": "", "suggested_citations": []}

    web_str = _format_web_results(web_results[:6])
    academic_str = _format_academic_results(academic_results[:8])
    archive_str = _format_archive_results((rag_content_exemplars or [])[:6])

    user_prompt = SYNTHESIS_USER_PROMPT.format(
        section_name=section_name,
        section_content=section_content[:600],
        key_claims=", ".join(key_claims[:5]) or "General support needed",
        web_results=web_str or "None found",
        academic_results=academic_str or "None found",
        archive_results=archive_str or "None found",
    )

    response = await chat_complete(
        messages=[
            {"role": "system", "content": SYNTHESIS_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        agent_name="research_agent",
        json_mode=True,
    )

    try:
        return json.loads(response)
    except (json.JSONDecodeError, TypeError):
        return {"key_evidence": [], "summary_for_drafter": "", "suggested_citations": []}




def _format_archive_results(results: list[dict]) -> str:
    lines = []
    for i, r in enumerate(results or [], 1):
        title = r.get("grant_title", "?")
        snippet = (r.get("full_text") or r.get("text_snippet") or "")[:500]
        lines.append(f"{i}. [{title}] ({r.get('outcome','?')})\n   {snippet}")
    return "\n\n".join(lines)

def _format_web_results(results: list[dict]) -> str:
    lines = []
    for i, r in enumerate(results, 1):
        lines.append(
            f"{i}. [{r.get('title', 'No title')}]({r.get('url', '')})\n"
            f"   {r.get('content', '')[:400]}"
        )
    return "\n\n".join(lines)


def _format_academic_results(results: list[dict]) -> str:
    lines = []
    for i, r in enumerate(results, 1):
        lines.append(
            f"{i}. {r.get('formatted_citation', r.get('title', 'Unknown'))}\n"
            f"   URL: {r.get('url', '')}"
        )
    return "\n".join(lines)

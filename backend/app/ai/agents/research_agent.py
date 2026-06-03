"""
Research Agent
Per-section subagent that gathers an evidence bundle by running:
  - Tavily web search (keyword-based, fast)
  - Exa.ai neural search (semantic/natural-language, finds grey literature & policy docs)
  - OpenAlex/PubMed academic search
  - RAG corpus retrieval
All three search arms run in parallel; results are merged and synthesised by LLM.
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

WEB SEARCH RESULTS (Tavily — keyword search):
{web_results}

EXA NEURAL SEARCH RESULTS (semantic search — grey literature, policy docs, programme evaluations):
{exa_results}

ACADEMIC CITATIONS (PubMed/OpenAlex — peer-reviewed):
{academic_results}

ARCHIVE EXCERPTS (prior awarded grants — prioritize for named programs):
{archive_results}

Select and synthesise the most useful evidence from ALL three search sources.
Prefer Exa results for policy context, grey literature, programme evaluations, and funder reports.
Prefer academic results for empirical claims and statistics.
Prefer web results for recent news, specific data, and current state-of-the-field.

Return JSON:
{{
  "key_evidence": [
    {{
      "claim": "the claim or stat this supports",
      "source_title": "...",
      "source_url": "...",
      "source_type": "web" | "exa" | "academic" | "archive",
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
    exa_queries: list[str] = section_brief.get("exa_search_queries") or []

    # Fall back to generic queries if the planning agent produced none
    if not web_queries:
        web_queries = [f"{section_name} {section_content[:120]}"]
    if not academic_queries:
        academic_queries = [f"{section_name}"]
    if not exa_queries:
        # Build neural-search-friendly fallback queries
        exa_queries = _build_fallback_exa_queries(
            section_name=section_name,
            section_content=section_content,
            funder=funder,
            key_claims=section_brief.get("key_claims_to_support") or [],
        )

    # Parallel: Tavily web search + Exa neural search + academic citations
    web_task = search_web_multi(web_queries, max_results_per_query=4)
    exa_task = _gather_exa_evidence(exa_queries, section_type=section_type)
    academic_task = _gather_academic(academic_queries)

    web_results, exa_results, academic_results = await asyncio.gather(
        web_task, exa_task, academic_task, return_exceptions=True
    )
    if isinstance(web_results, Exception):
        web_results = []
    if isinstance(exa_results, Exception):
        exa_results = []
    if isinstance(academic_results, Exception):
        academic_results = []

    # Synthesise with LLM to extract the most useful evidence
    synthesis = await _synthesise_evidence(
        section_name=section_name,
        section_content=section_content,
        key_claims=section_brief.get("key_claims_to_support") or [],
        web_results=web_results,
        exa_results=exa_results,
        academic_results=academic_results,
        rag_content_exemplars=rag_content_exemplars,
    )

    return {
        "key_evidence": synthesis.get("key_evidence", []),
        "summary_for_drafter": synthesis.get("summary_for_drafter", ""),
        "suggested_citations": synthesis.get("suggested_citations", []),
        "web_results": web_results[:8],
        "exa_results": exa_results[:8],
        "academic_results": academic_results[:8],
        "rag_style_exemplars": rag_style_exemplars or [],
        "rag_content_exemplars": rag_content_exemplars or [],
        "rag_reusable_language": rag_reusable_language or [],
    }


def _build_fallback_exa_queries(
    section_name: str,
    section_content: str,
    funder: str,
    key_claims: list[str],
) -> list[str]:
    """
    Build Exa-optimized neural search queries when the planning agent
    didn't produce them. Phrases queries as document-like sentences
    rather than keywords — Exa's neural search returns semantically
    similar documents, so queries should echo the language of the target doc.
    """
    name = section_name.lower()
    snippet = section_content[:200].strip()
    first_claim = (key_claims[0] if key_claims else snippet)[:120]
    funder_str = f" funded by {funder}" if funder else ""

    queries = [
        # Evidence sentence: what a study or report would say
        f"{first_claim} evidence from recent studies and evaluations",
        # Policy/programme context
        f"programme{funder_str} supporting {name} demonstrated measurable impact on {first_claim[:60]}",
    ]
    # For methods/technical sections, add a technical evidence query
    if any(k in name for k in ("method", "approach", "technical", "design", "protocol")):
        queries.append(
            f"technical approach using {snippet[:100]} showed significant improvement in outcomes"
        )
    # For impact/dissemination, add a policy/funder priority query
    elif any(k in name for k in ("impact", "dissemination", "sustainability", "outreach")):
        queries.append(
            f"policy report on impact measurement and sustainability of {name} initiatives"
        )
    # For background/context sections, add a landscape query
    elif any(k in name for k in ("background", "intro", "context", "rationale", "state of")):
        queries.append(
            f"systematic review of current landscape and unmet needs in {snippet[:80]}"
        )
    return queries[:3]


async def _gather_exa_evidence(
    queries: list[str],
    section_type: str = "other",
) -> list[dict]:
    """
    Run Exa neural searches in parallel and return deduplicated results.

    Uses type="auto" (balanced relevance/speed) for most sections.
    Limits to 3 queries to control cost; returns up to 6 results per query.
    """
    from app.services.exa_search import exa_search

    # Cap to 3 queries — each costs tokens; neural search is higher quality so fewer needed
    active_queries = queries[:3]
    if not active_queries:
        return []

    tasks = [exa_search(q, num_results=6, search_type="auto") for q in active_queries]
    results_nested = await asyncio.gather(*tasks, return_exceptions=True)

    seen_urls: set[str] = set()
    merged: list[dict] = []
    for batch in results_nested:
        if isinstance(batch, Exception):
            continue
        for r in batch:
            url = r.get("url", "")
            if url and url not in seen_urls:
                seen_urls.add(url)
                # Tag source as exa for downstream synthesis
                merged.append({**r, "source_type": "exa"})

    # Sort by score descending, return top 12
    merged.sort(key=lambda x: x.get("score", 0.0), reverse=True)
    return merged[:12]


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
    exa_results: list[dict],
    academic_results: list[dict],
    rag_content_exemplars: list[dict] | None = None,
) -> dict:
    """Use LLM to select and synthesise the most relevant evidence from all three search arms."""
    if not web_results and not exa_results and not academic_results and not rag_content_exemplars:
        return {"key_evidence": [], "summary_for_drafter": "", "suggested_citations": []}

    web_str = _format_web_results(web_results[:6])
    exa_str = _format_exa_results(exa_results[:8])
    academic_str = _format_academic_results(academic_results[:8])
    archive_str = _format_archive_results((rag_content_exemplars or [])[:6])

    user_prompt = SYNTHESIS_USER_PROMPT.format(
        section_name=section_name,
        section_content=section_content[:600],
        key_claims=", ".join(key_claims[:5]) or "General support needed",
        web_results=web_str or "None found",
        exa_results=exa_str or "None found",
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




def _format_exa_results(results: list[dict]) -> str:
    """Format Exa neural search results — highlight content excerpts (highlights)."""
    lines = []
    for i, r in enumerate(results, 1):
        title = r.get("title") or "No title"
        url = r.get("url") or ""
        content = (r.get("content") or "")[:400]
        score = r.get("score", 0.0)
        lines.append(
            f"{i}. [{title}]({url}) [score: {score:.2f}]\n"
            f"   {content}"
        )
    return "\n\n".join(lines)


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

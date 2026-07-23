"""
Chat assistant tools — async implementations callable by the agentic chat loop.

Each tool corresponds to an OpenAI function definition in CHAT_TOOLS and receives
arguments parsed from the LLM tool call plus injected dependencies (db, context).
"""
from __future__ import annotations

import asyncio
import json
import re
import structlog
from typing import Any

from sqlalchemy import select, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.rag.retriever import retrieve_content_exemplars, retrieve_entity_mentions
from app.services.citation_lookup import search_citations as _search_citations

logger = structlog.get_logger()


# ── OpenAI tool schemas ──────────────────────────────────────────────────────

CHAT_TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "search_archive",
            "description": (
                "Search the internal grant archive of the institution's past proposals. "
                "Use when the user asks how something has been written before, wants examples "
                "from funded grants, or needs inspiration for a section — AND to explain a "
                "named program, acronym, or concept from the institution's work (e.g. \"what "
                "is MOOVE?\", \"summarize our lung-ultrasound work\"): it matches the literal "
                "term across the archive and returns full excerpts to synthesize an answer from."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"},
                    "section_type": {
                        "type": "string",
                        "description": "Optional section type filter: intro, methodology, budget, impact, etc.",
                    },
                    "funder": {"type": "string", "description": "Optional funder name filter"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "lookup_opportunity",
            "description": (
                "Look up a specific grant opportunity or funding programme by name or keyword. "
                "Use when the user asks about a specific grant, programme, or funder call by name "
                "(e.g. 'tell me about MOOVE', 'what is Horizon Europe EIC Accelerator', "
                "'details on the NSF RAPID grant'). Returns full description, eligibility, "
                "deadlines, and fit score."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Name or keywords of the opportunity to look up",
                    }
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_citations",
            "description": (
                "Search OpenAlex and PubMed for peer-reviewed academic citations relevant to a "
                "topic or research claim. Use when the user asks for references, evidence, or "
                "literature on a topic, or wants to find papers to support a statement."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query for academic literature"},
                    "max_results": {
                        "type": "integer",
                        "description": "Maximum number of citations to return (default 5)",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_citation_for_text",
            "description": (
                "Given a piece of text — such as a highlighted claim, sentence, or paragraph — "
                "find academic citations that support it. Use when the user selects text and asks "
                "for a citation, reference, or evidence to back up a specific statement."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "The specific text or claim to find supporting citations for",
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Maximum number of citations to return (default 3)",
                    },
                },
                "required": ["text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_org_docs",
            "description": (
                "Search previously uploaded workspace documents and files for relevant content. "
                "Use when the user asks about internal documents, past proposals, uploaded files, "
                "or any content that was previously added to the workspace."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"},
                },
                "required": ["query"],
            },
        },
    },
]


# ── Tool display labels for SSE UI ────────────────────────────────────────────

def tool_display_label(name: str, args: dict) -> str:
    """Human-readable status string shown in the chat UI while a tool runs."""
    q = args.get("query") or args.get("text", "")
    short_q = q[:50] + ("…" if len(q) > 50 else "")
    labels = {
        "search_archive": f"Searching grant archive for '{short_q}'",
        "lookup_opportunity": f"Looking up '{short_q}'",
        "search_citations": f"Searching academic literature for '{short_q}'",
        "find_citation_for_text": f"Finding citations for highlighted text",
        "search_org_docs": f"Searching workspace documents for '{short_q}'",
    }
    return labels.get(name, f"Running {name}…")


# ── Tool implementations ──────────────────────────────────────────────────────

async def run_search_archive(
    query: str,
    section_type: str | None = None,
    funder: str | None = None,
    db: AsyncSession | None = None,
    grant_id: str | None = None,
) -> dict:
    """Search the archive for exemplar sections.

    Merges two retrieval modes so questions like "what is MOOVE?" work as well as
    thematic ones: literal entity-mention matches (essential for acronyms and named
    programs, which semantic search alone often misses) are surfaced first, then
    reranked hybrid content exemplars. Returns generous excerpts so the assistant
    can synthesize a real explanation rather than a one-line snippet.
    """
    try:
        content, entity = await asyncio.gather(
            retrieve_content_exemplars(
                query=query,
                db=db,
                section_type=section_type,
                funder=funder,
                top_k=5,
                current_grant_id=grant_id,
            ),
            retrieve_entity_mentions(
                entity=query.strip(),
                db=db,
                funder=funder,
                top_k=4,
                current_grant_id=grant_id,
            ),
        )
        # Entity (literal) hits first, then hybrid content hits; dedup by section id.
        seen: set[str] = set()
        merged: list[dict] = []
        for r in entity + content:
            sid = str(r.get("id", ""))
            if sid and sid in seen:
                continue
            if sid:
                seen.add(sid)
            merged.append(r)

        items = [
            {
                "grant_title": r.get("grant_title", "Unknown"),
                "funder": r.get("funder", ""),
                "outcome": r.get("outcome", ""),
                "section_type": r.get("section_type", ""),
                "excerpt": (r.get("full_text") or "")[:1200],
                "similarity": round(r.get("relevance_score", 0), 3),
            }
            for r in merged[:6]
        ]
        return {"results": items, "count": len(items)}
    except Exception as exc:
        logger.warning("search_archive tool failed", error=str(exc))
        return {"results": [], "count": 0, "error": str(exc)}


async def run_lookup_opportunity(
    query: str,
    db: AsyncSession | None = None,
    institution_id: str | None = None,
) -> dict:
    """Look up a specific opportunity by name/keyword from the institution's feed."""
    from app.models.opportunity import Opportunity
    from app.models.institution_opportunity import InstitutionOpportunity

    try:
        # Text search first — ILIKE on title and program_name
        q_pattern = f"%{query}%"
        stmt = (
            select(Opportunity, InstitutionOpportunity)
            .outerjoin(
                InstitutionOpportunity,
                (InstitutionOpportunity.opportunity_id == Opportunity.id)
                & (InstitutionOpportunity.institution_id == institution_id),
            )
            .where(
                or_(
                    func.lower(Opportunity.title).contains(query.lower()),
                    Opportunity.title.ilike(q_pattern),
                    Opportunity.program_name.ilike(q_pattern),
                    Opportunity.funder.ilike(q_pattern),
                )
            )
            .limit(5)
        )
        result = await db.execute(stmt)
        rows = result.fetchall()

        if not rows and institution_id:
            # Fall back to vector similarity if available
            from app.ai.client import get_embedding
            try:
                embedding = await get_embedding(query)
                emb_str = "[" + ",".join(str(x) for x in embedding) + "]"
                vec_stmt = (
                    select(Opportunity)
                    .where(Opportunity.embedding.isnot(None))
                    .order_by(Opportunity.embedding.op("<=>")((emb_str)))
                    .limit(5)
                )
                vec_result = await db.execute(vec_stmt)
                opps = vec_result.scalars().all()
                rows = [(opp, None) for opp in opps]
            except Exception:
                pass

        items = []
        for row in rows:
            if isinstance(row, tuple):
                opp, inst_opp = row[0], row[1] if len(row) > 1 else None
            else:
                opp, inst_opp = row, None

            if opp is None:
                continue

            text_body = (
                opp.ai_summary
                or inst_opp.ai_summary if inst_opp else None
                or opp.description
                or opp.parsed_text
                or ""
            )
            items.append({
                "title": opp.title,
                "funder": opp.funder or "",
                "program_name": opp.program_name or "",
                "deadline": str(opp.deadline) if opp.deadline else None,
                "award_range": _fmt_award(opp.award_min, opp.award_max, opp.currency),
                "fit_score": inst_opp.fit_score if inst_opp else opp.fit_score,
                "status": inst_opp.status if inst_opp else opp.status,
                "eligibility": (opp.eligibility_criteria or "")[:400],
                "evaluation_criteria": (opp.evaluation_criteria or "")[:400],
                "description": text_body[:1500],
                "url": opp.opportunity_url or opp.source_url or "",
                "thematic_areas": opp.thematic_areas or [],
                "word_limit": opp.word_limit,
                "page_limit": opp.page_limit,
            })

        return {"results": items, "count": len(items)}

    except Exception as exc:
        logger.warning("lookup_opportunity tool failed", error=str(exc))
        return {"results": [], "count": 0, "error": str(exc)}


def _fmt_award(min_amt: float | None, max_amt: float | None, currency: str | None) -> str:
    if not min_amt and not max_amt:
        return ""
    cur = currency or "USD"
    if min_amt and max_amt:
        return f"{cur} {min_amt:,.0f}–{max_amt:,.0f}"
    if max_amt:
        return f"up to {cur} {max_amt:,.0f}"
    return f"{cur} {min_amt:,.0f}+"


async def run_search_citations(
    query: str,
    max_results: int = 5,
) -> dict:
    """Search OpenAlex and PubMed for academic citations."""
    try:
        results = await _search_citations(query=query, max_results=max_results)
        items = [
            {
                "title": r.get("title", ""),
                "authors": r.get("authors", [])[:3],
                "year": r.get("year"),
                "doi": r.get("doi", ""),
                "url": r.get("url", ""),
                "abstract": (r.get("abstract") or "")[:300],
                "formatted_citation": r.get("formatted_citation", ""),
                "source_type": r.get("source_type", ""),
            }
            for r in (results or [])
        ]
        return {"citations": items, "count": len(items)}
    except Exception as exc:
        logger.warning("search_citations tool failed", error=str(exc))
        return {"citations": [], "count": 0, "error": str(exc)}


async def run_find_citation_for_text(
    text: str,
    max_results: int = 3,
) -> dict:
    """Extract key claims from text and find supporting citations."""
    from app.ai.client import chat_complete

    # Step 1: Extract 2-4 precise search terms from the claim text
    try:
        extraction_response = await chat_complete(
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a research librarian. Extract 2-4 precise, specific search queries "
                        "from the given text that would find supporting academic literature on PubMed "
                        "or Google Scholar. Return a JSON object with key 'queries' containing a list "
                        "of strings. Focus on technical terms, named concepts, and specific claims. "
                        "Avoid generic words."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Extract search queries for: {text[:800]}",
                },
            ],
            agent_name="call_analyzer_classifier",
            json_mode=True,
        )
        parsed = json.loads(extraction_response)
        queries = parsed.get("queries", [])[:4]
    except Exception:
        # Fallback: use first 100 chars of text as query
        queries = [re.sub(r"\s+", " ", text[:100]).strip()]

    # Step 2: Search with each query and collect unique results
    all_citations: dict[str, dict] = {}
    for q in queries:
        try:
            results = await _search_citations(query=q, max_results=3)
            for r in results or []:
                key = (r.get("doi") or r.get("title") or "")[:80].lower()
                if key and key not in all_citations:
                    all_citations[key] = {
                        "title": r.get("title", ""),
                        "authors": r.get("authors", [])[:3],
                        "year": r.get("year"),
                        "doi": r.get("doi", ""),
                        "url": r.get("url", ""),
                        "abstract": (r.get("abstract") or "")[:300],
                        "formatted_citation": r.get("formatted_citation", ""),
                        "source_type": r.get("source_type", ""),
                        "search_query": q,
                    }
        except Exception:
            continue

    top = list(all_citations.values())[:max_results]
    return {
        "citations": top,
        "count": len(top),
        "search_queries_used": queries,
        "original_text_snippet": text[:200],
    }


async def run_search_org_docs(
    query: str,
    grant_id: str | None = None,
    db: AsyncSession | None = None,
) -> dict:
    """Search workspace files and documents for relevant content."""
    from app.models.document import Document
    from app.models.workspace_file import WorkspaceFile

    results = []

    # Search Documents (have parsed_text and embeddings)
    try:
        q_pattern = f"%{query}%"
        doc_stmt = (
            select(Document)
            .where(
                Document.grant_id == grant_id,
                Document.ai_retrieval_allowed.is_(True),
                or_(
                    Document.file_name.ilike(q_pattern),
                    Document.parsed_text.ilike(q_pattern),
                ),
            )
            .limit(5)
        )
        doc_result = await db.execute(doc_stmt)
        docs = doc_result.scalars().all()
        for doc in docs:
            excerpt = _extract_excerpt(doc.parsed_text or "", query)
            results.append({
                "type": "document",
                "file_name": doc.file_name or "Untitled",
                "document_type": doc.document_type,
                "excerpt": excerpt,
                "url": doc.file_url or "",
                "uploaded_at": str(doc.uploaded_at.date()) if doc.uploaded_at else "",
            })
    except Exception as exc:
        logger.debug("Document search failed", error=str(exc))

    # Search WorkspaceFiles by name
    try:
        wf_stmt = (
            select(WorkspaceFile)
            .where(
                WorkspaceFile.grant_id == grant_id,
                WorkspaceFile.file_name.ilike(f"%{query}%"),
            )
            .limit(5)
        )
        wf_result = await db.execute(wf_stmt)
        wfs = wf_result.scalars().all()
        for wf in wfs:
            if not any(r["file_name"] == wf.file_name for r in results):
                results.append({
                    "type": "workspace_file",
                    "file_name": wf.file_name,
                    "file_category": wf.file_category,
                    "excerpt": "",
                    "url": wf.file_url or "",
                    "uploaded_at": str(wf.uploaded_at.date()) if wf.uploaded_at else "",
                })
    except Exception as exc:
        logger.debug("WorkspaceFile search failed", error=str(exc))

    return {"results": results, "count": len(results)}


def _extract_excerpt(text: str, query: str, window: int = 300) -> str:
    """Find the most relevant snippet of text near the query terms."""
    if not text:
        return ""
    lower_text = text.lower()
    lower_query = query.lower()
    words = lower_query.split()
    # Find first occurrence of any query word
    pos = -1
    for word in words:
        idx = lower_text.find(word)
        if idx >= 0:
            pos = idx
            break
    if pos < 0:
        return text[:window]
    start = max(0, pos - 80)
    end = min(len(text), pos + window)
    snippet = text[start:end].strip()
    return ("…" if start > 0 else "") + snippet + ("…" if end < len(text) else "")


# ── Central dispatch ──────────────────────────────────────────────────────────

async def execute_tool(
    name: str,
    args: dict,
    db: AsyncSession | None = None,
    grant_id: str | None = None,
    institution_id: str | None = None,
) -> Any:
    """Dispatch a tool call by name with injected context."""
    logger.info("chat_tool_execute", tool=name, args=list(args.keys()))

    if name == "search_archive":
        return await run_search_archive(
            query=args.get("query", ""),
            section_type=args.get("section_type"),
            funder=args.get("funder"),
            db=db,
            grant_id=grant_id,
        )
    if name == "lookup_opportunity":
        return await run_lookup_opportunity(
            query=args.get("query", ""),
            db=db,
            institution_id=institution_id,
        )
    if name == "search_citations":
        return await run_search_citations(
            query=args.get("query", ""),
            max_results=int(args.get("max_results", 5)),
        )
    if name == "find_citation_for_text":
        return await run_find_citation_for_text(
            text=args.get("text", ""),
            max_results=int(args.get("max_results", 3)),
        )
    if name == "search_org_docs":
        return await run_search_org_docs(
            query=args.get("query", ""),
            grant_id=grant_id,
            db=db,
        )

    return {"error": f"Unknown tool: {name}"}

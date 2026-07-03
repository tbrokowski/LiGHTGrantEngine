"""
Shared RAG tool definitions and executor factory — used by any agentic session
(drafting, per-section critique, whole-document review, the interactive chat
assistant) that needs to search the archive, the web, or academic literature
mid-conversation instead of relying on a single static pre-fetch.

Consolidates what used to be near-duplicate tool definitions in
section_drafter_agentic.py and meta_agent.py.
"""
from __future__ import annotations

from typing import Any, Callable, TYPE_CHECKING

from app.ai.rag.retriever import retrieve_content_exemplars, retrieve_from_named_archive
from app.services.web_search import search_web_multi
from app.services.citation_lookup import search_citations

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


RAG_TOOL_DEFS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "search_rag_corpus",
            "description": (
                "Search the institutional archive of prior awarded and submitted proposals "
                "for excerpts matching a concept, methodology, disease area, or geography. "
                "Use whenever you need a specific detail, number, or framing not already "
                "available — but search by the underlying CONCEPT, not by this proposal's "
                "own named platforms/tools/acronyms, which by definition can't appear in "
                "OTHER teams' past proposals."
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
            "name": "search_named_archive",
            "description": (
                "Look up a SPECIFIC prior proposal by name (e.g. \"give me the methods and "
                "protocols from CADLUS4TB relevant to this section\") and search within just "
                "that proposal's sections. Use this instead of search_rag_corpus whenever the "
                "user or context names a specific past program/grant to pull from."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "archive_name": {"type": "string", "description": "The name of the specific prior proposal/program (e.g. \"CADLUS4TB\")"},
                    "query": {"type": "string", "description": "What to look for within that proposal (e.g. \"methods and protocols\")"},
                    "section_type": {"type": "string", "description": "Optional section type filter (e.g. \"methods\")"},
                },
                "required": ["archive_name", "query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_web",
            "description": (
                "Search the web for current evidence, statistics, or citations to support a "
                "specific claim. Use when a factual claim needs backing you don't already have."
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
                "Search academic literature (PubMed, OpenAlex) for a peer-reviewed citation "
                "backing a specific scientific, clinical, or technical claim."
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
]


def build_rag_tool_executor(
    db: "AsyncSession",
    section_type: str = "other",
    funder: str = "",
    on_result: Callable[[str, dict, dict], None] | None = None,
    accessible_grant_ids: list[str] | None = None,
) -> Any:
    """Build an executor for RAG_TOOL_DEFS. `on_result(tool_name, arguments, result)` —
    if given — is called after every search (successful or not), so a caller can log the
    query/capture surfaced archive section IDs (result["results"][i]["id"]/["archive_id"])
    for later citation-linking, without this module needing to know anything about
    citations or UI event logging itself. `accessible_grant_ids` enforces the same
    per-user access control retrieve_content_exemplars already supports."""

    async def executor(tool_name: str, arguments: dict) -> dict:
        if tool_name == "search_rag_corpus":
            query = arguments.get("query", "")
            if not query:
                return {"found": False, "results": []}
            hits = await retrieve_content_exemplars(
                query=query, db=db, section_type=section_type, funder=funder, top_k=4,
                accessible_grant_ids=accessible_grant_ids,
            )
            result = {
                "found": bool(hits),
                "results": [
                    {
                        "id": r.get("id"),
                        "archive_id": r.get("archive_id"),
                        "grant_title": r.get("grant_title", ""),
                        "section_type": r.get("section_type", ""),
                        "outcome": r.get("outcome", ""),
                        "excerpt": r.get("full_text", "")[:1000],
                    }
                    for r in hits[:4]
                ],
            }
            if on_result:
                on_result(tool_name, arguments, result)
            return result

        elif tool_name == "search_named_archive":
            archive_name = arguments.get("archive_name", "")
            query = arguments.get("query", "")
            sec_type = arguments.get("section_type") or None
            if not archive_name or not query:
                return {"found": False, "results": []}
            lookup = await retrieve_from_named_archive(
                archive_name_query=archive_name,
                content_query=query,
                db=db,
                section_type=sec_type,
                top_k=5,
                accessible_grant_ids=accessible_grant_ids,
            )
            if lookup.get("error"):
                return {"found": False, "results": [], "error": lookup["error"]}
            result = {
                "found": bool(lookup.get("results")),
                "matched_archives": lookup.get("matched_archives", []),
                "results": [
                    {
                        "id": r.get("id"),
                        "archive_id": r.get("archive_id"),
                        "grant_title": r.get("grant_title", ""),
                        "section_type": r.get("section_type", ""),
                        "outcome": r.get("outcome", ""),
                        "excerpt": r.get("full_text", "")[:1200],
                    }
                    for r in lookup.get("results", [])[:5]
                ],
            }
            if on_result:
                on_result(tool_name, arguments, result)
            return result

        elif tool_name == "search_web":
            queries = arguments.get("queries", [])
            if not queries:
                return {"found": False, "results": []}
            hits = await search_web_multi(queries[:3], max_results_per_query=3)
            result = {
                "found": bool(hits),
                "results": [
                    {"title": r["title"], "url": r["url"], "content": r["content"][:600]}
                    for r in hits[:5]
                ],
            }
            if on_result:
                on_result(tool_name, arguments, result)
            return result

        elif tool_name == "search_academic":
            query = arguments.get("query", "")
            if not query:
                return {"found": False, "results": []}
            hits = await search_citations(query, max_results=5)
            result = {"found": bool(hits), "results": hits[:5]}
            if on_result:
                on_result(tool_name, arguments, result)
            return result

        return {"error": f"Unknown tool: {tool_name}"}

    return executor

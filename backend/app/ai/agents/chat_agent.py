"""
Agentic chat loop — streaming tool-calling response.

Uses client.chat.completions.create(stream=True) for broad SDK compatibility.
Accumulates tool-call argument fragments from raw chunks, then executes tools
between rounds, yielding SSE-ready dicts throughout.

SSE event types emitted:
  {"type": "tool_start",    "tool": name, "display": label}
  {"type": "tool_result",   "tool": name, "count": n}
  {"type": "content",       "content": delta_text}
  {"type": "sources",       "items": [...]}
  {"type": "context_chips", "chips": [...]}
  {"type": "done"}
  {"type": "error",         "message": str}
"""
from __future__ import annotations

import json
import structlog
from typing import Any, AsyncIterator, Callable, Awaitable

from app.ai.tools.chat_tools import tool_display_label

logger = structlog.get_logger()

MAX_TOOL_ROUNDS = 4


async def run_agent_loop(
    messages: list[dict],
    tools: list[dict],
    tool_executor: Callable[[str, dict], Awaitable[Any]],
    context_chips: list[str] | None = None,
    model: str = "gpt-4o",
    temperature: float = 0.3,
) -> AsyncIterator[dict]:
    """
    Streaming agentic loop — yields SSE-ready dicts.

    Pauses streaming when the LLM requests tool calls, executes them,
    feeds results back, then continues streaming the final response.
    Collects all tool results to emit a 'sources' event at the end.
    """
    from app.ai.client import _get_client

    client = _get_client()
    round_messages = list(messages)
    all_sources: list[dict] = []

    try:
        for _round in range(MAX_TOOL_ROUNDS):
            # Accumulator: index -> {id, name, arguments_str}
            tc_accum: dict[int, dict] = {}

            stream = await client.chat.completions.create(
                model=model,
                messages=round_messages,
                tools=tools if tools else None,
                tool_choice="auto" if tools else None,
                temperature=temperature,
                max_tokens=4096,
                stream=True,
            )

            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta

                # ── Text token ────────────────────────────────────────────────
                if delta.content:
                    yield {"type": "content", "content": delta.content}

                # ── Tool-call fragment ────────────────────────────────────────
                if delta.tool_calls:
                    for tc_delta in delta.tool_calls:
                        idx = tc_delta.index
                        if idx not in tc_accum:
                            tc_accum[idx] = {"id": "", "name": "", "arguments": ""}
                        if tc_delta.id:
                            tc_accum[idx]["id"] = tc_delta.id
                        if tc_delta.function:
                            if tc_delta.function.name:
                                tc_accum[idx]["name"] += tc_delta.function.name
                            if tc_delta.function.arguments:
                                tc_accum[idx]["arguments"] += tc_delta.function.arguments

            # ── No tool calls → pure text response, done ──────────────────────
            if not tc_accum:
                break

            # ── Execute each tool call ────────────────────────────────────────
            tool_calls_this_round: dict[int, dict] = {}
            for idx, tc in tc_accum.items():
                tc_name = tc["name"]
                try:
                    tc_args = json.loads(tc["arguments"] or "{}")
                except json.JSONDecodeError:
                    tc_args = {}
                tc_id = tc["id"]

                display = tool_display_label(tc_name, tc_args)
                yield {"type": "tool_start", "tool": tc_name, "display": display}

                try:
                    result = await tool_executor(tc_name, tc_args)
                except Exception as exc:
                    result = {"error": str(exc)}
                    logger.warning("tool_executor error", tool=tc_name, error=str(exc))

                count = _extract_count(tc_name, result)
                yield {"type": "tool_result", "tool": tc_name, "count": count}

                tool_calls_this_round[idx] = {
                    "id": tc_id,
                    "name": tc_name,
                    "arguments": tc_args,
                    "result": result,
                }
                _accumulate_sources(tc_name, result, all_sources)

            # ── Feed tool results back for the next round ─────────────────────
            round_messages.append(_make_assistant_tool_call_message(tool_calls_this_round))
            for tc in tool_calls_this_round.values():
                round_messages.append(_make_tool_result_message(tc["id"], tc["result"]))

        # ── Final events ──────────────────────────────────────────────────────
        if all_sources:
            yield {"type": "sources", "items": all_sources}
        if context_chips:
            yield {"type": "context_chips", "chips": context_chips}
        yield {"type": "done"}

    except Exception as exc:
        logger.exception("run_agent_loop error", error=str(exc))
        yield {"type": "error", "message": str(exc)[:500]}
        yield {"type": "done"}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _extract_count(tool_name: str, result: Any) -> int:
    if not isinstance(result, dict):
        return 0
    if tool_name in ("search_archive", "search_org_docs"):
        return result.get("count", len(result.get("results", [])))
    if tool_name == "lookup_opportunity":
        return result.get("count", len(result.get("results", [])))
    if tool_name in ("search_citations", "find_citation_for_text"):
        return result.get("count", len(result.get("citations", [])))
    return 0


def _accumulate_sources(tool_name: str, result: Any, sources: list[dict]) -> None:
    if not isinstance(result, dict):
        return

    if tool_name == "lookup_opportunity":
        for item in result.get("results", []):
            sources.append({
                "type": "opportunity",
                "title": item.get("title", ""),
                "snippet": item.get("description", "")[:200],
                "url": item.get("url", ""),
                "meta": (
                    f"{item.get('funder', '')} · "
                    f"Deadline: {item.get('deadline') or 'TBD'} · "
                    f"Fit: {round((item.get('fit_score') or 0) * 100)}%"
                ).strip(" ·"),
            })
    elif tool_name == "search_archive":
        for item in result.get("results", []):
            sources.append({
                "type": "archive",
                "title": f"{item.get('grant_title', 'Archive')} — {item.get('section_type', '')}",
                "snippet": item.get("excerpt", "")[:200],
                "url": "",
                "meta": (
                    f"{item.get('funder', '')} · "
                    f"Outcome: {item.get('outcome', 'unknown')}"
                ).strip(" ·"),
            })
    elif tool_name in ("search_citations", "find_citation_for_text"):
        for item in result.get("citations", []):
            sources.append({
                "type": "citation",
                "title": item.get("title", ""),
                "snippet": item.get("abstract", "")[:200],
                "url": item.get("url", "") or (f"https://doi.org/{item['doi']}" if item.get("doi") else ""),
                "meta": (
                    f"{', '.join(item.get('authors', [])[:2]) or 'Unknown'} "
                    f"({item.get('year') or 'n.d.'}) · "
                    f"{item.get('source_type', 'Literature')}"
                ).strip(),
                "formatted_citation": item.get("formatted_citation", ""),
            })
    elif tool_name == "search_org_docs":
        for item in result.get("results", []):
            sources.append({
                "type": "document",
                "title": item.get("file_name", "Document"),
                "snippet": item.get("excerpt", "")[:200],
                "url": item.get("url", ""),
                "meta": item.get("uploaded_at", ""),
            })


def _make_assistant_tool_call_message(tool_calls: dict[int, dict]) -> dict:
    return {
        "role": "assistant",
        "content": None,
        "tool_calls": [
            {
                "id": tc["id"],
                "type": "function",
                "function": {
                    "name": tc["name"],
                    "arguments": json.dumps(tc["arguments"]),
                },
            }
            for tc in sorted(tool_calls.values(), key=lambda x: x["id"])
        ],
    }


def _make_tool_result_message(tool_call_id: str, result: Any) -> dict:
    content = json.dumps(result)
    if len(content) > 8000:
        content = content[:8000] + "…"
    return {"role": "tool", "tool_call_id": tool_call_id, "content": content}

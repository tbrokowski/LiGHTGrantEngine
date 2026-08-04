"""Multi-provider LLM dispatch — OpenAI, Anthropic (Claude), Google (Gemini).

`app/ai/client.py` resolves (provider, model) per agent and delegates the actual
API call here. Providers are selected by an explicit `provider` in a config
agent_override, else inferred from the model id (`claude-*` → anthropic,
`gemini-*` → google, else openai).

Per-request API keys: the grant-writing worker calls `set_request_context(...)`
with the running user's saved keys before a run; if the user supplied a key for
the resolved provider we use it, otherwise the system key from config.

Anthropic/Google SDKs are imported lazily so this module compiles without them
installed; add `anthropic` and `google-genai` to requirements for those paths.
"""
from __future__ import annotations

import contextvars
import json as _json
from typing import Any, Optional

import structlog

logger = structlog.get_logger()

# ── provider inference + pricing ──────────────────────────────────────────────
# cents per token (prompt, completion). Approximate public list prices.
_MODEL_RATES: dict[str, dict[str, float]] = {
    # OpenAI
    "gpt-4o-mini": {"prompt": 0.000015, "completion": 0.00006},
    "gpt-4o": {"prompt": 0.00025, "completion": 0.001},
    "gpt-4.1": {"prompt": 0.0002, "completion": 0.0008},
    "gpt-4.1-mini": {"prompt": 0.00004, "completion": 0.00016},
    "gpt-5": {"prompt": 0.000125, "completion": 0.001},
    "o3": {"prompt": 0.0002, "completion": 0.0008},
    # Anthropic
    "claude-opus-4": {"prompt": 0.0015, "completion": 0.0075},
    "claude-sonnet-4": {"prompt": 0.0003, "completion": 0.0015},
    "claude-3-5-sonnet": {"prompt": 0.0003, "completion": 0.0015},
    "claude-3-5-haiku": {"prompt": 0.00008, "completion": 0.0004},
    # Google
    "gemini-2.5-pro": {"prompt": 0.000125, "completion": 0.001},
    "gemini-2.5-flash": {"prompt": 0.00003, "completion": 0.00025},
    "gemini-1.5-pro": {"prompt": 0.000125, "completion": 0.0005},
    "default": {"prompt": 0.000015, "completion": 0.00006},
}


def infer_provider(model: str) -> str:
    m = (model or "").lower()
    if m.startswith("claude"):
        return "anthropic"
    if m.startswith("gemini"):
        return "google"
    return "openai"


def estimate_cost_cents(model: str, prompt_tokens: int, completion_tokens: int) -> int:
    key = model
    if key not in _MODEL_RATES:
        # prefix match (e.g. "claude-opus-4-20250101" → "claude-opus-4")
        key = next((k for k in _MODEL_RATES if model and model.startswith(k)), "default")
    rates = _MODEL_RATES[key]
    total = prompt_tokens * rates["prompt"] + completion_tokens * rates["completion"]
    return max(0, round(total))


# ── per-request context (user id + the user's saved provider keys) ────────────
_ctx_user_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("llm_user_id", default=None)
_ctx_user_keys: contextvars.ContextVar[dict] = contextvars.ContextVar("llm_user_keys", default={})
_ctx_grant_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("llm_grant_id", default=None)


def set_request_context(user_id: Optional[str], keys: Optional[dict] = None, grant_id: Optional[str] = None) -> None:
    _ctx_user_id.set(user_id)
    _ctx_user_keys.set(keys or {})
    _ctx_grant_id.set(grant_id)


def current_user_id() -> Optional[str]:
    return _ctx_user_id.get()


def current_grant_id() -> Optional[str]:
    return _ctx_grant_id.get()


# ── per-request usage buffer (flushed to the LLMUsage ledger by the worker) ────
_ctx_usage: contextvars.ContextVar[Optional[list]] = contextvars.ContextVar("llm_usage", default=None)


def reset_usage() -> None:
    """Install a fresh shared buffer. Child asyncio tasks inherit the same list
    object, so appends from parallel writers all land here."""
    _ctx_usage.set([])


def record_usage(entry: dict) -> None:
    buf = _ctx_usage.get()
    if buf is None:
        buf = []
        _ctx_usage.set(buf)
    buf.append(entry)


def get_usage() -> list:
    return list(_ctx_usage.get() or [])


def _resolve_api_key(provider: str, system_keys: dict) -> Optional[str]:
    """Prefer the running user's key for this provider, else the system key."""
    user_keys = _ctx_user_keys.get() or {}
    return user_keys.get(provider) or system_keys.get(provider)


# ── message mapping ───────────────────────────────────────────────────────────
def _split_system(messages: list[dict]) -> tuple[str, list[dict]]:
    """Anthropic/Gemini take the system prompt separately from the turn list."""
    system_parts = [m["content"] for m in messages if m.get("role") == "system" and m.get("content")]
    turns = [m for m in messages if m.get("role") != "system"]
    return ("\n\n".join(system_parts), turns)


# ── non-tool completion, per provider ─────────────────────────────────────────
async def complete(
    provider: str,
    model: str,
    messages: list[dict],
    temperature: float,
    max_tokens: int,
    top_p: float,
    system_keys: dict,
    json_mode: bool = False,
    reasoning_effort: Optional[str] = None,
    timeout: int = 180,
) -> tuple[str, int, int]:
    """Return (content, prompt_tokens, completion_tokens) for any provider."""
    api_key = _resolve_api_key(provider, system_keys)

    if provider == "anthropic":
        from anthropic import AsyncAnthropic
        system, turns = _split_system(messages)
        kwargs: dict[str, Any] = {
            "model": model, "max_tokens": max_tokens, "temperature": temperature,
            "messages": [{"role": ("assistant" if t["role"] == "assistant" else "user"),
                          "content": t.get("content") or ""} for t in turns],
        }
        if system:
            kwargs["system"] = system
        if reasoning_effort:
            budget = {"low": 4000, "medium": 8000, "high": 16000}.get(reasoning_effort, 8000)
            kwargs["thinking"] = {"type": "enabled", "budget_tokens": budget}
            kwargs["temperature"] = 1  # thinking requires temperature unset/1
        async with AsyncAnthropic(api_key=api_key, timeout=timeout) as client:
            resp = await client.messages.create(**kwargs)
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
        return text, resp.usage.input_tokens, resp.usage.output_tokens

    if provider == "google":
        from google import genai
        from google.genai import types as gtypes
        system, turns = _split_system(messages)
        contents = [{"role": ("model" if t["role"] == "assistant" else "user"),
                     "parts": [{"text": t.get("content") or ""}]} for t in turns]
        cfg: dict[str, Any] = {"temperature": temperature, "max_output_tokens": max_tokens, "top_p": top_p}
        if system:
            cfg["system_instruction"] = system
        if json_mode:
            cfg["response_mime_type"] = "application/json"
        client = genai.Client(api_key=api_key)
        resp = await client.aio.models.generate_content(
            model=model, contents=contents, config=gtypes.GenerateContentConfig(**cfg),
        )
        text = resp.text or ""
        um = getattr(resp, "usage_metadata", None)
        return text, (getattr(um, "prompt_token_count", 0) or 0), (getattr(um, "candidates_token_count", 0) or 0)

    # OpenAI (default)
    from openai import AsyncOpenAI
    kwargs = {"model": model, "messages": messages, "temperature": temperature,
              "max_tokens": max_tokens, "top_p": top_p}
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    if reasoning_effort:
        kwargs["reasoning_effort"] = reasoning_effort
    async with AsyncOpenAI(api_key=api_key, timeout=timeout) as client:
        resp = await client.chat.completions.create(**kwargs)
    content = resp.choices[0].message.content or ""
    u = resp.usage
    return content, (u.prompt_tokens if u else 0), (u.completion_tokens if u else 0)


# ── tool-calling loop, per provider (OpenAI + Anthropic) ──────────────────────
async def complete_with_tools(
    provider: str,
    model: str,
    messages: list[dict],
    tools: list[dict],
    tool_executor: Any,
    temperature: float,
    max_tokens: int,
    top_p: float,
    system_keys: dict,
    max_rounds: int,
    reasoning_effort: Optional[str] = None,
    timeout: int = 180,
) -> tuple[Optional[str], list[dict]]:
    api_key = _resolve_api_key(provider, system_keys)
    tool_log: list[dict] = []

    if provider == "anthropic":
        from anthropic import AsyncAnthropic
        system, turns = _split_system(messages)
        # Map OpenAI tool schema → Anthropic tool schema.
        a_tools = [{
            "name": t["function"]["name"],
            "description": t["function"].get("description", ""),
            "input_schema": t["function"].get("parameters", {"type": "object", "properties": {}}),
        } for t in tools if t.get("function")]
        msgs = [{"role": ("assistant" if t["role"] == "assistant" else "user"),
                 "content": t.get("content") or ""} for t in turns]
        final_text: Optional[str] = None
        async with AsyncAnthropic(api_key=api_key, timeout=timeout) as client:
            for _ in range(max_rounds):
                resp = await client.messages.create(
                    model=model, max_tokens=max_tokens, temperature=temperature,
                    system=system or None, messages=msgs, tools=a_tools,
                )
                tool_uses = [b for b in resp.content if getattr(b, "type", "") == "tool_use"]
                text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
                if not tool_uses:
                    final_text = text
                    break
                msgs.append({"role": "assistant", "content": [b.model_dump() for b in resp.content]})
                results_content = []
                for tu in tool_uses:
                    try:
                        result = await tool_executor(tu.name, tu.input or {})
                    except Exception as exc:
                        result = {"error": str(exc)}
                    tool_log.append({"tool": tu.name, "arguments": tu.input, "result": result})
                    results_content.append({
                        "type": "tool_result", "tool_use_id": tu.id,
                        "content": _json.dumps(result) if not isinstance(result, str) else result,
                    })
                msgs.append({"role": "user", "content": results_content})
        return final_text, tool_log

    # OpenAI tool loop (also used as the fallback for google, which we don't yet
    # map for tools — the client logs a warning and routes tool agents to OpenAI).
    from openai import AsyncOpenAI
    current = list(messages)
    final_text = None
    extra = {"reasoning_effort": reasoning_effort} if reasoning_effort else {}
    async with AsyncOpenAI(api_key=api_key, timeout=timeout) as client:
        for _ in range(max_rounds):
            resp = await client.chat.completions.create(
                model=model, messages=current, tools=tools, tool_choice="auto",
                temperature=temperature, max_tokens=max_tokens, top_p=top_p, **extra,
            )
            msg = resp.choices[0].message
            if not msg.tool_calls:
                final_text = msg.content or ""
                break
            current.append({
                "role": "assistant", "content": msg.content,
                "tool_calls": [{"id": tc.id, "type": "function",
                                "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                               for tc in msg.tool_calls],
            })
            for tc in msg.tool_calls:
                try:
                    args = _json.loads(tc.function.arguments)
                except (_json.JSONDecodeError, TypeError):
                    args = {}
                try:
                    result = await tool_executor(tc.function.name, args)
                except Exception as exc:
                    result = {"error": str(exc)}
                tool_log.append({"tool": tc.function.name, "arguments": args, "result": result})
                current.append({"role": "tool", "tool_call_id": tc.id,
                                "content": _json.dumps(result) if not isinstance(result, str) else result})
    return final_text, tool_log

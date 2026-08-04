"""
OpenAI API client — wraps the OpenAI chat completions and embeddings endpoints.
All AI calls in LiGHT go through this module.

The base_url, model, and generation settings are read from config.yaml.
To switch models or providers, update config.yaml:ai.
"""
from typing import Any, AsyncIterator, Optional
import structlog
from openai import AsyncOpenAI, RateLimitError
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_random_exponential,
)

from app.config import get_settings
from app.ai import providers as _providers

logger = structlog.get_logger()
settings = get_settings()


def _system_keys() -> dict:
    """System (config/env) API keys per provider."""
    import os
    ai = settings.ai
    keys: dict = {"openai": ai.api_key}
    providers_cfg = getattr(ai, "providers", None) or {}
    if isinstance(providers_cfg, dict):
        for name, cfg in providers_cfg.items():
            k = cfg.get("api_key") if isinstance(cfg, dict) else None
            if k and k != "EMPTY":
                keys[name] = k
    keys.setdefault("anthropic", os.environ.get("ANTHROPIC_API_KEY"))
    keys.setdefault("google", os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY"))
    return keys


def _resolve_model_provider(agent_name: Optional[str]) -> tuple[str, str, dict]:
    """Return (provider, model, agent_overrides) for an agent."""
    ai_cfg = settings.ai
    ov = ai_cfg.agent_overrides.get(agent_name or "", {})
    model = ov.get("model", ai_cfg.model)
    provider = ov.get("provider") or _providers.infer_provider(model)
    return provider, model, ov

# Lightweight per-process LLM call counter, tagged by agent_name — used to verify
# the draft pipeline's call count during/after a run. Safe under the Celery
# --pool=solo model (one task at a time per worker process): reset at the start
# of a run and read at the end within the same synchronous task execution.
_call_counts: dict[str, int] = {}


def reset_call_counts() -> None:
    _call_counts.clear()


def get_call_counts() -> dict[str, int]:
    return dict(_call_counts)


def _record_call(agent_name: Optional[str]) -> None:
    key = agent_name or "unknown"
    _call_counts[key] = _call_counts.get(key, 0) + 1


def _record_usage(agent_name: Optional[str], provider: str, model: str, pt: int, ct: int) -> None:
    """Buffer token usage for this request; the worker flushes it to LLMUsage."""
    try:
        _providers.record_usage({
            "agent": agent_name or "unknown", "provider": provider, "model": model,
            "prompt_tokens": pt, "completion_tokens": ct,
            "cost_cents": _providers.estimate_cost_cents(model, pt, ct),
        })
    except Exception:
        pass


def _get_client() -> AsyncOpenAI:
    ai_cfg = settings.ai
    return AsyncOpenAI(
        base_url=ai_cfg.base_url,
        api_key=ai_cfg.api_key,
        timeout=ai_cfg.generation.timeout_seconds,
    )


@retry(
    retry=retry_if_exception_type(RateLimitError),
    stop=stop_after_attempt(5),
    # Random jitter prevents all concurrent callers from retrying in sync,
    # which would recreate the same 429 storm. 60s ceiling gives the API
    # time to refill its token bucket between attempts.
    wait=wait_random_exponential(min=5, max=60),
    reraise=True,
)
async def chat_complete(
    messages: list[dict],
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
    agent_name: Optional[str] = None,
    json_mode: bool = False,
    reasoning_effort: Optional[str] = None,
) -> str:
    """
    Call the chat completions endpoint.

    Args:
        messages: List of {"role": "system"|"user"|"assistant", "content": "..."}
        temperature: Override config default
        max_tokens: Override config default
        agent_name: Used to apply per-agent config overrides from config.yaml
        json_mode: If True, request JSON output format
        reasoning_effort: Extended-thinking effort ("low"|"medium"|"high") for
            reasoning-capable models. Opt-in per call or via agent_overrides;
            only sent when set, so it's a no-op for providers that don't support it.

    Returns:
        The assistant message content as a string.
    """
    gen = settings.ai.generation
    provider, model, ov = _resolve_model_provider(agent_name)
    temp = temperature if temperature is not None else ov.get("temperature", gen.temperature)
    tokens = max_tokens if max_tokens is not None else ov.get("max_tokens", gen.max_tokens)
    effort = reasoning_effort or ov.get("reasoning_effort")

    logger.debug("AI chat call", agent=agent_name, provider=provider, model=model, messages=len(messages))
    content, pt, ct = await _providers.complete(
        provider=provider, model=model, messages=messages,
        temperature=temp, max_tokens=tokens, top_p=gen.top_p,
        system_keys=_system_keys(), json_mode=json_mode, reasoning_effort=effort,
        timeout=gen.timeout_seconds,
    )
    _record_call(agent_name)
    _record_usage(agent_name, provider, model, pt, ct)
    return content


async def chat_complete_stream(
    messages: list[dict],
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
    agent_name: Optional[str] = None,
) -> AsyncIterator[str]:
    """
    Call the chat completions endpoint with streaming. Yields text chunks as they arrive.

    Usage:
        async for chunk in chat_complete_stream(messages):
            yield chunk
    """
    gen = settings.ai.generation
    provider, model, ov = _resolve_model_provider(agent_name)
    temp = temperature if temperature is not None else ov.get("temperature", gen.temperature)
    tokens = max_tokens if max_tokens is not None else ov.get("max_tokens", gen.max_tokens)

    logger.debug("AI stream call", agent=agent_name, provider=provider, model=model)

    if provider != "openai":
        # Non-OpenAI providers: no token streaming here — emit the full text once.
        content, pt, ct = await _providers.complete(
            provider=provider, model=model, messages=messages,
            temperature=temp, max_tokens=tokens, top_p=gen.top_p,
            system_keys=_system_keys(), timeout=gen.timeout_seconds,
        )
        _record_call(agent_name)
        _record_usage(agent_name, provider, model, pt, ct)
        if content:
            yield content
        return

    from openai import AsyncOpenAI
    async with AsyncOpenAI(api_key=_system_keys().get("openai"), timeout=gen.timeout_seconds) as client:
        stream = await client.chat.completions.create(
            model=model, messages=messages, temperature=temp,
            max_tokens=tokens, top_p=gen.top_p, stream=True,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta
            if delta and delta.content:
                yield delta.content
    _record_call(agent_name)


def estimate_cost_cents(model: str, prompt_tokens: int, completion_tokens: int) -> int:
    """Estimate cost in cents — delegates to the multi-provider pricing registry."""
    return _providers.estimate_cost_cents(model, prompt_tokens, completion_tokens)


@retry(
    retry=retry_if_exception_type(RateLimitError),
    stop=stop_after_attempt(5),
    wait=wait_random_exponential(min=5, max=60),
    reraise=True,
)
async def chat_complete_tracked(
    messages: list[dict],
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
    agent_name: Optional[str] = None,
    json_mode: bool = False,
) -> tuple[str, int, int, int]:
    """
    Like chat_complete but also returns (content, prompt_tokens, completion_tokens, cost_cents).
    Use this for AI calls that need billing tracking.
    """
    gen = settings.ai.generation
    provider, model, ov = _resolve_model_provider(agent_name)
    temp = temperature if temperature is not None else ov.get("temperature", gen.temperature)
    tokens = max_tokens if max_tokens is not None else ov.get("max_tokens", gen.max_tokens)

    content, pt, ct = await _providers.complete(
        provider=provider, model=model, messages=messages,
        temperature=temp, max_tokens=tokens, top_p=gen.top_p,
        system_keys=_system_keys(), json_mode=json_mode,
        reasoning_effort=ov.get("reasoning_effort"), timeout=gen.timeout_seconds,
    )
    _record_call(agent_name)
    _record_usage(agent_name, provider, model, pt, ct)
    return content, pt, ct, estimate_cost_cents(model, pt, ct)


async def chat_complete_with_tools(
    messages: list[dict],
    tools: list[dict],
    tool_executor: Any,
    agent_name: Optional[str] = None,
    max_rounds: int = 6,
) -> tuple[Optional[str], list[dict]]:
    """
    Run an OpenAI function-calling loop until the model stops calling tools
    or `max_rounds` is exhausted.

    Args:
        messages:       Initial message list (modified in place with assistant/tool turns).
        tools:          OpenAI tool definitions (list of {"type": "function", "function": {...}}).
        tool_executor:  Async callable(tool_name: str, arguments: dict) -> dict.
                        Called for every tool invocation the model makes.
        agent_name:     Config-override key (same as chat_complete).
        max_rounds:     Hard cap on tool-call iterations to prevent infinite loops.

    Returns:
        (final_text, tool_call_log)
        final_text is the last assistant text message (may be None if the model
        ends on a tool call without a follow-up text response).
        tool_call_log is a list of {"tool": name, "arguments": dict, "result": dict} records.
    """
    gen = settings.ai.generation
    provider, model, ov = _resolve_model_provider(agent_name)
    temp = ov.get("temperature", gen.temperature)
    tokens = ov.get("max_tokens", gen.max_tokens)
    effort = ov.get("reasoning_effort")

    # Gemini tool-calling isn't mapped yet — route tool-using agents to the system
    # OpenAI model so the agentic drafter always has working tools.
    if provider == "google":
        provider, model = "openai", settings.ai.model

    final_text, tool_call_log = await _providers.complete_with_tools(
        provider=provider, model=model, messages=list(messages),
        tools=tools, tool_executor=tool_executor,
        temperature=temp, max_tokens=tokens, top_p=gen.top_p,
        system_keys=_system_keys(), max_rounds=max_rounds,
        reasoning_effort=effort, timeout=gen.timeout_seconds,
    )
    _record_call(agent_name)
    return final_text, tool_call_log


async def get_embedding(text: str) -> list[float]:
    """
    Get a text embedding from the configured embeddings endpoint.
    Falls back to a zero vector if the endpoint fails.
    """
    embed_cfg = settings.ai.embeddings
    try:
        async with AsyncOpenAI(
            base_url=embed_cfg.base_url,
            api_key=settings.ai.api_key,
            timeout=30,
        ) as client:
            response = await client.embeddings.create(
                model=embed_cfg.model,
                input=text[:8000],
            )
        return response.data[0].embedding
    except Exception as e:
        logger.warning("Embedding call failed, returning zeros", error=str(e))
        return [0.0] * embed_cfg.dimension

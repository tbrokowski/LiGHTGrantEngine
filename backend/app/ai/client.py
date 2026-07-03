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

logger = structlog.get_logger()
settings = get_settings()

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
) -> str:
    """
    Call the chat completions endpoint.

    Args:
        messages: List of {"role": "system"|"user"|"assistant", "content": "..."}
        temperature: Override config default
        max_tokens: Override config default
        agent_name: Used to apply per-agent config overrides from config.yaml
        json_mode: If True, request JSON output format

    Returns:
        The assistant message content as a string.
    """
    ai_cfg = settings.ai
    gen = ai_cfg.generation

    agent_overrides = ai_cfg.agent_overrides.get(agent_name or "", {})
    temp = temperature if temperature is not None else agent_overrides.get("temperature", gen.temperature)
    tokens = max_tokens if max_tokens is not None else agent_overrides.get("max_tokens", gen.max_tokens)
    model = agent_overrides.get("model", ai_cfg.model)

    kwargs: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temp,
        "max_tokens": tokens,
        "top_p": gen.top_p,
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}

    logger.debug("AI chat call", agent=agent_name, model=model, messages=len(messages))

    async with _get_client() as client:
        response = await client.chat.completions.create(**kwargs)
    _record_call(agent_name)

    content = response.choices[0].message.content or ""
    logger.debug("AI chat response", agent=agent_name, tokens=response.usage.total_tokens if response.usage else None)
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
    ai_cfg = settings.ai
    gen = ai_cfg.generation

    agent_overrides = ai_cfg.agent_overrides.get(agent_name or "", {})
    temp = temperature if temperature is not None else agent_overrides.get("temperature", gen.temperature)
    tokens = max_tokens if max_tokens is not None else agent_overrides.get("max_tokens", gen.max_tokens)

    model = agent_overrides.get("model", ai_cfg.model)
    client = _get_client()

    logger.debug("AI stream call", agent=agent_name, model=model, messages=len(messages))

    stream = await client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=temp,
        max_tokens=tokens,
        top_p=gen.top_p,
        stream=True,
    )

    async for chunk in stream:
        delta = chunk.choices[0].delta
        if delta and delta.content:
            yield delta.content


# Cost rates in micro-dollars per token (multiply by 0.0001 to get cents)
# gpt-4o-mini: $0.15/1M prompt, $0.60/1M completion → 0.015 and 0.06 cents per 1K tokens
_MODEL_RATES: dict[str, dict[str, float]] = {
    "gpt-4o-mini": {"prompt": 0.000015, "completion": 0.00006},   # cents per token
    "gpt-4o": {"prompt": 0.0005, "completion": 0.0015},
    "gpt-4": {"prompt": 0.003, "completion": 0.006},
    "default": {"prompt": 0.000015, "completion": 0.00006},
}


def estimate_cost_cents(model: str, prompt_tokens: int, completion_tokens: int) -> int:
    """Estimate cost in cents (integer) for a completion call."""
    rates = _MODEL_RATES.get(model, _MODEL_RATES["default"])
    total_cents = (prompt_tokens * rates["prompt"]) + (completion_tokens * rates["completion"])
    return max(0, round(total_cents))


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
    ai_cfg = settings.ai
    gen = ai_cfg.generation
    agent_overrides = ai_cfg.agent_overrides.get(agent_name or "", {})
    temp = temperature if temperature is not None else agent_overrides.get("temperature", gen.temperature)
    tokens = max_tokens if max_tokens is not None else agent_overrides.get("max_tokens", gen.max_tokens)
    model = agent_overrides.get("model", ai_cfg.model)

    kwargs: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temp,
        "max_tokens": tokens,
        "top_p": gen.top_p,
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}

    async with _get_client() as client:
        response = await client.chat.completions.create(**kwargs)
    _record_call(agent_name)

    content = response.choices[0].message.content or ""
    usage = response.usage
    pt = usage.prompt_tokens if usage else 0
    ct = usage.completion_tokens if usage else 0
    cost = estimate_cost_cents(model, pt, ct)
    return content, pt, ct, cost


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
    ai_cfg = settings.ai
    gen = ai_cfg.generation
    agent_overrides = ai_cfg.agent_overrides.get(agent_name or "", {})
    temp = agent_overrides.get("temperature", gen.temperature)
    tokens = agent_overrides.get("max_tokens", gen.max_tokens)
    model = agent_overrides.get("model", ai_cfg.model)

    tool_call_log: list[dict] = []
    current_messages = list(messages)
    final_text: Optional[str] = None

    for _ in range(max_rounds):
        async with _get_client() as client:
            response = await client.chat.completions.create(
                model=model,
                messages=current_messages,
                tools=tools,
                tool_choice="auto",
                temperature=temp,
                max_tokens=tokens,
                top_p=gen.top_p,
            )
        _record_call(agent_name)

        choice = response.choices[0]
        message = choice.message

        # If no tool calls, the model is done
        if not message.tool_calls:
            final_text = message.content or ""
            break

        # Append the assistant's tool-call message to history
        current_messages.append({
            "role": "assistant",
            "content": message.content,
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                }
                for tc in message.tool_calls
            ],
        })

        # Dispatch each tool call and append results
        import json as _json
        for tc in message.tool_calls:
            tool_name = tc.function.name
            try:
                arguments = _json.loads(tc.function.arguments)
            except (_json.JSONDecodeError, TypeError):
                arguments = {}

            try:
                result = await tool_executor(tool_name, arguments)
            except Exception as exc:
                result = {"error": str(exc)}

            tool_call_log.append({"tool": tool_name, "arguments": arguments, "result": result})

            current_messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": _json.dumps(result) if not isinstance(result, str) else result,
            })

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

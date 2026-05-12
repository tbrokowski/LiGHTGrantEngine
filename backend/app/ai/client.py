"""
Qwen API client — wraps the OpenAI-compatible endpoint.
All AI calls in LiGHT go through this module.

The base_url, model, and generation settings are read from config.yaml.
To point at a different Qwen deployment, change config.yaml:ai.base_url.
"""
from typing import Any, Optional
import structlog
from openai import AsyncOpenAI
from tenacity import retry, stop_after_attempt, wait_exponential

from app.config import get_settings

logger = structlog.get_logger()
settings = get_settings()


def _get_client() -> AsyncOpenAI:
    """Return an OpenAI-compatible client pointed at the Qwen endpoint."""
    ai_cfg = settings.ai
    return AsyncOpenAI(
        base_url=ai_cfg.base_url,
        api_key=ai_cfg.api_key,
        timeout=ai_cfg.generation.timeout_seconds,
    )


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
async def chat_complete(
    messages: list[dict],
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
    agent_name: Optional[str] = None,
    json_mode: bool = False,
) -> str:
    """
    Call Qwen via the OpenAI-compatible chat completions endpoint.

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

    # Apply per-agent overrides
    agent_overrides = ai_cfg.agent_overrides.get(agent_name or "", {})
    temp = temperature if temperature is not None else agent_overrides.get("temperature", gen.temperature)
    tokens = max_tokens if max_tokens is not None else agent_overrides.get("max_tokens", gen.max_tokens)

    client = _get_client()

    kwargs: dict[str, Any] = {
        "model": ai_cfg.model,
        "messages": messages,
        "temperature": temp,
        "max_tokens": tokens,
        "top_p": gen.top_p,
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}

    logger.debug("Qwen call", agent=agent_name, model=ai_cfg.model, messages=len(messages))

    response = await client.chat.completions.create(**kwargs)
    content = response.choices[0].message.content or ""

    logger.debug("Qwen response", agent=agent_name, tokens=response.usage.total_tokens if response.usage else None)
    return content


async def get_embedding(text: str) -> list[float]:
    """
    Get a text embedding from the Qwen embeddings endpoint.
    Falls back to a zero vector if the endpoint doesn't support embeddings.
    """
    embed_cfg = settings.ai.embeddings
    client = AsyncOpenAI(
        base_url=embed_cfg.base_url,
        api_key=settings.ai.api_key,
        timeout=30,
    )
    try:
        response = await client.embeddings.create(
            model=embed_cfg.model,
            input=text[:8000],  # Truncate to avoid token limits
        )
        return response.data[0].embedding
    except Exception as e:
        logger.warning("Embedding call failed, returning zeros", error=str(e))
        return [0.0] * embed_cfg.dimension

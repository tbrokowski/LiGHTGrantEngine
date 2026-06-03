"""
Exa.ai neural web search wrapper.

Mirrors the interface of web_search.py: returns a list of result dicts with
{title, url, content, score}. Adds find_similar() for peer-portal discovery.

Falls back gracefully when EXA_API_KEY is not set or exa-py is not installed.
Uses a simple 24hr in-process cache (keyed on query + num_results).

API reference: https://docs.exa.ai/reference/search-api-guide-for-coding-agents
"""
from __future__ import annotations

import hashlib
import time
from typing import Any

from app.config import get_settings

_cache: dict[str, tuple[float, list[dict]]] = {}
_CACHE_TTL = 24 * 3600


def _key(*parts: str) -> str:
    return hashlib.sha256(":".join(parts).encode()).hexdigest()


def _cache_get(key: str) -> list[dict] | None:
    entry = _cache.get(key)
    if not entry:
        return None
    ts, data = entry
    if time.time() - ts > _CACHE_TTL:
        del _cache[key]
        return None
    return data


def _cache_set(key: str, data: list[dict]) -> None:
    _cache[key] = (time.time(), data)


def _normalise(results: list[Any]) -> list[dict]:
    """Convert exa-py result objects to plain dicts.

    With contents={"highlights": True}, each result has:
      r.highlights  → list[str] of query-relevant excerpts  (may be None)
      r.text        → full page text  (None unless explicitly requested)
    We join the first two highlights as the content snippet.
    """
    out = []
    for r in results:
        highlights = getattr(r, "highlights", None) or []
        if isinstance(highlights, list):
            content = " … ".join(h for h in highlights[:2] if h)
        else:
            content = getattr(r, "text", None) or ""
        out.append({
            "title": getattr(r, "title", "") or "",
            "url": getattr(r, "url", "") or "",
            "content": content,
            "score": getattr(r, "score", 0.0) or 0.0,
        })
    return out


async def exa_search(
    query: str,
    num_results: int = 10,
    search_type: str = "auto",
    include_domains: list[str] | None = None,
    exclude_domains: list[str] | None = None,
    start_published_date: str | None = None,
) -> list[dict[str, Any]]:
    """Neural search via Exa.ai.

    Uses type="auto" (balanced relevance/speed) and highlights content mode
    (token-efficient excerpts, recommended for agent workflows).

    Returns up to num_results result dicts with {title, url, content, score}.
    """
    settings = get_settings()
    api_key = settings.exa_api_key
    if not api_key:
        return []

    cache_key = _key("search", query, str(num_results), search_type)
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    try:
        from exa_py import Exa  # type: ignore

        client = Exa(api_key=api_key)
        kwargs: dict[str, Any] = {
            "type": search_type,
            "num_results": num_results,
            # highlights=True: token-efficient query-relevant excerpts,
            # recommended over full text for LLM agent workflows.
            "contents": {"highlights": True},
        }
        if include_domains:
            kwargs["include_domains"] = include_domains
        if exclude_domains:
            kwargs["exclude_domains"] = exclude_domains
        if start_published_date:
            kwargs["start_published_date"] = start_published_date

        response = client.search(query, **kwargs)
        results = _normalise(response.results)
        _cache_set(cache_key, results)
        return results

    except ImportError:
        return []
    except Exception:
        return []


async def exa_find_similar(
    url: str,
    num_results: int = 10,
    exclude_source_domain: bool = True,
) -> list[dict[str, Any]]:
    """Find pages similar to a known funding portal — good for peer discovery.

    Uses highlights content mode for token efficiency.
    """
    settings = get_settings()
    api_key = settings.exa_api_key
    if not api_key:
        return []

    cache_key = _key("similar", url, str(num_results))
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    try:
        from exa_py import Exa  # type: ignore

        client = Exa(api_key=api_key)
        response = client.find_similar(
            url,
            num_results=num_results,
            exclude_source_domain=exclude_source_domain,
            contents={"highlights": True},
        )
        results = _normalise(response.results)
        _cache_set(cache_key, results)
        return results

    except ImportError:
        return []
    except Exception:
        return []


async def exa_get_contents(
    urls: list[str],
    max_characters: int = 3000,
) -> list[dict[str, Any]]:
    """Fetch clean parsed content for a list of known URLs.

    Use this when you already have URLs and need their full text
    (e.g. after a search identified candidates worth reading in depth).
    Uses text mode with a character cap to control token cost.
    """
    settings = get_settings()
    api_key = settings.exa_api_key
    if not api_key or not urls:
        return []

    cache_key = _key("contents", *sorted(urls), str(max_characters))
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    try:
        from exa_py import Exa  # type: ignore

        client = Exa(api_key=api_key)
        response = client.get_contents(
            urls,
            text={"max_characters": max_characters},
        )
        results = _normalise(response.results)
        _cache_set(cache_key, results)
        return results

    except ImportError:
        return []
    except Exception:
        return []

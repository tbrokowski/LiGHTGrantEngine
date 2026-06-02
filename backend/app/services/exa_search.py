"""
Exa.ai neural web search wrapper.

Mirrors the interface of web_search.py: returns a list of result dicts with
{title, url, content, score}. Adds find_similar() for peer-portal discovery.

Falls back gracefully when EXA_API_KEY is not set or exa-py is not installed.
Uses a simple 24hr in-process cache (keyed on query + num_results).
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
    out = []
    for r in results:
        out.append({
            "title": getattr(r, "title", "") or "",
            "url": getattr(r, "url", "") or "",
            "content": (getattr(r, "text", None) or getattr(r, "highlights", None) or [""])[0]
            if isinstance(getattr(r, "highlights", None), list)
            else (getattr(r, "text", None) or ""),
            "score": getattr(r, "score", 0.0) or 0.0,
        })
    return out


async def exa_search(
    query: str,
    num_results: int = 10,
    use_autoprompt: bool = True,
    include_domains: list[str] | None = None,
    exclude_domains: list[str] | None = None,
    start_published_date: str | None = None,
) -> list[dict[str, Any]]:
    """Neural search via Exa.ai. Returns up to num_results result dicts."""
    settings = get_settings()
    api_key = settings.exa_api_key
    if not api_key:
        return []

    cache_key = _key("search", query, str(num_results))
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    try:
        from exa_py import Exa  # type: ignore

        client = Exa(api_key=api_key)
        kwargs: dict[str, Any] = {
            "num_results": num_results,
            "use_autoprompt": use_autoprompt,
            "text": {"max_characters": 800},
        }
        if include_domains:
            kwargs["include_domains"] = include_domains
        if exclude_domains:
            kwargs["exclude_domains"] = exclude_domains
        if start_published_date:
            kwargs["start_published_date"] = start_published_date

        response = client.search_and_contents(query, **kwargs)
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
    """Find pages similar to a known funding portal — good for peer discovery."""
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
        response = client.find_similar_and_contents(
            url,
            num_results=num_results,
            exclude_source_domain=exclude_source_domain,
            text={"max_characters": 800},
        )
        results = _normalise(response.results)
        _cache_set(cache_key, results)
        return results

    except ImportError:
        return []
    except Exception:
        return []

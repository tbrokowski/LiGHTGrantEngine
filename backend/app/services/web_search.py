"""
Web search service using Tavily for agentic grant research.
Provides clean, AI-optimised search results with 24h in-memory caching.
Falls back gracefully when TAVILY_API_KEY is not configured.
"""
from __future__ import annotations

import asyncio
import hashlib
import time
from typing import Any

from app.config import get_settings

_cache: dict[str, tuple[float, list[dict]]] = {}


def _cache_key(query: str, max_results: int) -> str:
    raw = f"{query}:{max_results}"
    return hashlib.sha256(raw.encode()).hexdigest()


def _cache_get(key: str, ttl_hours: int) -> list[dict] | None:
    entry = _cache.get(key)
    if not entry:
        return None
    ts, results = entry
    if time.time() - ts > ttl_hours * 3600:
        del _cache[key]
        return None
    return results


def _cache_set(key: str, results: list[dict]) -> None:
    _cache[key] = (time.time(), results)


async def search_web(
    query: str,
    max_results: int | None = None,
    search_depth: str = "basic",
    include_domains: list[str] | None = None,
    exclude_domains: list[str] | None = None,
) -> list[dict[str, Any]]:
    """
    Search the web via Tavily and return a list of result dicts.

    Each result contains:
      - title: str
      - url: str
      - content: str  (snippet / extracted text)
      - score: float  (relevance score from Tavily)
      - source_type: "web"

    Returns empty list if Tavily is not configured or the request fails.
    """
    settings = get_settings()
    cfg = settings.web_search

    if not cfg.enabled:
        return []

    api_key = settings.tavily_api_key
    if not api_key:
        return []

    if max_results is None:
        max_results = cfg.tavily_max_results

    cache_key = _cache_key(query, max_results)
    cached = _cache_get(cache_key, cfg.cache_ttl_hours)
    if cached is not None:
        return cached

    try:
        # Import lazily so the service still loads if tavily-python is not installed
        from tavily import AsyncTavilyClient  # type: ignore

        client = AsyncTavilyClient(api_key=api_key)
        kwargs: dict[str, Any] = {
            "query": query,
            "max_results": max_results,
            "search_depth": search_depth,
        }
        if include_domains:
            kwargs["include_domains"] = include_domains
        if exclude_domains:
            kwargs["exclude_domains"] = exclude_domains

        response = await client.search(**kwargs)
        raw_results = response.get("results") or []

        results = [
            {
                "source_type": "web",
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "content": r.get("content", ""),
                "score": r.get("score", 0.0),
            }
            for r in raw_results
        ]
        _cache_set(cache_key, results)
        return results

    except ImportError:
        return []
    except Exception:
        return []


async def search_web_multi(
    queries: list[str],
    max_results_per_query: int | None = None,
    search_depth: str = "basic",
) -> list[dict[str, Any]]:
    """
    Run multiple Tavily searches in parallel and merge + deduplicate results.
    """
    tasks = [
        search_web(q, max_results=max_results_per_query, search_depth=search_depth)
        for q in queries
    ]
    all_results_nested = await asyncio.gather(*tasks, return_exceptions=True)

    seen_urls: set[str] = set()
    merged: list[dict] = []
    for batch in all_results_nested:
        if isinstance(batch, Exception):
            continue
        for r in batch:
            url = r.get("url", "")
            if url and url not in seen_urls:
                seen_urls.add(url)
                merged.append(r)

    merged.sort(key=lambda x: x.get("score", 0.0), reverse=True)
    return merged

"""Fixed-window rate limiting on Redis, for endpoints that guess at secrets
(access codes) or send email (password reset)."""
from __future__ import annotations


async def hit_rate_limit(key: str, *, limit: int, window_seconds: int) -> bool:
    """Count one attempt against `key`; True once more than `limit` attempts
    land inside the window. Fails open if Redis is unreachable."""
    from app.auth.permissions import get_redis

    try:
        redis = await get_redis()
        full_key = f"ratelimit:{key}"
        count = await redis.incr(full_key)
        if count == 1:
            await redis.expire(full_key, window_seconds)
        return count > limit
    except Exception:
        return False

"""
Centralized permission dependencies for FastAPI routes.

Two tiers:
  1. Org-level: require_role() — checks User.role / User.institution_role
  2. Grant-level: require_grant_access() — checks GrantMember table with Redis caching

Redis cache schema (per user):
  Key:   perm:{user_id}
  Type:  Hash
  TTL:   900s (15 min)
  Fields:
    role            → e.g. "grant_lead"
    institution_id  → e.g. "abc-123" (empty string if none)
    institution_role → e.g. "admin"
    grant_ids       → comma-separated accepted grant IDs
"""
from __future__ import annotations

import json
from typing import Callable, Optional

import redis.asyncio as aioredis
from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.active_grant import ActiveGrant
from app.models.grant_member import GrantMember, GrantMemberRole, GrantMemberStatus
from app.models.user import User, UserRole
from app.routers.auth import get_current_user

# ---------------------------------------------------------------------------
# Redis connection
# ---------------------------------------------------------------------------

_redis_pool: Optional[aioredis.Redis] = None


async def get_redis() -> aioredis.Redis:
    global _redis_pool
    if _redis_pool is None:
        settings = get_settings()
        _redis_pool = aioredis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
        )
    return _redis_pool


# ---------------------------------------------------------------------------
# Role ordering — higher index = more privileged
# ---------------------------------------------------------------------------

_ROLE_ORDER = [
    UserRole.VIEWER,
    UserRole.CONTRIBUTOR,
    UserRole.REVIEWER,
    UserRole.OPERATIONS_MANAGER,
    UserRole.GRANT_LEAD,
    UserRole.ADMIN,
]

_GRANT_ROLE_ORDER = [
    GrantMemberRole.VIEWER,
    GrantMemberRole.EDITOR,
    GrantMemberRole.OWNER,
]


def _role_rank(role: str) -> int:
    try:
        return _ROLE_ORDER.index(UserRole(role))
    except (ValueError, KeyError):
        return -1


def _grant_role_rank(role: str) -> int:
    try:
        return _GRANT_ROLE_ORDER.index(GrantMemberRole(role))
    except (ValueError, KeyError):
        return -1


def is_org_admin(user: User) -> bool:
    return user.role == UserRole.ADMIN or user.institution_role == "admin"


def is_ops_or_above(user: User) -> bool:
    return _role_rank(user.role) >= _role_rank(UserRole.OPERATIONS_MANAGER)


# Sensible defaults when a user's module_permissions dict has no entry for a key.
# - can_view_grants: False (requires explicit grant membership or org admin)
# - can_view_archive: True  (backward-compatible; archive was always visible)
# - can_view_partners: True (backward-compatible; partners were always visible)
_MODULE_PERMISSION_DEFAULTS: dict[str, bool] = {
    "can_view_grants": False,
    "can_view_archive": True,
    "can_view_partners": True,
}


def has_module_permission(user: User, key: str) -> bool:
    """Return True if the user has access to a given module.

    Org admins always return True regardless of stored permissions.
    For regular members the value is read from User.module_permissions with a
    sensible default (see _MODULE_PERMISSION_DEFAULTS).
    """
    if is_org_admin(user):
        return True
    perms: dict = user.module_permissions or {}
    return perms.get(key, _MODULE_PERMISSION_DEFAULTS.get(key, False))


# ---------------------------------------------------------------------------
# Redis cache helpers
# ---------------------------------------------------------------------------

_PERM_TTL = 900  # 15 minutes


def _perm_key(user_id: str) -> str:
    return f"perm:{user_id}"


async def get_permission_cache(user_id: str, redis: aioredis.Redis) -> Optional[dict]:
    """Return cached permission dict or None if not cached."""
    data = await redis.hgetall(_perm_key(user_id))
    if not data:
        return None
    return data


async def set_permission_cache(user: User, grant_ids: list[str], redis: aioredis.Redis) -> None:
    key = _perm_key(user.id)
    await redis.hset(key, mapping={
        "role": user.role or "",
        "institution_id": user.institution_id or "",
        "institution_role": user.institution_role or "",
        "grant_ids": ",".join(grant_ids),
    })
    await redis.expire(key, _PERM_TTL)


async def invalidate_permission_cache(user_id: str, redis: aioredis.Redis) -> None:
    """Delete cached permissions for a user. Call on role change or membership change."""
    await redis.delete(_perm_key(user_id))


async def get_user_grant_ids(user: User, db: AsyncSession, redis: aioredis.Redis) -> list[str]:
    """Return list of grant IDs the user has accepted membership in, with Redis caching."""
    cached = await get_permission_cache(user.id, redis)
    if cached is not None:
        raw = cached.get("grant_ids", "")
        return [g for g in raw.split(",") if g]

    result = await db.execute(
        select(GrantMember.grant_id).where(
            GrantMember.user_id == user.id,
            GrantMember.status == GrantMemberStatus.ACCEPTED,
        )
    )
    grant_ids = list(result.scalars().all())
    await set_permission_cache(user, grant_ids, redis)
    return grant_ids


# ---------------------------------------------------------------------------
# Org-level role dependency factory
# ---------------------------------------------------------------------------

def require_role(minimum_role: UserRole) -> Callable:
    """
    Returns a FastAPI dependency that enforces a minimum org role.

    Usage:
        @router.post("/", dependencies=[Depends(require_role(UserRole.GRANT_LEAD))])
    """
    async def _check(current_user: User = Depends(get_current_user)) -> User:
        if _role_rank(current_user.role) < _role_rank(minimum_role):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires role '{minimum_role}' or higher.",
            )
        return current_user
    return _check


def require_org_admin() -> Callable:
    """Requires institution_role=admin OR role=admin."""
    async def _check(current_user: User = Depends(get_current_user)) -> User:
        if not is_org_admin(current_user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Requires organization admin privileges.",
            )
        return current_user
    return _check


def can_edit_archive(user: User) -> bool:
    """Grant lead (or higher) or organization admin may create/edit archive entries."""
    return _role_rank(user.role) >= _role_rank(UserRole.GRANT_LEAD) or is_org_admin(user)


def require_archive_editor() -> Callable:
    """Archive write endpoints: grant_lead+ or institution/org admin."""
    async def _check(current_user: User = Depends(get_current_user)) -> User:
        if not can_edit_archive(current_user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Requires grant lead role or organization admin privileges.",
            )
        return current_user
    return _check


# ---------------------------------------------------------------------------
# Grant-level access dependency
# ---------------------------------------------------------------------------

async def _check_grant_access(
    grant_id: str,
    current_user: User,
    db: AsyncSession,
    redis: aioredis.Redis,
    require_editor: bool = False,
) -> Optional[GrantMember]:
    """
    Core grant access check:
    - personal grants (is_personal=True) are fully accessible by their creator
    - org admins and operations managers bypass grant-level checks (read-only for ops_manager)
    - others must have an accepted GrantMember row for this grant
    - if require_editor=True, viewer role is rejected
    Returns the GrantMember row (or None for org admin / personal grant bypass).
    Raises 403/404 on failure.
    """
    # Personal grant bypass: creator has full access to their own personal grants
    grant_result = await db.execute(
        select(ActiveGrant).where(ActiveGrant.id == grant_id)
    )
    grant = grant_result.scalar_one_or_none()
    if grant and grant.is_personal and grant.created_by_id == current_user.id:
        return None

    if is_org_admin(current_user):
        return None  # org admins see everything

    if is_ops_or_above(current_user) and not require_editor:
        return None  # ops managers get read access across org

    grant_ids = await get_user_grant_ids(current_user, db, redis)

    if grant_id not in grant_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this grant.",
        )

    if require_editor:
        result = await db.execute(
            select(GrantMember).where(
                GrantMember.grant_id == grant_id,
                GrantMember.user_id == current_user.id,
                GrantMember.status == GrantMemberStatus.ACCEPTED,
            )
        )
        member = result.scalar_one_or_none()
        if member and _grant_role_rank(member.role) < _grant_role_rank(GrantMemberRole.EDITOR):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You have view-only access to this grant.",
            )
        return member

    return None


def grant_access(require_editor: bool = False) -> Callable:
    """
    Dependency factory for grant-level access.

    Usage:
        @router.get("/{grant_id}/sections")
        async def get_sections(
            grant_id: str,
            _: None = Depends(grant_access()),
            ...
        ):

        @router.post("/{grant_id}/sections")
        async def create_section(
            grant_id: str,
            _: None = Depends(grant_access(require_editor=True)),
            ...
        ):
    """
    async def _dep(
        grant_id: str,
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
        redis: aioredis.Redis = Depends(get_redis),
    ) -> Optional[GrantMember]:
        return await _check_grant_access(grant_id, current_user, db, redis, require_editor)
    return _dep

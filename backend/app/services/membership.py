"""Organization memberships: one user, many organizations, one of them active.

`institution_memberships` is the source of truth. The membership columns on
`users` (institution_id, institution_role, role, module_permissions) are a copy
of the active membership, which is what the rest of the app reads. Every change
goes through here so the two never drift; callers commit and then clear the
user's permission cache.
"""
from __future__ import annotations

import uuid
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.institution import Institution
from app.models.institution_membership import InstitutionMembership
from app.models.user import User, UserRole, InstitutionRole


def is_admin_membership(m: InstitutionMembership) -> bool:
    return m.institution_role == InstitutionRole.ADMIN or m.role == UserRole.ADMIN


def activate(user: User, m: InstitutionMembership) -> None:
    """Make `m` the user's active organization."""
    user.institution_id = m.institution_id
    user.institution_role = m.institution_role
    user.role = m.role
    user.module_permissions = dict(m.module_permissions or {})


def mirror_if_active(user: User, m: InstitutionMembership) -> None:
    """After editing a membership, copy it onto the user if it's their active one."""
    if user.institution_id == m.institution_id:
        activate(user, m)


async def get_membership(db: AsyncSession, user_id: str, institution_id: str) -> Optional[InstitutionMembership]:
    return (await db.execute(
        select(InstitutionMembership).where(
            InstitutionMembership.user_id == user_id,
            InstitutionMembership.institution_id == institution_id,
        )
    )).scalar_one_or_none()


async def ensure_active_membership(db: AsyncSession, user: User) -> Optional[InstitutionMembership]:
    """Return the membership row for the user's active org, creating it if a
    script (seed, bootstrap) set `users.institution_id` directly."""
    if not user.institution_id:
        return None
    m = await get_membership(db, user.id, user.institution_id)
    if m is None:
        m = InstitutionMembership(
            id=str(uuid.uuid4()),
            user_id=user.id,
            institution_id=user.institution_id,
            institution_role=user.institution_role or InstitutionRole.MEMBER,
            role=user.role or UserRole.CONTRIBUTOR,
            module_permissions=dict(user.module_permissions or {}),
            joined_via="backfill",
        )
        db.add(m)
        await db.flush()
    return m


async def add_membership(
    db: AsyncSession,
    user: User,
    institution_id: str,
    *,
    institution_role: str = InstitutionRole.MEMBER,
    role: str = UserRole.CONTRIBUTOR,
    module_permissions: Optional[dict] = None,
    joined_via: str,
    make_active: bool = False,
) -> InstitutionMembership:
    """Add the user to an organization, or update their existing membership.

    The new org becomes active when `make_active` is set or when the user has
    no active org yet."""
    await ensure_active_membership(db, user)
    m = await get_membership(db, user.id, institution_id)
    if m is None:
        m = InstitutionMembership(id=str(uuid.uuid4()), user_id=user.id, institution_id=institution_id, joined_via=joined_via)
        db.add(m)
    m.institution_role = institution_role
    m.role = role
    m.module_permissions = dict(module_permissions or {})
    await db.flush()
    if make_active or not user.institution_id:
        activate(user, m)
    else:
        mirror_if_active(user, m)
    return m


async def list_memberships(db: AsyncSession, user: User) -> list[tuple[InstitutionMembership, Institution]]:
    await ensure_active_membership(db, user)
    return await _membership_rows(db, user.id)


async def _membership_rows(db: AsyncSession, user_id: str) -> list[tuple[InstitutionMembership, Institution]]:
    rows = (await db.execute(
        select(InstitutionMembership, Institution)
        .join(Institution, Institution.id == InstitutionMembership.institution_id)
        .where(InstitutionMembership.user_id == user_id)
        .order_by(Institution.is_personal.desc(), Institution.name)
    )).all()
    return [(m, inst) for m, inst in rows]


async def member_count(db: AsyncSession, institution_id: str) -> int:
    return (await db.execute(
        select(func.count())
        .select_from(InstitutionMembership)
        .join(User, User.id == InstitutionMembership.user_id)
        .where(InstitutionMembership.institution_id == institution_id, User.is_active.is_(True))
    )).scalar_one()


async def is_last_admin_with_others(db: AsyncSession, user_id: str, institution_id: str) -> bool:
    """True when the user is the only admin of an org that has other members —
    they'd leave it with nobody able to manage it."""
    rows = (await db.execute(
        select(InstitutionMembership)
        .join(User, User.id == InstitutionMembership.user_id)
        .where(InstitutionMembership.institution_id == institution_id, User.is_active.is_(True))
    )).scalars().all()
    me = next((m for m in rows if m.user_id == user_id), None)
    if me is None or not is_admin_membership(me):
        return False
    other_admins = [m for m in rows if m.user_id != user_id and is_admin_membership(m)]
    others = [m for m in rows if m.user_id != user_id]
    return bool(others) and not other_admins


async def remove_membership(db: AsyncSession, user: User, institution_id: str) -> None:
    """Take the user out of an organization. If it was their active one, fall
    back to another of their organizations (personal workspace first), or none."""
    m = await get_membership(db, user.id, institution_id)
    if m is not None:
        await db.delete(m)
        await db.flush()
    if user.institution_id != institution_id:
        return
    remaining = await _membership_rows(db, user.id)
    if remaining:
        activate(user, remaining[0][0])
    else:
        user.institution_id = None
        user.institution_role = InstitutionRole.MEMBER
        user.module_permissions = {}

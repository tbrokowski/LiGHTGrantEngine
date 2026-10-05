"""User management endpoints."""
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.user import User, UserRole
from app.models.institution_membership import InstitutionMembership
from app.routers.auth import get_current_user, get_password_hash, verify_password
from app.auth.permissions import require_org_admin, is_org_admin, invalidate_permission_cache, get_redis
from app.services.account_deletion import delete_account
from app.services.membership import (
    add_membership,
    get_membership,
    is_last_admin_with_others,
    list_memberships,
    mirror_if_active,
    remove_membership,
)
import redis.asyncio as aioredis

router = APIRouter()

class UserCreate(BaseModel):
    name: str
    email: str
    password: str
    role: str = "reviewer"
    team: Optional[str] = None


class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None  # admins only: the role in the admin's active org
    team: Optional[str] = None
    notification_preferences: Optional[dict] = None
    grant_preferences: Optional[dict] = None
    # Email and password have their own endpoints (/auth/change-email,
    # /auth/change-password) because both need the current password.


class DeleteAccountBody(BaseModel):
    confirm: str                    # must be "DELETE"
    password: Optional[str] = None  # required when the account has a password


class GrantPreferencesUpdate(BaseModel):
    keywords: Optional[list[str]] = None
    excluded_keywords: Optional[list[str]] = None
    grant_categories: Optional[list[str]] = None


@router.get("/")
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = select(User).where(User.is_active == True)
    # Scope to members of the active institution
    if current_user.institution_id:
        q = q.join(InstitutionMembership, InstitutionMembership.user_id == User.id).where(
            InstitutionMembership.institution_id == current_user.institution_id
        )
    else:
        q = q.where(User.id == current_user.id)
    result = await db.execute(q)
    return [
        {
            "id": u.id,
            "name": u.name,
            "email": u.email,
            "role": u.role,
            "team": u.team,
            "institution_id": u.institution_id,
            "institution_role": u.institution_role,
        }
        for u in result.scalars().all()
    ]


@router.post("/", status_code=201, dependencies=[Depends(require_org_admin())])
async def create_user(
    data: UserCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    existing = (await db.execute(select(User).where(User.email == data.email))).scalar_one_or_none()
    if existing:
        raise HTTPException(400, "Email already registered")
    user = User(
        id=str(uuid.uuid4()),
        name=data.name,
        email=data.email,
        hashed_password=get_password_hash(data.password),
        role=data.role,
        team=data.team,
    )
    db.add(user)
    await db.flush()
    if current_user.institution_id:
        await add_membership(db, user, current_user.institution_id, role=data.role, joined_via="admin")
    await db.commit()
    return {"id": user.id}


@router.patch("/{user_id}")
async def update_user(
    user_id: str,
    data: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    redis: aioredis.Redis = Depends(get_redis),
):
    updates = data.model_dump(exclude_none=True)
    role = updates.pop("role", None)

    if current_user.id == user_id:
        user = current_user
        if role is not None and not is_org_admin(current_user):
            role = None  # members can't change their own role
    else:
        # Admins may edit people in their active org, and only their role there.
        if not is_org_admin(current_user) or not current_user.institution_id:
            raise HTTPException(403, "You can only edit your own profile.")
        user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
        m = await get_membership(db, user_id, current_user.institution_id) if user else None
        if not user or not m:
            raise HTTPException(404, "User not found")
        updates = {}

    if role is not None and current_user.institution_id:
        try:
            role = UserRole(role)
        except ValueError:
            raise HTTPException(400, f"Invalid role: {role}")
        m = await get_membership(db, user.id, current_user.institution_id)
        if m:
            m.role = role
            mirror_if_active(user, m)

    if "name" in updates and not updates["name"].strip():
        raise HTTPException(400, "Name can't be empty.")
    for k, v in updates.items():
        setattr(user, k, v.strip() if isinstance(v, str) else v)
    await db.commit()
    await invalidate_permission_cache(user_id, redis)
    return {"id": user.id}


@router.get("/me/grant-preferences")
async def get_my_grant_preferences(current_user: User = Depends(get_current_user)):
    return current_user.grant_preferences or {}


@router.patch("/me/grant-preferences")
async def update_my_grant_preferences(
    body: GrantPreferencesUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    prefs = dict(current_user.grant_preferences or {})
    for k, v in body.model_dump(exclude_none=True).items():
        prefs[k] = v
    current_user.grant_preferences = prefs
    await db.commit()
    return prefs


@router.get("/me/ai-usage")
async def get_ai_usage(current_user: User = Depends(get_current_user)):
    """Return current user's AI usage vs limit."""
    return {
        "ai_usage_cents": current_user.ai_usage_cents,
        "ai_usage_limit_cents": current_user.ai_usage_limit_cents,
        "usage_dollars": current_user.ai_usage_cents / 100,
        "limit_dollars": current_user.ai_usage_limit_cents / 100,
        "usage_pct": round(current_user.ai_usage_cents / max(current_user.ai_usage_limit_cents, 1) * 100, 1),
        "is_personal_institution": True,  # will be refined when institution.is_personal is checked
    }


class OnboardingCompleteBody(BaseModel):
    grant_categories: Optional[list[str]] = None
    keywords: Optional[list[str]] = None
    workflow_type: Optional[str] = None


@router.post("/me/onboarding/complete")
async def complete_personal_onboarding(
    body: OnboardingCompleteBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Save personal onboarding data and mark onboarding complete."""
    prefs = dict(current_user.grant_preferences or {})
    if body.grant_categories:
        prefs["grant_categories"] = body.grant_categories
    if body.keywords:
        prefs["keywords"] = body.keywords
    if body.workflow_type:
        prefs["workflow_type"] = body.workflow_type

    current_user.grant_preferences = prefs
    current_user.onboarding_complete = True
    await db.commit()
    return {"onboarding_complete": True}


@router.delete("/me", status_code=204)
async def delete_my_account(
    body: DeleteAccountBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    redis: aioredis.Redis = Depends(get_redis),
):
    """Delete your own account: personal data is scrubbed and every session ends.
    The email is freed, so it can be used to sign up again."""
    if body.confirm.strip().upper() != "DELETE":
        raise HTTPException(400, 'Type DELETE to confirm.')
    if current_user.hashed_password and not (
        body.password and verify_password(body.password, current_user.hashed_password)
    ):
        raise HTTPException(400, "Password is incorrect.")

    blocking = [
        inst.name
        for _, inst in await list_memberships(db, current_user)
        if not inst.is_personal and await is_last_admin_with_others(db, current_user.id, inst.id)
    ]
    if blocking:
        raise HTTPException(
            400,
            f"You're the only admin of {', '.join(blocking)}. Make someone else an admin first, "
            "so the organization isn't left without one.",
        )

    await delete_account(db, current_user)
    await db.commit()
    await invalidate_permission_cache(current_user.id, redis)


@router.delete("/{user_id}", status_code=204, dependencies=[Depends(require_org_admin())])
async def delete_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    redis: aioredis.Redis = Depends(get_redis),
):
    """Remove someone from the admin's active organization. Their account (and
    any other organizations they belong to) is untouched."""
    if user_id == current_user.id:
        raise HTTPException(400, "You cannot remove yourself.")
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user or not current_user.institution_id or not await get_membership(db, user_id, current_user.institution_id):
        raise HTTPException(404, "User not found")
    await remove_membership(db, user, current_user.institution_id)
    await db.commit()
    await invalidate_permission_cache(user_id, redis)

"""User management endpoints."""
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.user import User, UserRole
from app.routers.auth import get_current_user, get_password_hash
from app.auth.permissions import require_org_admin, is_org_admin, invalidate_permission_cache, get_redis
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
    role: Optional[str] = None
    team: Optional[str] = None
    is_active: Optional[bool] = None
    notification_preferences: Optional[dict] = None
    grant_preferences: Optional[dict] = None


class GrantPreferencesUpdate(BaseModel):
    keywords: Optional[list[str]] = None
    excluded_keywords: Optional[list[str]] = None


@router.get("/")
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = select(User).where(User.is_active == True)
    # Scope to same institution
    if current_user.institution_id:
        q = q.where(User.institution_id == current_user.institution_id)
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
        institution_id=current_user.institution_id,
    )
    db.add(user)
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
    if not is_org_admin(current_user) and current_user.id != user_id:
        raise HTTPException(403, "You can only edit your own profile.")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")

    # Only org admins can change roles or active status
    updates = data.model_dump(exclude_none=True)
    if not is_org_admin(current_user):
        updates.pop("role", None)
        updates.pop("is_active", None)

    for k, v in updates.items():
        setattr(user, k, v)
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


@router.delete("/{user_id}", status_code=204, dependencies=[Depends(require_org_admin())])
async def delete_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    redis: aioredis.Redis = Depends(get_redis),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")
    if user.id == current_user.id:
        raise HTTPException(400, "You cannot delete your own account.")
    user.is_active = False
    await db.commit()
    await invalidate_permission_cache(user_id, redis)

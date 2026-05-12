"""User management endpoints."""
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.user import User
from app.routers.auth import get_current_user, get_password_hash

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

@router.get("/")
async def list_users(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(User).where(User.is_active == True))
    return [{"id": u.id, "name": u.name, "email": u.email, "role": u.role, "team": u.team} for u in result.scalars().all()]

@router.post("/", status_code=201)
async def create_user(data: UserCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(403, "Admin only")
    existing = (await db.execute(select(User).where(User.email == data.email))).scalar_one_or_none()
    if existing:
        raise HTTPException(400, "Email already registered")
    user = User(id=str(uuid.uuid4()), name=data.name, email=data.email, hashed_password=get_password_hash(data.password), role=data.role, team=data.team)
    db.add(user)
    await db.commit()
    return {"id": user.id}

@router.patch("/{user_id}")
async def update_user(user_id: str, data: UserUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(user, k, v)
    await db.commit()
    return {"id": user.id}

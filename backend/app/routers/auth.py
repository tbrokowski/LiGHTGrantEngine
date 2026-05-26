"""Authentication endpoints."""
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.user import User, UserRole, InstitutionRole
from app.models.institution import Institution

router = APIRouter()
settings = get_settings()

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")


class Token(BaseModel):
    access_token: str
    token_type: str
    user_id: str
    role: str
    name: str
    institution_id: Optional[str] = None
    institution_role: Optional[str] = None


class TokenData(BaseModel):
    user_id: Optional[str] = None


class RegisterBody(BaseModel):
    name: str
    email: str
    password: str
    institution_id: Optional[str] = None      # join existing institution
    institution_name: Optional[str] = None     # create new institution (becomes admin)
    institution_domain: Optional[str] = None   # optional domain when creating


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: dict) -> str:
    expire = datetime.utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
    return jwt.encode({**data, "exp": expire}, settings.secret_key, algorithm=settings.algorithm)


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        user_id: str = payload.get("sub")
        if not user_id:
            raise credentials_exc
    except JWTError:
        raise credentials_exc

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise credentials_exc
    return user


@router.post("/token", response_model=Token)
async def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.email == form.username))
    user = result.scalar_one_or_none()
    if not user or not user.hashed_password or not verify_password(form.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect email or password")

    user.last_login = datetime.utcnow()
    await db.commit()

    token = create_access_token({"sub": user.id, "role": user.role})
    return Token(
        access_token=token,
        token_type="bearer",
        user_id=user.id,
        role=user.role,
        name=user.name,
        institution_id=user.institution_id,
        institution_role=user.institution_role,
    )


@router.post("/register", response_model=Token, status_code=201)
async def register(
    body: RegisterBody,
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    institution_id: Optional[str] = None
    institution_role: str = InstitutionRole.MEMBER

    if body.institution_id:
        inst = (await db.execute(select(Institution).where(Institution.id == body.institution_id))).scalar_one_or_none()
        if not inst:
            raise HTTPException(status_code=404, detail="Institution not found")
        institution_id = inst.id
        institution_role = InstitutionRole.MEMBER
    elif body.institution_name:
        inst = Institution(
            id=str(uuid.uuid4()),
            name=body.institution_name,
            domain=body.institution_domain,
        )
        db.add(inst)
        await db.flush()
        institution_id = inst.id
        institution_role = InstitutionRole.ADMIN

    user = User(
        id=str(uuid.uuid4()),
        name=body.name,
        email=body.email,
        hashed_password=get_password_hash(body.password),
        role=UserRole.CONTRIBUTOR,
        institution_id=institution_id,
        institution_role=institution_role,
    )
    db.add(user)
    await db.commit()

    token = create_access_token({"sub": user.id, "role": user.role})
    return Token(
        access_token=token,
        token_type="bearer",
        user_id=user.id,
        role=user.role,
        name=user.name,
        institution_id=user.institution_id,
        institution_role=user.institution_role,
    )


@router.get("/me")
async def me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "name": current_user.name,
        "email": current_user.email,
        "role": current_user.role,
        "institution_id": current_user.institution_id,
        "institution_role": current_user.institution_role,
    }


# ── Institution search (public — for registration form) ────────────────────────

@router.get("/institutions")
async def list_institutions(
    q: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Return institutions for the registration search-and-join flow."""
    query = select(Institution)
    if q:
        query = query.where(Institution.name.ilike(f"%{q}%"))
    result = await db.execute(query.limit(20))
    insts = result.scalars().all()
    return [{"id": i.id, "name": i.name, "domain": i.domain} for i in insts]

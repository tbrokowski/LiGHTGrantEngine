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
from app.models.org_join_request import OrgJoinRequest, JoinRequestStatus
from app.services.organization_setup import (
    personal_workspace_name,
    invited_member_role,
    queue_org_scaffold,
)

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
    # "active" | "pending_approval" — frontend uses this to show a waiting screen
    account_status: str = "active"


class TokenData(BaseModel):
    user_id: Optional[str] = None


class RegisterBody(BaseModel):
    name: str
    email: str
    password: str
    institution_id: Optional[str] = None       # request to join (creates OrgJoinRequest)
    institution_name: Optional[str] = None     # create new institution (becomes admin)
    institution_domain: Optional[str] = None   # optional domain when creating
    join_message: Optional[str] = None         # optional message for join request


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
    account_status = "active"
    user_role = UserRole.CONTRIBUTOR

    if body.institution_name:
        # Create a new organization — caller becomes org_admin
        inst = Institution(
            id=str(uuid.uuid4()),
            name=body.institution_name,
            domain=body.institution_domain,
            is_personal=False,
        )
        db.add(inst)
        await db.flush()
        institution_id = inst.id
        institution_role = InstitutionRole.ADMIN
        user_role = UserRole.GRANT_LEAD
    elif body.institution_id:
        # Join by search: create account + submit join request (pending approval)
        inst = (await db.execute(select(Institution).where(Institution.id == body.institution_id))).scalar_one_or_none()
        if not inst:
            raise HTTPException(status_code=404, detail="Institution not found")
        if inst.is_personal:
            raise HTTPException(status_code=400, detail="Cannot join a personal workspace.")
        # User is created WITHOUT institution yet — pending approval
        account_status = "pending_approval"
    else:
        # No institution selected — auto-create a personal workspace with admin access
        inst = Institution(
            id=str(uuid.uuid4()),
            name=personal_workspace_name(body.name),
            is_personal=True,
        )
        db.add(inst)
        await db.flush()
        institution_id = inst.id
        institution_role = InstitutionRole.ADMIN
        user_role = UserRole.GRANT_LEAD

    user = User(
        id=str(uuid.uuid4()),
        name=body.name,
        email=body.email,
        hashed_password=get_password_hash(body.password),
        role=user_role,
        institution_id=institution_id,
        institution_role=institution_role,
    )
    db.add(user)
    await db.flush()

    if body.institution_id and account_status == "pending_approval":
        # Create OrgJoinRequest
        join_req = OrgJoinRequest(
            id=str(uuid.uuid4()),
            institution_id=body.institution_id,
            user_id=user.id,
            email=user.email,
            name=user.name,
            message=body.join_message,
            status=JoinRequestStatus.PENDING,
        )
        db.add(join_req)

    await db.commit()

    if institution_id and user_role == UserRole.GRANT_LEAD:
        queue_org_scaffold(institution_id, user.id)

    token = create_access_token({"sub": user.id, "role": user.role})
    return Token(
        access_token=token,
        token_type="bearer",
        user_id=user.id,
        role=user.role,
        name=user.name,
        institution_id=user.institution_id,
        institution_role=user.institution_role,
        account_status=account_status,
    )


class AcceptInviteBody(BaseModel):
    token: str
    name: str
    password: str


@router.get("/invite/{token}")
async def validate_invite_token(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """Validate an org invite token, returning email/role/institution_name."""
    credentials_exc = HTTPException(400, "Invalid or expired invite token")
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        if payload.get("sub") != "invite":
            raise credentials_exc
        institution_id = payload.get("institution_id")
        email = payload.get("email")
        role = payload.get("role")
        if not institution_id or not email:
            raise credentials_exc
    except JWTError:
        raise credentials_exc

    inst = (await db.execute(select(Institution).where(Institution.id == institution_id))).scalar_one_or_none()
    if not inst:
        raise credentials_exc

    return {"email": email, "role": role, "institution_id": institution_id, "institution_name": inst.name}


@router.post("/accept-invite", response_model=Token, status_code=201)
async def accept_invite(
    body: AcceptInviteBody,
    db: AsyncSession = Depends(get_db),
):
    """Accept an org invite: create account (or link existing) and join org directly."""
    credentials_exc = HTTPException(400, "Invalid or expired invite token")
    try:
        payload = jwt.decode(body.token, settings.secret_key, algorithms=[settings.algorithm])
        if payload.get("sub") != "invite":
            raise credentials_exc
        institution_id = payload.get("institution_id")
        email = payload.get("email")
        role = payload.get("role", UserRole.CONTRIBUTOR)
        if not institution_id or not email:
            raise credentials_exc
    except JWTError:
        raise credentials_exc

    inst = (await db.execute(select(Institution).where(Institution.id == institution_id))).scalar_one_or_none()
    if not inst:
        raise HTTPException(404, "Organization not found")

    # Check if user already exists
    existing_user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if existing_user:
        # Switch to invited org as a regular member (not admin)
        existing_user.institution_id = institution_id
        existing_user.institution_role = InstitutionRole.MEMBER
        existing_user.role = invited_member_role(role)
        await db.commit()
        user = existing_user
    else:
        # Create new user
        user = User(
            id=str(uuid.uuid4()),
            name=body.name,
            email=email,
            hashed_password=get_password_hash(body.password),
            role=invited_member_role(role),
            institution_id=institution_id,
            institution_role=InstitutionRole.MEMBER,
        )
        db.add(user)
        await db.commit()

    token_str = create_access_token({"sub": user.id, "role": user.role})
    return Token(
        access_token=token_str,
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
    query = select(Institution).where(Institution.is_personal.is_(False))
    if q:
        query = query.where(Institution.name.ilike(f"%{q}%"))
    result = await db.execute(query.limit(20))
    insts = result.scalars().all()
    return [{"id": i.id, "name": i.name, "domain": i.domain} for i in insts]

"""Authentication endpoints."""
import uuid
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db, AsyncSessionLocal
from app.models.user import User, UserRole, InstitutionRole
from app.models.institution import Institution
from app.models.org_join_request import OrgJoinRequest, JoinRequestStatus
from app.models.email_verification import EmailVerification
from app.models.password_reset import PasswordResetToken
from app.services.organization_setup import (
    personal_workspace_name,
    invited_member_role,
    queue_org_scaffold,
)
from app.services.email import send_email

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
    email_verified: bool = False
    onboarding_complete: bool = False


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
        email_verified=user.email_verified,
        onboarding_complete=user.onboarding_complete,
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

    # Send verification email in a background task with its own DB session
    import asyncio
    asyncio.create_task(_send_verification_email(user.id, user.email, user.name))

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
        email_verified=user.email_verified,
        onboarding_complete=user.onboarding_complete,
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
        # New fields encoded by the updated invite endpoint
        invited_institution_role = payload.get("institution_role", "member")
        invited_module_permissions = payload.get("module_permissions") or {}
        if not institution_id or not email:
            raise credentials_exc
    except JWTError:
        raise credentials_exc

    inst = (await db.execute(select(Institution).where(Institution.id == institution_id))).scalar_one_or_none()
    if not inst:
        raise HTTPException(404, "Organization not found")

    # Resolve institution_role from invite
    resolved_institution_role = (
        InstitutionRole.ADMIN
        if invited_institution_role == "admin"
        else InstitutionRole.MEMBER
    )

    # Check if user already exists
    existing_user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if existing_user:
        existing_user.institution_id = institution_id
        existing_user.institution_role = resolved_institution_role
        existing_user.role = invited_member_role(role)
        existing_user.email_verified = True
        existing_user.module_permissions = invited_module_permissions
        await db.commit()
        user = existing_user
    else:
        # Create new user — email is trusted because it came from an org invite link
        user = User(
            id=str(uuid.uuid4()),
            name=body.name,
            email=email,
            hashed_password=get_password_hash(body.password),
            role=invited_member_role(role),
            institution_id=institution_id,
            institution_role=resolved_institution_role,
            email_verified=True,
            module_permissions=invited_module_permissions,
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
        email_verified=user.email_verified,
        onboarding_complete=user.onboarding_complete,
    )


@router.get("/me")
async def me(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.auth.permissions import (
        is_org_admin,
        _MODULE_PERMISSION_DEFAULTS,
        can_view_finance_module,
    )

    # Build the effective module_permissions dict, merging defaults with stored values.
    # Org admins always have all permissions set to True.
    if is_org_admin(current_user):
        effective_perms = {k: True for k in _MODULE_PERMISSION_DEFAULTS}
    else:
        stored = current_user.module_permissions or {}
        effective_perms = {
            k: (
                can_view_finance_module(current_user)
                if k == "can_view_finance"
                else stored.get(k, default)
            )
            for k, default in _MODULE_PERMISSION_DEFAULTS.items()
        }

    inst = await db.get(Institution, current_user.institution_id) if current_user.institution_id else None
    institution_is_personal = inst.is_personal if inst else True

    return {
        "id": current_user.id,
        "name": current_user.name,
        "email": current_user.email,
        "role": current_user.role,
        "institution_id": current_user.institution_id,
        "institution_role": current_user.institution_role,
        "email_verified": current_user.email_verified,
        "onboarding_complete": current_user.onboarding_complete,
        "ai_usage_cents": current_user.ai_usage_cents,
        "ai_usage_limit_cents": current_user.ai_usage_limit_cents,
        "google_access_token": "connected" if current_user.google_access_token else None,
        "module_permissions": effective_perms,
        "institution_is_personal": institution_is_personal,
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


# ── Email verification ─────────────────────────────────────────────────────────

class SendVerificationBody(BaseModel):
    email: Optional[str] = None  # if omitted, use current_user.email


async def _send_verification_email(user_id: str, email: str, name: str, db: AsyncSession | None = None) -> None:
    """Create a verification token and send the email.

    If db is None (or the caller passes the request-scoped session from a
    background task), a fresh session is opened so we don't race with the
    request teardown.
    """
    import uuid as _uuid

    async def _do(session: AsyncSession) -> None:
        token = secrets.token_urlsafe(32)
        expires = datetime.now(timezone.utc) + timedelta(hours=24)
        verification = EmailVerification(
            id=str(_uuid.uuid4()),
            user_id=user_id,
            token=token,
            expires_at=expires,
        )
        session.add(verification)
        try:
            await session.commit()
        except Exception:
            await session.rollback()
            return

        app_url = settings.base_url or "http://localhost:3000"
        verify_url = f"{app_url}/verify-email?token={token}"
        html = f"""
        <p>Hi {name},</p>
        <p>Please verify your email address by clicking the link below:</p>
        <p><a href="{verify_url}">{verify_url}</a></p>
        <p>This link expires in 24 hours.</p>
        <p>If you did not create an account, you can ignore this email.</p>
        """
        await send_email(
            to=email,
            subject="Verify your Grant Engine email",
            html=html,
            text=f"Verify your email: {verify_url}",
        )

    if db is not None:
        await _do(db)
    else:
        async with AsyncSessionLocal() as session:
            await _do(session)


@router.post("/send-verification")
async def send_verification(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Send (or resend) a verification email to the current user."""
    if current_user.email_verified:
        return {"message": "Email already verified"}
    await _send_verification_email(current_user.id, current_user.email, current_user.name, db)
    return {"message": "Verification email sent"}


@router.get("/verify-email")
async def verify_email(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """Verify an email address via token."""
    result = await db.execute(
        select(EmailVerification).where(EmailVerification.token == token)
    )
    verification = result.scalar_one_or_none()
    if not verification:
        raise HTTPException(400, "Invalid verification token")
    if verification.used_at:
        raise HTTPException(400, "Verification token already used")
    if verification.expires_at < datetime.now(timezone.utc):
        raise HTTPException(400, "Verification token expired")

    verification.used_at = datetime.utcnow()
    user_result = await db.execute(select(User).where(User.id == verification.user_id))
    user = user_result.scalar_one_or_none()
    if user:
        user.email_verified = True
    await db.commit()
    return {"message": "Email verified successfully"}


# ── Password reset ─────────────────────────────────────────────────────────────

class ForgotPasswordBody(BaseModel):
    email: str


class ResetPasswordBody(BaseModel):
    token: str
    new_password: str


@router.post("/forgot-password")
async def forgot_password(
    body: ForgotPasswordBody,
    db: AsyncSession = Depends(get_db),
):
    """Request a password reset email. Always returns 200 to prevent user enumeration."""
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if user and user.is_active:
        token = secrets.token_urlsafe(32)
        expires = datetime.now(timezone.utc) + timedelta(hours=1)
        reset_token = PasswordResetToken(
            id=str(uuid.uuid4()),
            user_id=user.id,
            token=token,
            expires_at=expires,
        )
        db.add(reset_token)
        try:
            await db.commit()
        except Exception:
            await db.rollback()
            return {"message": "If that email is registered, a reset link has been sent."}

        app_url = settings.base_url or "http://localhost:3000"
        reset_url = f"{app_url}/reset-password?token={token}"
        html = f"""
        <p>Hi {user.name},</p>
        <p>We received a request to reset your password. Click the link below to choose a new one:</p>
        <p><a href="{reset_url}">{reset_url}</a></p>
        <p>This link expires in 1 hour.</p>
        <p>If you did not request a password reset, you can safely ignore this email.</p>
        """
        await send_email(
            to=user.email,
            subject="Reset your Grant Engine password",
            html=html,
            text=f"Reset your password: {reset_url}",
        )

    return {"message": "If that email is registered, a reset link has been sent."}


@router.post("/reset-password")
async def reset_password(
    body: ResetPasswordBody,
    db: AsyncSession = Depends(get_db),
):
    """Reset a user's password using a valid reset token."""
    invalid_exc = HTTPException(400, "Invalid or expired reset token")

    result = await db.execute(
        select(PasswordResetToken).where(PasswordResetToken.token == body.token)
    )
    reset_token = result.scalar_one_or_none()
    if not reset_token:
        raise invalid_exc
    if reset_token.used_at:
        raise invalid_exc
    if reset_token.expires_at < datetime.now(timezone.utc):
        raise invalid_exc

    user_result = await db.execute(select(User).where(User.id == reset_token.user_id))
    user = user_result.scalar_one_or_none()
    if not user or not user.is_active:
        raise invalid_exc

    user.hashed_password = get_password_hash(body.new_password)
    reset_token.used_at = datetime.now(timezone.utc)
    await db.commit()
    return {"message": "Password reset successfully"}


# ── Google OAuth ───────────────────────────────────────────────────────────────

@router.get("/google")
async def google_oauth_start(current_user: User = Depends(get_current_user)):
    """Redirect URL for starting Google OAuth flow."""
    from urllib.parse import urlencode

    if not settings.google_client_id:
        raise HTTPException(400, "Google OAuth not configured")
    redirect_uri = f"{settings.api_url}/api/v1/auth/google/callback"
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/documents",
        "access_type": "offline",
        "prompt": "consent",
        "state": str(current_user.id),
    }
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)
    return {"authorization_url": url}


@router.get("/google/callback")
async def google_oauth_callback(
    code: str,
    state: str,
    db: AsyncSession = Depends(get_db),
):
    """Handle Google OAuth callback and store tokens."""
    import httpx
    if not settings.google_client_id or not settings.google_client_secret:
        raise HTTPException(400, "Google OAuth not configured")

    redirect_uri = f"{settings.api_url}/api/v1/auth/google/callback"
    token_url = "https://oauth2.googleapis.com/token"
    async with httpx.AsyncClient() as client:
        resp = await client.post(token_url, data={
            "code": code,
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        })
        resp.raise_for_status()
        token_data = resp.json()

    user_result = await db.execute(select(User).where(User.id == state))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")

    user.google_access_token = token_data.get("access_token")
    user.google_refresh_token = token_data.get("refresh_token")
    if token_data.get("expires_in"):
        user.google_token_expiry = datetime.utcnow() + timedelta(seconds=token_data["expires_in"])

    await db.commit()
    # Redirect user back to settings
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url=f"{settings.base_url}/settings?google_connected=true")


@router.post("/google/disconnect")
async def google_disconnect(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Disconnect Google account."""
    current_user.google_access_token = None
    current_user.google_refresh_token = None
    current_user.google_token_expiry = None
    await db.commit()
    return {"message": "Google account disconnected"}

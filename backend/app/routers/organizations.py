"""Organization management endpoints — create, invite, join-request, access-code, members."""
from __future__ import annotations

import secrets
import string
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.institution import Institution
from app.models.org_join_request import OrgJoinRequest, JoinRequestStatus
from app.models.user import User, UserRole, InstitutionRole
from app.routers.auth import get_current_user, create_access_token
from app.auth.permissions import require_org_admin, is_org_admin, invalidate_permission_cache, get_redis
import redis.asyncio as aioredis

router = APIRouter()
settings = get_settings()

_ACCESS_CODE_CHARS = string.ascii_uppercase + string.digits
_ACCESS_CODE_LEN = 6
_ACCESS_CODE_TTL_HOURS = 72


# ── Request / response models ─────────────────────────────────────────────────

class OrgCreate(BaseModel):
    name: str
    domain: Optional[str] = None


class OrgJoinByCode(BaseModel):
    code: str


class JoinRequestCreate(BaseModel):
    institution_id: str
    message: Optional[str] = None


class MemberRoleUpdate(BaseModel):
    role: str  # UserRole enum value


class OrgInviteRequest(BaseModel):
    email: str
    role: str = UserRole.CONTRIBUTOR


# ── Helpers ───────────────────────────────────────────────────────────────────

def _generate_access_code() -> str:
    return "".join(secrets.choice(_ACCESS_CODE_CHARS) for _ in range(_ACCESS_CODE_LEN))


async def _get_institution_or_404(institution_id: str, db: AsyncSession) -> Institution:
    inst = (await db.execute(select(Institution).where(Institution.id == institution_id))).scalar_one_or_none()
    if not inst:
        raise HTTPException(404, "Organization not found")
    return inst


async def _require_same_institution(current_user: User, institution_id: str) -> None:
    if not is_org_admin(current_user) and current_user.institution_id != institution_id:
        raise HTTPException(403, "You do not belong to this organization.")


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/")
async def list_organizations(
    q: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Public list of organizations (for registration join-by-search flow)."""
    query = select(Institution)
    if q:
        query = query.where(Institution.name.ilike(f"%{q}%"))
    result = await db.execute(query.limit(30))
    insts = result.scalars().all()
    return [{"id": i.id, "name": i.name, "domain": i.domain} for i in insts]


@router.post("/", status_code=201)
async def create_organization(
    body: OrgCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    redis: aioredis.Redis = Depends(get_redis),
):
    """Create a new organization. The caller becomes org_admin."""
    if current_user.institution_id:
        raise HTTPException(400, "You already belong to an organization. Leave it before creating a new one.")

    inst = Institution(
        id=str(uuid.uuid4()),
        name=body.name.strip(),
        domain=body.domain,
    )
    db.add(inst)
    await db.flush()

    current_user.institution_id = inst.id
    current_user.institution_role = InstitutionRole.ADMIN
    current_user.role = UserRole.GRANT_LEAD
    await db.commit()
    await invalidate_permission_cache(current_user.id, redis)

    # Trigger scaffold background task
    try:
        from app.workers.celery_app import celery_app
        celery_app.send_task(
            "app.workers.org_tasks.scaffold_new_organization",
            args=[inst.id, current_user.id],
        )
    except Exception:
        pass

    return {"id": inst.id, "name": inst.name}


@router.get("/{institution_id}")
async def get_organization(
    institution_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    inst = await _get_institution_or_404(institution_id, db)
    return {"id": inst.id, "name": inst.name, "domain": inst.domain}


@router.get("/{institution_id}/members")
async def list_members(
    institution_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all members of the organization. Requires org membership (admin sees all)."""
    await _require_same_institution(current_user, institution_id)
    result = await db.execute(
        select(User).where(User.institution_id == institution_id, User.is_active == True)
    )
    users = result.scalars().all()
    return [
        {
            "id": u.id,
            "name": u.name,
            "email": u.email,
            "role": u.role,
            "institution_role": u.institution_role,
            "created_at": u.created_at.isoformat() if u.created_at else None,
        }
        for u in users
    ]


@router.patch("/{institution_id}/members/{user_id}", dependencies=[Depends(require_org_admin())])
async def update_member_role(
    institution_id: str,
    user_id: str,
    body: MemberRoleUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    redis: aioredis.Redis = Depends(get_redis),
):
    """Change a member's org role. Requires org_admin."""
    result = await db.execute(
        select(User).where(User.id == user_id, User.institution_id == institution_id)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "Member not found in this organization.")

    try:
        user.role = UserRole(body.role)
    except ValueError:
        raise HTTPException(400, f"Invalid role: {body.role}")

    await db.commit()
    await invalidate_permission_cache(user_id, redis)
    return {"id": user.id, "role": user.role}


@router.delete("/{institution_id}/members/{user_id}", status_code=204, dependencies=[Depends(require_org_admin())])
async def remove_member(
    institution_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    redis: aioredis.Redis = Depends(get_redis),
):
    """Remove a member from the organization. Requires org_admin."""
    if user_id == current_user.id:
        raise HTTPException(400, "You cannot remove yourself from the organization.")
    result = await db.execute(
        select(User).where(User.id == user_id, User.institution_id == institution_id)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "Member not found.")
    user.institution_id = None
    user.institution_role = InstitutionRole.MEMBER
    await db.commit()
    await invalidate_permission_cache(user_id, redis)


# ── Join requests ─────────────────────────────────────────────────────────────

@router.post("/{institution_id}/join-requests", status_code=201)
async def request_to_join(
    institution_id: str,
    body: JoinRequestCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Submit a join request for an organization."""
    if current_user.institution_id == institution_id:
        raise HTTPException(400, "You are already a member of this organization.")

    await _get_institution_or_404(institution_id, db)

    # Check for existing pending request
    existing = (await db.execute(
        select(OrgJoinRequest).where(
            OrgJoinRequest.institution_id == institution_id,
            OrgJoinRequest.user_id == current_user.id,
            OrgJoinRequest.status == JoinRequestStatus.PENDING,
        )
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(400, "You already have a pending join request for this organization.")

    req = OrgJoinRequest(
        id=str(uuid.uuid4()),
        institution_id=institution_id,
        user_id=current_user.id,
        email=current_user.email,
        name=current_user.name,
        message=body.message,
        status=JoinRequestStatus.PENDING,
    )
    db.add(req)
    await db.commit()
    return {"id": req.id, "status": req.status}


@router.get("/{institution_id}/join-requests", dependencies=[Depends(require_org_admin())])
async def list_join_requests(
    institution_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List pending join requests. Requires org_admin."""
    result = await db.execute(
        select(OrgJoinRequest)
        .where(OrgJoinRequest.institution_id == institution_id)
        .order_by(OrgJoinRequest.created_at.desc())
    )
    requests = result.scalars().all()
    return [
        {
            "id": r.id,
            "user_id": r.user_id,
            "email": r.email,
            "name": r.name,
            "message": r.message,
            "status": r.status,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in requests
    ]


@router.post(
    "/{institution_id}/join-requests/{request_id}/approve",
    dependencies=[Depends(require_org_admin())],
)
async def approve_join_request(
    institution_id: str,
    request_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    redis: aioredis.Redis = Depends(get_redis),
):
    """Approve a join request, adding the user to the organization."""
    req = (await db.execute(
        select(OrgJoinRequest).where(
            OrgJoinRequest.id == request_id,
            OrgJoinRequest.institution_id == institution_id,
        )
    )).scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Join request not found.")
    if req.status != JoinRequestStatus.PENDING:
        raise HTTPException(400, f"Request is already {req.status}.")

    req.status = JoinRequestStatus.APPROVED
    req.reviewed_by_id = current_user.id
    req.reviewed_at = datetime.utcnow()

    if req.user_id:
        user = (await db.execute(select(User).where(User.id == req.user_id))).scalar_one_or_none()
        if user:
            user.institution_id = institution_id
            user.institution_role = InstitutionRole.MEMBER
            await db.commit()
            await invalidate_permission_cache(req.user_id, redis)
            return {"status": "approved", "user_id": req.user_id}

    await db.commit()
    return {"status": "approved", "message": "User account not found — they may need to register."}


@router.post(
    "/{institution_id}/join-requests/{request_id}/reject",
    dependencies=[Depends(require_org_admin())],
)
async def reject_join_request(
    institution_id: str,
    request_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Reject a join request."""
    req = (await db.execute(
        select(OrgJoinRequest).where(
            OrgJoinRequest.id == request_id,
            OrgJoinRequest.institution_id == institution_id,
        )
    )).scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Join request not found.")
    if req.status != JoinRequestStatus.PENDING:
        raise HTTPException(400, f"Request is already {req.status}.")

    req.status = JoinRequestStatus.REJECTED
    req.reviewed_by_id = current_user.id
    req.reviewed_at = datetime.utcnow()
    await db.commit()
    return {"status": "rejected"}


# ── Access code ───────────────────────────────────────────────────────────────

@router.post("/{institution_id}/access-code/generate", dependencies=[Depends(require_org_admin())])
async def generate_access_code(
    institution_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate a 6-character access code for quick joins. Valid for 72 hours."""
    inst = await _get_institution_or_404(institution_id, db)
    code = _generate_access_code()
    inst.access_code = code
    inst.access_code_expires_at = datetime.utcnow() + timedelta(hours=_ACCESS_CODE_TTL_HOURS)
    await db.commit()
    return {
        "code": code,
        "expires_at": inst.access_code_expires_at.isoformat(),
    }


@router.post("/join-by-code", status_code=200)
async def join_by_access_code(
    body: OrgJoinByCode,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    redis: aioredis.Redis = Depends(get_redis),
):
    """Join an organization immediately using a valid access code."""
    code = body.code.strip().upper()
    inst = (await db.execute(
        select(Institution).where(
            Institution.access_code == code,
            Institution.access_code_expires_at > datetime.utcnow(),
        )
    )).scalar_one_or_none()

    if not inst:
        raise HTTPException(400, "Invalid or expired access code.")

    if current_user.institution_id == inst.id:
        raise HTTPException(400, "You are already a member of this organization.")

    current_user.institution_id = inst.id
    current_user.institution_role = InstitutionRole.MEMBER
    if not current_user.role or current_user.role == UserRole.VIEWER:
        current_user.role = UserRole.CONTRIBUTOR

    await db.commit()
    await invalidate_permission_cache(current_user.id, redis)
    return {
        "institution_id": inst.id,
        "institution_name": inst.name,
        "message": f"You have joined {inst.name}.",
    }


# ── Email invite ──────────────────────────────────────────────────────────────

@router.post("/{institution_id}/invite", dependencies=[Depends(require_org_admin())])
async def invite_member_by_email(
    institution_id: str,
    body: OrgInviteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Send an email invite link. The token links to /invite/[token] on the frontend."""
    inst = await _get_institution_or_404(institution_id, db)

    # Build a short-lived JWT invite token
    token = create_access_token({
        "sub": "invite",
        "institution_id": institution_id,
        "email": body.email,
        "role": body.role,
        "invited_by": current_user.id,
    })

    # Store the token in Redis with TTL so it can be validated
    redis_client = await get_redis()
    await redis_client.setex(f"invite_token:{token[:32]}", 48 * 3600, token)

    # Send invite email via Resend
    frontend_url = getattr(settings, "frontend_url", "http://localhost:3000")
    invite_url = f"{frontend_url}/invite/{token}"

    try:
        from app.services.email import send_email
        await send_email(
            to=body.email,
            subject=f"You're invited to join {inst.name} on LiGHT Grant Engine",
            html=f"""
            <p>You've been invited to join <strong>{inst.name}</strong> on LiGHT Grant Engine.</p>
            <p><a href="{invite_url}">Click here to accept the invitation</a></p>
            <p>This link expires in 48 hours.</p>
            """,
        )
    except Exception:
        pass

    return {"message": f"Invite sent to {body.email}", "invite_url": invite_url}

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
from app.services.organization_setup import queue_org_scaffold
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
    institution_role: Optional[str] = None  # "admin" | "member" — if provided, promotes/demotes
    module_permissions: Optional[dict] = None  # e.g. {"can_view_grants": true}


class OrgInviteRequest(BaseModel):
    email: str
    role: str = UserRole.CONTRIBUTOR
    institution_role: str = "member"  # "admin" | "member"
    module_permissions: dict = {}  # e.g. {"can_view_grants": true, "can_view_archive": true}


class GrantProfileUpdate(BaseModel):
    institution_name: Optional[str] = None
    keywords: Optional[list[str]] = None
    geographies: Optional[list[str]] = None
    projects: Optional[str] = None
    excluded_keywords: Optional[list[str]] = None
    auto_queue_threshold: Optional[int] = None


class OrgSourceCreate(BaseModel):
    name: str
    url: Optional[str] = None
    source_type: str = "ai_scraper"
    category: Optional[str] = None
    refresh_frequency: str = "weekly"
    is_high_priority: bool = False
    scraper_config: dict = {}


class OrgSourceToggle(BaseModel):
    is_enabled: bool


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
    query = select(Institution).where(Institution.is_personal.is_(False))
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
        is_personal=False,
    )
    db.add(inst)
    await db.flush()

    current_user.institution_id = inst.id
    current_user.institution_role = InstitutionRole.ADMIN
    current_user.role = UserRole.GRANT_LEAD
    await db.commit()
    await invalidate_permission_cache(current_user.id, redis)

    # Trigger scaffold background task
    queue_org_scaffold(inst.id, current_user.id)

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
            "module_permissions": u.module_permissions or {},
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
    """Change a member's role, institution_role, and/or module_permissions. Requires org_admin."""
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

    if body.institution_role is not None:
        if body.institution_role not in ("admin", "member"):
            raise HTTPException(400, "institution_role must be 'admin' or 'member'.")
        # Prevent the current user from demoting themselves
        if user_id == current_user.id and body.institution_role != "admin":
            raise HTTPException(400, "You cannot remove your own admin privileges.")
        user.institution_role = body.institution_role

    if body.module_permissions is not None:
        user.module_permissions = body.module_permissions

    await db.commit()
    await invalidate_permission_cache(user_id, redis)
    return {
        "id": user.id,
        "role": user.role,
        "institution_role": user.institution_role,
        "module_permissions": user.module_permissions,
    }


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


# ── Member grant access (org-admin) ───────────────────────────────────────────

@router.get("/{institution_id}/grants", dependencies=[Depends(require_org_admin())])
async def list_org_grants_for_admin(
    institution_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return all non-personal org grants for the admin member-access panel."""
    from app.models.active_grant import ActiveGrant
    result = await db.execute(
        select(ActiveGrant).where(
            ActiveGrant.institution_id == institution_id,
            ActiveGrant.is_personal.is_(False),
        )
    )
    grants = result.scalars().all()
    return [
        {
            "id": g.id,
            "title": g.title,
            "funder": g.funder,
            "grant_stage": g.grant_stage,
            "status": g.status,
        }
        for g in grants
    ]


class GrantMembershipUpdate(BaseModel):
    grant_ids: list[str]


@router.get("/{institution_id}/members/{user_id}/grant-memberships", dependencies=[Depends(require_org_admin())])
async def get_member_grant_memberships(
    institution_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the grant IDs this org member has accepted GrantMember access to."""
    from app.models.grant_member import GrantMember, GrantMemberStatus
    from app.models.active_grant import ActiveGrant

    # Only return memberships for grants belonging to this institution
    subq = select(ActiveGrant.id).where(
        ActiveGrant.institution_id == institution_id,
        ActiveGrant.is_personal.is_(False),
    )
    result = await db.execute(
        select(GrantMember).where(
            GrantMember.user_id == user_id,
            GrantMember.status == GrantMemberStatus.ACCEPTED,
            GrantMember.grant_id.in_(subq),
        )
    )
    members = result.scalars().all()
    return {
        "grant_ids": [m.grant_id for m in members],
        "owner_grant_ids": [
            m.grant_id for m in members
            if m.role == "owner"
        ],
    }


@router.put("/{institution_id}/members/{user_id}/grant-memberships", dependencies=[Depends(require_org_admin())])
async def set_member_grant_memberships(
    institution_id: str,
    user_id: str,
    body: GrantMembershipUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    redis: aioredis.Redis = Depends(get_redis),
):
    """Set the exact list of grants a member can access. Org-admin only.

    Adds EDITOR/ACCEPTED GrantMember rows for new grants, removes rows for
    de-selected grants (OWNER rows are never removed).
    """
    from app.models.grant_member import GrantMember, GrantMemberRole, GrantMemberStatus
    from app.models.active_grant import ActiveGrant
    from sqlalchemy import delete as sa_delete

    # Verify the user is in this institution
    target = (await db.execute(
        select(User).where(User.id == user_id, User.institution_id == institution_id)
    )).scalar_one_or_none()
    if not target:
        raise HTTPException(404, "Member not found in this organization.")

    # Limit to grants that actually belong to this institution
    org_grant_ids_result = await db.execute(
        select(ActiveGrant.id).where(
            ActiveGrant.institution_id == institution_id,
            ActiveGrant.is_personal.is_(False),
        )
    )
    valid_org_grant_ids = set(org_grant_ids_result.scalars().all())
    requested_ids = set(body.grant_ids) & valid_org_grant_ids

    # Fetch current memberships (all statuses) for this user in these org grants
    existing_result = await db.execute(
        select(GrantMember).where(
            GrantMember.user_id == user_id,
            GrantMember.grant_id.in_(valid_org_grant_ids),
        )
    )
    existing = existing_result.scalars().all()
    existing_by_grant: dict[str, GrantMember] = {m.grant_id: m for m in existing}

    # Add new memberships
    for grant_id in requested_ids:
        if grant_id not in existing_by_grant:
            db.add(GrantMember(
                id=str(uuid.uuid4()),
                grant_id=grant_id,
                user_id=user_id,
                email=target.email,
                role=GrantMemberRole.EDITOR,
                status=GrantMemberStatus.ACCEPTED,
                invited_by_id=current_user.id,
            ))
        elif existing_by_grant[grant_id].status != GrantMemberStatus.ACCEPTED:
            # Re-activate a previously pending/removed row
            existing_by_grant[grant_id].status = GrantMemberStatus.ACCEPTED

    # Remove memberships for de-selected grants (never remove OWNER rows)
    for grant_id, member in existing_by_grant.items():
        if grant_id not in requested_ids and member.role != GrantMemberRole.OWNER:
            await db.delete(member)

    await db.commit()
    await invalidate_permission_cache(user_id, redis)
    return {"grant_ids": list(requested_ids)}


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
            user.role = UserRole.CONTRIBUTOR
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
        "institution_role": body.institution_role,
        "module_permissions": body.module_permissions,
        "invited_by": current_user.id,
    })

    # Store the token in Redis with TTL so it can be validated
    redis_client = await get_redis()
    await redis_client.setex(f"invite_token:{token[:32]}", 48 * 3600, token)

    frontend_url = settings.base_url or "http://localhost:3000"
    invite_url = f"{frontend_url}/invite/{token}"

    import asyncio
    from app.services.email import send_email
    asyncio.create_task(send_email(
        to=body.email,
        subject=f"You're invited to join {inst.name} on LiGHT Grant Engine",
        html=f"""
        <p>You've been invited to join <strong>{inst.name}</strong> on LiGHT Grant Engine.</p>
        <p><a href="{invite_url}">Click here to accept the invitation</a></p>
        <p>This link expires in 48 hours.</p>
        """,
    ))

    return {"message": f"Invite sent to {body.email}", "invite_url": invite_url}


# ── Grant profile (org admin) ─────────────────────────────────────────────────

@router.get("/{institution_id}/grant-profile")
async def get_grant_profile(
    institution_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _require_same_institution(current_user, institution_id)
    inst = await _get_institution_or_404(institution_id, db)
    return inst.grant_profile or {}


@router.patch("/{institution_id}/grant-profile", dependencies=[Depends(require_org_admin())])
async def update_grant_profile(
    institution_id: str,
    body: GrantProfileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    inst = await _get_institution_or_404(institution_id, db)
    profile = dict(inst.grant_profile or {})
    for k, v in body.model_dump(exclude_none=True).items():
        profile[k] = v
    inst.grant_profile = profile
    await db.commit()
    try:
        from app.workers.celery_app import celery_app
        celery_app.send_task("app.workers.surfacing_tasks.rescore_institution", args=[institution_id])
    except Exception:
        pass
    return profile


@router.post("/{institution_id}/llm-rank", dependencies=[Depends(require_org_admin())])
async def trigger_llm_rank(
    institution_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Queue an LLM-powered rescore of all surfaced opportunities for this org."""
    inst = await _get_institution_or_404(institution_id, db)
    profile = inst.grant_profile or {}
    if not profile.get("keywords"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Set organization keywords before running custom ranking.",
        )
    try:
        from app.workers.celery_app import celery_app as _celery
        _celery.send_task(
            "app.workers.surfacing_tasks.llm_rescore_institution",
            args=[institution_id],
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Background worker unavailable. Ensure Celery is running.",
        )
    return {"message": "Custom AI ranking queued. Scores will update within a few minutes."}


@router.get("/{institution_id}/preseed-status")
async def preseed_status(
    institution_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _require_same_institution(current_user, institution_id)
    from app.models.preseed_run import PreseedRun
    from sqlalchemy import desc as sa_desc
    result = await db.execute(
        select(PreseedRun)
        .where(PreseedRun.institution_id == institution_id)
        .order_by(sa_desc(PreseedRun.started_at))
        .limit(1)
    )
    run = result.scalar_one_or_none()
    if not run:
        return {"status": "none"}
    return {
        "status": run.status,
        "opportunities_total": run.opportunities_total,
        "opportunities_scored": run.opportunities_scored,
        "log_summary": run.log_summary,
    }


# ── Org source subscriptions ──────────────────────────────────────────────────

@router.get("/{institution_id}/sources")
async def list_org_sources(
    institution_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List global sources with this org's enabled/disabled state."""
    await _require_same_institution(current_user, institution_id)
    from app.models.source import Source
    from app.models.institution_source import InstitutionSource

    sources = (await db.execute(select(Source).order_by(Source.name))).scalars().all()
    sub_rows = (await db.execute(
        select(InstitutionSource).where(InstitutionSource.institution_id == institution_id)
    )).scalars().all()
    sub_map = {s.source_id: s.is_enabled for s in sub_rows}

    return [
        {
            "id": s.id,
            "name": s.name,
            "url": s.url,
            "source_type": s.source_type,
            "category": s.category,
            "status": s.status,
            "is_high_priority": s.is_high_priority,
            "refresh_frequency": s.refresh_frequency,
            "logo_url": s.logo_url,
            "is_enabled": sub_map.get(s.id, True),
            "is_subscribed": s.id in sub_map,
        }
        for s in sources
    ]


@router.patch("/{institution_id}/sources/{source_id}")
async def toggle_org_source(
    institution_id: str,
    source_id: str,
    body: OrgSourceToggle,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Enable or disable a global source for this organization."""
    if not is_org_admin(current_user) or current_user.institution_id != institution_id:
        raise HTTPException(403, "Org admin access required.")
    from app.models.source import Source
    from app.models.institution_source import InstitutionSource

    source = (await db.execute(select(Source).where(Source.id == source_id))).scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")

    sub = (await db.execute(
        select(InstitutionSource).where(
            InstitutionSource.institution_id == institution_id,
            InstitutionSource.source_id == source_id,
        )
    )).scalar_one_or_none()

    if sub:
        sub.is_enabled = body.is_enabled
    else:
        sub = InstitutionSource(
            institution_id=institution_id,
            source_id=source_id,
            is_enabled=body.is_enabled,
        )
        db.add(sub)
    await db.commit()
    try:
        from app.workers.celery_app import celery_app
        celery_app.send_task("app.workers.surfacing_tasks.preseed_institution_grants", args=[institution_id])
    except Exception:
        pass
    return {"source_id": source_id, "is_enabled": body.is_enabled}


@router.post("/{institution_id}/onboarding/complete")
async def complete_org_onboarding(
    institution_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Save organization onboarding data and mark onboarding complete."""
    if not is_org_admin(current_user) or current_user.institution_id != institution_id:
        raise HTTPException(403, "Org admin access required.")

    inst = await _get_institution_or_404(institution_id, db)
    profile = dict(inst.grant_profile or {})

    # Merge onboarding fields into grant_profile
    for key in ["keywords", "domains", "methods", "populations", "funders",
                "geographies", "strategic_priorities", "description"]:
        if key in body:
            profile[key] = body[key]

    inst.grant_profile = profile
    inst.onboarding_complete = True
    await db.commit()
    return {"onboarding_complete": True, "grant_profile": inst.grant_profile}


@router.post("/{institution_id}/onboarding/ai-augment")
async def ai_augment_org_profile(
    institution_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Use AI to improve and expand the organization's research profile keywords."""
    if not is_org_admin(current_user) or current_user.institution_id != institution_id:
        raise HTTPException(403, "Org admin access required.")

    from app.ai.agents.profile_augmenter import augment_profile
    raw_interests = body.get("raw_interests", "")
    org_name = body.get("org_name", "")
    org_description = body.get("description", "")

    result = await augment_profile(
        raw_interests=raw_interests,
        org_name=org_name,
        description=org_description,
    )
    return result


@router.post("/{institution_id}/sources", status_code=201)
async def add_org_source(
    institution_id: str,
    body: OrgSourceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Add a new source to the global catalog and enable it for this org."""
    if not is_org_admin(current_user) or current_user.institution_id != institution_id:
        raise HTTPException(403, "Org admin access required.")
    from app.models.source import Source
    from app.models.institution_source import InstitutionSource

    source = Source(
        id=str(uuid.uuid4()),
        owner_id=current_user.id,
        status="active",
        **body.model_dump(),
    )
    db.add(source)
    await db.flush()
    db.add(InstitutionSource(
        institution_id=institution_id,
        source_id=source.id,
        is_enabled=True,
    ))
    await db.commit()

    try:
        from app.workers.celery_app import celery_app
        celery_app.send_task("app.workers.surfacing_tasks.fan_out_sources_to_all")
    except Exception:
        pass
    return {"id": source.id, "name": source.name, "is_enabled": True}

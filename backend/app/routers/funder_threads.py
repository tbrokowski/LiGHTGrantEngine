"""Open threads on the Funders tab: team conversations with funders assigned.

Mounted at /api/v1/funders/threads. Everything is scoped to the user's
active organization and needs the Funders tab switched on for it.
"""
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import is_org_admin
from app.database import get_db
from app.models.funder_thread import FunderThread, FunderThreadPartner, FunderThreadPost
from app.models.partner import Partner
from app.models.user import User
from app.routers.auth import get_current_user
from app.routers.funders import _funders_org
from app.routers.partners import partner_org_filter

router = APIRouter()

TITLE_MAX = 300
POST_MAX = 10_000


def _clean(v: Optional[str], limit: int, what: str) -> Optional[str]:
    if v is None:
        return None
    v = v.strip()
    if not v:
        raise ValueError(f"{what} can't be empty.")
    if len(v) > limit:
        raise ValueError(f"{what} is too long (max {limit} characters).")
    return v


class ThreadCreate(BaseModel):
    title: str
    content: Optional[str] = None
    partner_ids: list[str] = []

    @field_validator("title")
    @classmethod
    def _title(cls, v: str) -> str:
        return _clean(v, TITLE_MAX, "Title")  # type: ignore[return-value]

    @field_validator("content")
    @classmethod
    def _content(cls, v: Optional[str]) -> Optional[str]:
        # An opening message is optional; blank means none.
        return _clean(v, POST_MAX, "Message") if v and v.strip() else None


class ThreadPatch(BaseModel):
    title: Optional[str] = None
    status: Optional[Literal["open", "closed"]] = None

    @field_validator("title")
    @classmethod
    def _title(cls, v: Optional[str]) -> Optional[str]:
        return _clean(v, TITLE_MAX, "Title")


class PostIn(BaseModel):
    content: str

    @field_validator("content")
    @classmethod
    def _content(cls, v: str) -> str:
        return _clean(v, POST_MAX, "Message")  # type: ignore[return-value]


class AssignIn(BaseModel):
    partner_id: str


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(d: Optional[datetime]) -> Optional[str]:
    return d.isoformat() if d else None


async def _thread(db: AsyncSession, user: User, thread_id: str) -> FunderThread:
    await _funders_org(db, user)
    t = (await db.execute(
        select(FunderThread).where(FunderThread.id == thread_id, FunderThread.institution_id == user.institution_id)
    )).scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Thread not found")
    return t


async def _check_funders(db: AsyncSession, user: User, ids: list[str]) -> list[str]:
    """The ids, deduplicated, after checking each is a funder in this organization."""
    ids = list(dict.fromkeys(ids))
    if not ids:
        return []
    found = set((await db.execute(
        select(Partner.id).where(Partner.id.in_(ids), partner_org_filter(user), Partner.funder_tier.isnot(None))
    )).scalars().all())
    if missing := [i for i in ids if i not in found]:
        raise HTTPException(404, f"Funder not found: {missing[0]}")
    return ids


async def _user_names(db: AsyncSession, ids: set[str]) -> dict[str, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return dict((await db.execute(select(User.id, User.name).where(User.id.in_(ids)))).all())


async def _thread_dicts(db: AsyncSession, threads: list[FunderThread]) -> list[dict]:
    if not threads:
        return []
    ids = [t.id for t in threads]

    funders: dict[str, list[dict]] = {i: [] for i in ids}
    for thread_id, pid, name, tier in (await db.execute(
        select(FunderThreadPartner.thread_id, Partner.id, Partner.name, Partner.funder_tier)
        .join(Partner, Partner.id == FunderThreadPartner.partner_id)
        .where(FunderThreadPartner.thread_id.in_(ids))
        .order_by(FunderThreadPartner.created_at)
    )).all():
        funders[thread_id].append({"id": pid, "name": name, "funder_tier": tier})

    counts = dict((await db.execute(
        select(FunderThreadPost.thread_id, func.count(FunderThreadPost.id))
        .where(FunderThreadPost.thread_id.in_(ids))
        .group_by(FunderThreadPost.thread_id)
    )).all())

    latest = (
        select(FunderThreadPost.thread_id, func.max(FunderThreadPost.created_at).label("at"))
        .where(FunderThreadPost.thread_id.in_(ids))
        .group_by(FunderThreadPost.thread_id)
        .subquery()
    )
    last_posts = {
        p.thread_id: p for p in (await db.execute(
            select(FunderThreadPost).join(
                latest, (FunderThreadPost.thread_id == latest.c.thread_id) & (FunderThreadPost.created_at == latest.c.at)
            )
        )).scalars().all()
    }

    names = await _user_names(db, {t.created_by for t in threads} | {p.user_id for p in last_posts.values()})
    out = []
    for t in threads:
        last = last_posts.get(t.id)
        out.append({
            "id": t.id,
            "title": t.title,
            "status": t.status,
            "created_by": t.created_by,
            "created_by_name": names.get(t.created_by or ""),
            "created_at": _iso(t.created_at),
            "last_activity_at": _iso(t.last_activity_at),
            "funders": funders[t.id],
            "post_count": counts.get(t.id, 0),
            "last_post": {
                "content": last.content,
                "user_name": names.get(last.user_id or ""),
                "created_at": _iso(last.created_at),
            } if last else None,
        })
    return out


async def _detail(db: AsyncSession, t: FunderThread) -> dict:
    d = (await _thread_dicts(db, [t]))[0]
    posts = (await db.execute(
        select(FunderThreadPost).where(FunderThreadPost.thread_id == t.id).order_by(FunderThreadPost.created_at)
    )).scalars().all()
    names = await _user_names(db, {p.user_id for p in posts})
    d["posts"] = [
        {"id": p.id, "user_id": p.user_id, "user_name": names.get(p.user_id or ""), "content": p.content, "created_at": _iso(p.created_at)}
        for p in posts
    ]
    return d


@router.get("/")
async def list_threads(
    status: Literal["open", "closed"] = "open",
    partner_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Threads in this organization, most recently active first, with how many
    are open and closed. `partner_id` narrows to threads that funder is on."""
    await _funders_org(db, current_user)
    scope = FunderThread.institution_id == current_user.institution_id
    q = select(FunderThread).where(scope, FunderThread.status == status)
    if partner_id:
        q = q.where(FunderThread.id.in_(
            select(FunderThreadPartner.thread_id).where(FunderThreadPartner.partner_id == partner_id)
        ))
    threads = (await db.execute(q.order_by(FunderThread.last_activity_at.desc()).limit(200))).scalars().all()
    counts = dict((await db.execute(
        select(FunderThread.status, func.count(FunderThread.id)).where(scope).group_by(FunderThread.status)
    )).all())
    return {
        "threads": await _thread_dicts(db, list(threads)),
        "counts": {"open": counts.get("open", 0), "closed": counts.get("closed", 0)},
    }


@router.post("/", status_code=201)
async def create_thread(data: ThreadCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await _funders_org(db, current_user)
    partner_ids = await _check_funders(db, current_user, data.partner_ids)
    t = FunderThread(institution_id=current_user.institution_id, title=data.title, created_by=current_user.id, last_activity_at=_now())
    db.add(t)
    await db.flush()
    for pid in partner_ids:
        db.add(FunderThreadPartner(thread_id=t.id, partner_id=pid, added_by=current_user.id))
    if data.content:
        db.add(FunderThreadPost(thread_id=t.id, user_id=current_user.id, content=data.content))
    await db.commit()
    await db.refresh(t)
    return await _detail(db, t)


@router.get("/{thread_id}")
async def get_thread(thread_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    return await _detail(db, await _thread(db, current_user, thread_id))


@router.patch("/{thread_id}")
async def update_thread(thread_id: str, data: ThreadPatch, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Rename, close or reopen a thread."""
    t = await _thread(db, current_user, thread_id)
    if data.title is not None:
        t.title = data.title
    if data.status is not None:
        t.status = data.status
    await db.commit()
    return await _detail(db, t)


@router.delete("/{thread_id}", status_code=204)
async def delete_thread(thread_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Whoever started a thread (or an org admin) can delete it."""
    t = await _thread(db, current_user, thread_id)
    if t.created_by != current_user.id and not is_org_admin(current_user):
        raise HTTPException(403, "Only whoever started this thread, or an admin, can delete it.")
    await db.delete(t)
    await db.commit()


@router.post("/{thread_id}/posts", status_code=201)
async def add_post(thread_id: str, data: PostIn, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Reply in a thread. Replying to a closed thread reopens it."""
    t = await _thread(db, current_user, thread_id)
    db.add(FunderThreadPost(thread_id=t.id, user_id=current_user.id, content=data.content))
    t.last_activity_at = _now()
    t.status = "open"
    await db.commit()
    return await _detail(db, t)


@router.delete("/{thread_id}/posts/{post_id}", status_code=204)
async def delete_post(thread_id: str, post_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    t = await _thread(db, current_user, thread_id)
    p = (await db.execute(
        select(FunderThreadPost).where(FunderThreadPost.id == post_id, FunderThreadPost.thread_id == t.id)
    )).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Message not found")
    if p.user_id != current_user.id:
        raise HTTPException(403, "You can only delete your own messages.")
    await db.delete(p)
    await db.commit()


@router.post("/{thread_id}/funders", status_code=201)
async def assign_funder(thread_id: str, data: AssignIn, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    t = await _thread(db, current_user, thread_id)
    await _check_funders(db, current_user, [data.partner_id])
    exists = (await db.execute(
        select(FunderThreadPartner.id).where(FunderThreadPartner.thread_id == t.id, FunderThreadPartner.partner_id == data.partner_id)
    )).scalar_one_or_none()
    if not exists:
        db.add(FunderThreadPartner(thread_id=t.id, partner_id=data.partner_id, added_by=current_user.id))
        t.last_activity_at = _now()
        await db.commit()
    return await _detail(db, t)


@router.delete("/{thread_id}/funders/{partner_id}")
async def unassign_funder(thread_id: str, partner_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    t = await _thread(db, current_user, thread_id)
    await db.execute(delete(FunderThreadPartner).where(FunderThreadPartner.thread_id == t.id, FunderThreadPartner.partner_id == partner_id))
    await db.commit()
    return await _detail(db, t)

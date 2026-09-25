"""Partner groups — named sets of partners (a site, a consortium, a project),
their members, their tasks and their engagement."""
import uuid
from datetime import datetime, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func, delete as sa_delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import has_module_permission
from app.database import get_db
from app.models.partner import Partner, PartnerUpdate
from app.models.partner_group import PartnerGroup, PartnerGroupMember, GROUP_COLORS
from app.models.partner_task import PartnerTask
from app.models.user import User
from app.routers.auth import get_current_user
from app.routers.partner_tasks import TaskCreate, task_dicts
from app.services.partner_groups import add_members, partners_with_tags

router = APIRouter()

OPEN = ("open", "in_progress")


class GroupCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    color: Optional[str] = Field(None, max_length=20)
    partner_ids: list[str] = []
    tags: list[str] = []
    match: Literal["any", "all"] = "any"


class GroupUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    color: Optional[str] = Field(None, max_length=20)


class MembersAdd(BaseModel):
    partner_ids: list[str] = []
    tags: list[str] = []
    match: Literal["any", "all"] = "any"
    exclude_ids: list[str] = []


def _require(user: User) -> None:
    if not has_module_permission(user, "can_view_partners"):
        raise HTTPException(403, "No access to partners.")


def _scoped(stmt, user: User):
    inst = getattr(user, "institution_id", None)
    return stmt.where(PartnerGroup.institution_id == inst if inst else PartnerGroup.institution_id.is_(None))


async def _get_group(group_id: str, db: AsyncSession, user: User) -> PartnerGroup:
    g = (await db.execute(_scoped(select(PartnerGroup).where(PartnerGroup.id == group_id), user))).scalar_one_or_none()
    if not g:
        raise HTTPException(404, "Group not found")
    return g


async def _ensure_unique_name(db: AsyncSession, user: User, name: str, exclude_id: str | None = None) -> None:
    """Names are unique per institution, case-insensitively. Checked here as
    well as by the DB constraint, which can't catch it when institution_id is
    NULL (NULLs never conflict in a unique index)."""
    stmt = _scoped(select(PartnerGroup.id).where(func.lower(PartnerGroup.name) == name.strip().lower()), user)
    if exclude_id:
        stmt = stmt.where(PartnerGroup.id != exclude_id)
    if (await db.execute(stmt)).first():
        raise HTTPException(409, f"A group called “{name.strip()}” already exists.")


async def _member_ids(db: AsyncSession, group_id: str) -> list[str]:
    return list((await db.execute(
        select(PartnerGroupMember.partner_id).where(PartnerGroupMember.group_id == group_id)
    )).scalars().all())


@router.get("/")
async def list_groups(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Every group with member count, a few member names, open/overdue tasks,
    the next due task and the share of members contacted in the last 30 days."""
    _require(current_user)
    from app.services.partner_engagement import last_touch_map, now_utc

    groups = (await db.execute(_scoped(select(PartnerGroup), current_user).order_by(PartnerGroup.name))).scalars().all()
    if not groups:
        return []
    gids = [g.id for g in groups]
    now = now_utc()

    members = (await db.execute(
        select(PartnerGroupMember.group_id, Partner.id, Partner.name, Partner.priority)
        .join(Partner, Partner.id == PartnerGroupMember.partner_id)
        .where(PartnerGroupMember.group_id.in_(gids))
    )).all()
    by_group: dict[str, list] = {}
    for gid, pid, name, prio in members:
        by_group.setdefault(gid, []).append((pid, name, prio or 1))
    last = await last_touch_map(db, {pid for _, pid, _, _ in members})

    tasks = (await db.execute(
        select(PartnerTask).where(PartnerTask.group_id.in_(gids), PartnerTask.status.in_(OPEN))
    )).scalars().all()
    tasks_by: dict[str, list[PartnerTask]] = {}
    for t in tasks:
        tasks_by.setdefault(t.group_id, []).append(t)

    out = []
    for g in groups:
        ms = sorted(by_group.get(g.id, []), key=lambda m: (-m[2], m[1].lower()))
        engaged = sum(1 for pid, _, _ in ms if last.get(pid) and (now - last[pid]).days < 30)
        ts = tasks_by.get(g.id, [])
        dated = sorted((t for t in ts if t.due_date), key=lambda t: t.due_date)
        nxt = dated[0] if dated else None
        out.append({
            "id": g.id, "name": g.name, "description": g.description, "color": g.color,
            "member_count": len(ms),
            "members_preview": [{"id": pid, "name": name} for pid, name, _ in ms[:4]],
            "engaged_30d": engaged,
            "engagement_pct": round(100 * engaged / len(ms)) if ms else 0,
            "open_tasks": len(ts),
            "overdue_tasks": sum(1 for t in ts if t.due_date and t.due_date < now),
            "next_due": {"title": nxt.title, "due_date": nxt.due_date.isoformat()} if nxt else None,
        })
    return out


@router.post("/", status_code=201)
async def create_group(data: GroupCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require(current_user)
    await _ensure_unique_name(db, current_user, data.name)
    count = (await db.execute(_scoped(select(func.count(PartnerGroup.id)), current_user))).scalar() or 0
    g = PartnerGroup(
        id=str(uuid.uuid4()), institution_id=getattr(current_user, "institution_id", None),
        name=data.name.strip(), description=(data.description or "").strip() or None,
        color=data.color or GROUP_COLORS[count % len(GROUP_COLORS)], created_by=current_user.id,
    )
    db.add(g)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, f"A group called “{data.name.strip()}” already exists.")
    ids = list(data.partner_ids)
    if data.tags:
        ids += [p.id for p, _ in await partners_with_tags(db, data.tags, data.match)]
    added = await add_members(db, g.id, ids, current_user.id)
    await db.commit()
    return {"id": g.id, "added": added}


@router.get("/{group_id}")
async def get_group(group_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Group page: stats, 12-week engagement, members, tasks and recent activity."""
    _require(current_user)
    from app.models.partner_meeting import PartnerMeeting
    from app.services.partner_engagement import (
        last_touch_map, touch_events, week_index, now_utc, WEEKS,
    )

    g = await _get_group(group_id, db, current_user)
    now = now_utc()
    rows = (await db.execute(
        select(Partner, PartnerGroupMember.added_at)
        .join(PartnerGroupMember, PartnerGroupMember.partner_id == Partner.id)
        .where(PartnerGroupMember.group_id == g.id)
    )).all()
    ids = [p.id for p, _ in rows]
    last = await last_touch_map(db, ids)

    member_tasks = dict((await db.execute(
        select(PartnerTask.partner_id, func.count(PartnerTask.id))
        .where(PartnerTask.partner_id.in_(ids), PartnerTask.status.in_(OPEN))
        .group_by(PartnerTask.partner_id)
    )).all()) if ids else {}

    events = await touch_events(db, ids, since=now - timedelta(weeks=WEEKS))
    weekly = [{"touches": 0, "meetings": 0} for _ in range(WEEKS)]
    for _, ts, kind in events:
        if (i := week_index(ts, now)) is not None:
            weekly[i]["meetings" if kind == "meeting" else "touches"] += 1
    meetings_90d = (await db.execute(
        select(func.count(PartnerMeeting.id)).where(
            PartnerMeeting.partner_id.in_(ids), PartnerMeeting.scheduled_at >= now - timedelta(days=90),
            PartnerMeeting.scheduled_at <= now)
    )).scalar() if ids else 0
    next_meeting = (await db.execute(
        select(PartnerMeeting).where(
            PartnerMeeting.partner_id.in_(ids), PartnerMeeting.scheduled_at > now,
            PartnerMeeting.completed_at.is_(None)).order_by(PartnerMeeting.scheduled_at).limit(1)
    )).scalar_one_or_none() if ids else None

    tasks = (await db.execute(
        select(PartnerTask).where(PartnerTask.group_id == g.id)
        .order_by(PartnerTask.status, PartnerTask.due_date.asc().nullslast(), PartnerTask.created_at.desc())
    )).scalars().all()
    open_tasks = [t for t in tasks if t.status in OPEN]

    members = []
    for p, added_at in rows:
        lt = last.get(p.id)
        members.append({
            "id": p.id, "name": p.name, "email": p.email, "organization": p.organization,
            "title": p.title, "tags": p.tags or [], "priority": p.priority or 1,
            "last_touch": lt.isoformat() if lt else None,
            "open_tasks": member_tasks.get(p.id, 0),
            "added_at": added_at.isoformat() if added_at else None,
        })
    members.sort(key=lambda m: (-m["priority"], m["name"].lower()))
    engaged = sum(1 for m in members if m["last_touch"] and (now - last[m["id"]]).days < 30)

    # Activity: recent contact-log entries, members joining, tasks completed.
    names = {p.id: p.name for p, _ in rows}
    activity = []
    if ids:
        ups = (await db.execute(
            select(PartnerUpdate, User.name).outerjoin(User, User.id == PartnerUpdate.user_id)
            .where(PartnerUpdate.partner_id.in_(ids))
            .order_by(PartnerUpdate.created_at.desc()).limit(10)
        )).all()
        for u, who in ups:
            text = (u.content or "").strip().replace("\n", " ")
            activity.append({
                "kind": u.update_type or "note", "partner_id": u.partner_id,
                "text": f"{names.get(u.partner_id, '')}: {u.update_type or 'note'}" + (f" — {text[:140]}" if text else ""),
                "who": who, "at": (u.contact_date or u.created_at).isoformat(),
            })
    # People added together (same minute) read as one entry, not one line each.
    batches: dict[str, list[tuple]] = {}
    for p, added_at in rows:
        if added_at:
            batches.setdefault(added_at.strftime("%Y-%m-%dT%H:%M"), []).append((p, added_at))
    for batch in batches.values():
        p, at = batch[0]
        text = (f"{p.name} added to the group" if len(batch) == 1
                else f"{len(batch)} people added to the group ({', '.join(b[0].name for b in batch[:3])}{'…' if len(batch) > 3 else ''})")
        activity.append({"kind": "joined", "partner_id": p.id if len(batch) == 1 else None,
                         "text": text, "who": None, "at": max(b[1] for b in batch).isoformat()})
    for t in tasks:
        if t.completed_at:
            activity.append({"kind": "task_done", "partner_id": None, "text": f"Task done: {t.title}",
                             "who": None, "at": t.completed_at.isoformat()})
    activity.sort(key=lambda a: a["at"], reverse=True)

    owner = (await db.execute(select(User.name).where(User.id == g.created_by))).scalar() if g.created_by else None
    return {
        "id": g.id, "name": g.name, "description": g.description, "color": g.color,
        "owner_name": owner, "created_at": g.created_at.isoformat() if g.created_at else None,
        "stats": {
            "members": len(members), "engaged_30d": engaged,
            "open_tasks": len(open_tasks),
            "overdue_tasks": sum(1 for t in open_tasks if t.due_date and t.due_date < now),
            "meetings_90d": meetings_90d or 0,
            "next_meeting": {"title": next_meeting.title, "scheduled_at": next_meeting.scheduled_at.isoformat()} if next_meeting else None,
            "going_cold": sum(1 for m in members if not m["last_touch"] or (now - last[m["id"]]).days >= 30),
        },
        "weekly": weekly,
        "members": members,
        "tasks": await task_dicts(tasks, db),
        "activity": activity[:12],
    }


@router.patch("/{group_id}")
async def update_group(group_id: str, data: GroupUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require(current_user)
    g = await _get_group(group_id, db, current_user)
    if data.name:
        await _ensure_unique_name(db, current_user, data.name, exclude_id=g.id)
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(g, k, v.strip() if isinstance(v, str) else v)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Another group already has that name.")
    return {"id": g.id}


@router.delete("/{group_id}", status_code=204)
async def delete_group(group_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Deletes the group and its tasks. The partners themselves stay."""
    _require(current_user)
    g = await _get_group(group_id, db, current_user)
    await db.delete(g)
    await db.commit()


@router.get("/{group_id}/members/preview")
async def preview_members(
    group_id: str,
    tags: list[str] = Query(default=[]),
    match: Literal["any", "all"] = "any",
    db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user),
):
    """Who a tag filter would add, flagging people already in the group."""
    _require(current_user)
    await _get_group(group_id, db, current_user)
    inside = set(await _member_ids(db, group_id))
    return [{
        "id": p.id, "name": p.name, "organization": p.organization, "priority": p.priority or 1,
        "tags": p.tags or [], "matched": hits, "in_group": p.id in inside,
    } for p, hits in await partners_with_tags(db, tags, match)]


@router.get("/tags/all")
async def all_tags(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Every tag in use with how many partners carry it (for tag pickers)."""
    _require(current_user)
    counts: dict[str, list] = {}
    for tags in (await db.execute(select(Partner.tags))).scalars().all():
        for t in tags or []:
            t = str(t).strip()
            if not t:
                continue
            key = t.lower()
            if key in counts:
                counts[key][1] += 1
            else:
                counts[key] = [t, 1]
    return sorted(({"tag": t, "count": n} for t, n in counts.values()), key=lambda r: (-r["count"], r["tag"].lower()))


@router.post("/{group_id}/members")
async def add_group_members(group_id: str, data: MembersAdd, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Add people by id and/or by tags (any/all). `exclude_ids` drops people
    the user unchecked in the tag preview."""
    _require(current_user)
    await _get_group(group_id, db, current_user)
    ids = list(data.partner_ids)
    if data.tags:
        ids += [p.id for p, _ in await partners_with_tags(db, data.tags, data.match)]
    skip = set(data.exclude_ids)
    added = await add_members(db, group_id, [i for i in ids if i not in skip], current_user.id)
    await db.commit()
    return {"added": added}


@router.delete("/{group_id}/members/{partner_id}", status_code=204)
async def remove_group_member(group_id: str, partner_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require(current_user)
    await _get_group(group_id, db, current_user)
    await db.execute(sa_delete(PartnerGroupMember).where(
        PartnerGroupMember.group_id == group_id, PartnerGroupMember.partner_id == partner_id))
    await db.commit()


@router.post("/{group_id}/tasks", status_code=201)
async def create_group_task(group_id: str, data: TaskCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require(current_user)
    await _get_group(group_id, db, current_user)
    t = PartnerTask(
        id=str(uuid.uuid4()), group_id=group_id, created_by=current_user.id,
        institution_id=getattr(current_user, "institution_id", None), **data.model_dump(),
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return (await task_dicts([t], db))[0]

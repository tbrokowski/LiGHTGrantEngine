"""Archive Insights: the data behind the Archive → Insights tab.

Statistics are computed in the browser from `/dataset` so selecting grants and
switching breakdowns is instant. This router owns what has to persist:
org-scoped tags on archived grants, and saved Insights views.

Everything here is scoped to the viewer's active organization. Entries shared
with the viewer from another organization are not part of its statistics.
"""
import json
import re
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import can_edit_archive, has_module_permission
from app.database import get_db
from app.models.archive import GrantArchive
from app.models.archive_tag import ArchiveInsightView, ArchiveTag, ArchiveTagLink
from app.models.user import User
from app.routers.auth import get_current_user

router = APIRouter()

# Categorical slots, assigned in this fixed order so a tag keeps its color.
TAG_PALETTE = (
    "#2a78d6", "#eb6834", "#1baf7a", "#eda100",
    "#e87ba4", "#008300", "#6250d6", "#e34948",
)
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
MAX_VIEW_CONFIG_BYTES = 200_000


# ── Pure helpers ──────────────────────────────────────────────────────────────

def clean_text(value: Optional[str], max_len: int) -> str:
    """Collapse whitespace and trim; '' when nothing is left."""
    return re.sub(r"\s+", " ", value or "").strip()[:max_len]


def next_tag_color(existing: list[str]) -> str:
    """The first palette slot used least among the org's tags."""
    used = [c.lower() for c in existing]
    return min(TAG_PALETTE, key=lambda c: (used.count(c.lower()), TAG_PALETTE.index(c)))


def check_color(color: Optional[str]) -> Optional[str]:
    if color is None:
        return None
    if not _HEX.match(color):
        raise HTTPException(400, "Color must be a hex value like #2a78d6")
    return color.lower()


def check_view_config(config: dict) -> dict:
    if not isinstance(config, dict):
        raise HTTPException(400, "View config must be an object")
    if len(json.dumps(config)) > MAX_VIEW_CONFIG_BYTES:
        raise HTTPException(400, "View config is too large")
    return config


# ── Access ───────────────────────────────────────────────────────────────────

def _require_viewer(user: User) -> str:
    """The active organization id, if the user may see its archive."""
    if not has_module_permission(user, "can_view_archive"):
        raise HTTPException(403, "You do not have access to the archive.")
    if not user.institution_id:
        raise HTTPException(400, "Join or select an organization to use archive insights.")
    return user.institution_id


def _require_editor(user: User) -> str:
    org_id = _require_viewer(user)
    if not can_edit_archive(user):
        raise HTTPException(403, "Requires grant lead role or organization admin privileges.")
    return org_id


async def _org_tag(db: AsyncSession, tag_id: str, org_id: str) -> ArchiveTag:
    tag = (await db.execute(
        select(ArchiveTag).where(ArchiveTag.id == tag_id, ArchiveTag.institution_id == org_id)
    )).scalar_one_or_none()
    if not tag:
        raise HTTPException(404, "Tag not found")
    return tag


async def _org_archive_ids(db: AsyncSession, ids: list[str], org_id: str) -> set[str]:
    """The subset of `ids` that belong to the organization."""
    if not ids:
        return set()
    return set((await db.execute(
        select(GrantArchive.id).where(GrantArchive.id.in_(ids), GrantArchive.institution_id == org_id)
    )).scalars().all())


async def _assert_unique_tag(db: AsyncSession, org_id: str, name: str, group: str, exclude_id: str | None = None):
    q = select(ArchiveTag.id).where(
        ArchiveTag.institution_id == org_id,
        func.lower(ArchiveTag.name) == name.lower(),
        func.lower(ArchiveTag.group_name) == group.lower(),
    )
    if exclude_id:
        q = q.where(ArchiveTag.id != exclude_id)
    if (await db.execute(q)).first():
        where = f" in {group}" if group else ""
        raise HTTPException(400, f'A tag named "{name}" already exists{where}')


# ── Serialization ────────────────────────────────────────────────────────────

_ENTRY_FIELDS = (
    "id", "title", "funder", "program", "call_year", "submission_cycle", "lead_pi",
    "co_pis", "partner_institutions", "themes", "geographies", "submitted",
    "submission_date", "outcome", "decision_date", "requested_amount",
    "awarded_amount", "currency", "project_duration", "created_at",
)


def entry_dict(a: GrantArchive, tag_ids: list[str]) -> dict:
    data = {f: getattr(a, f) for f in _ENTRY_FIELDS}
    for f in ("submission_date", "decision_date", "created_at"):
        if data.get(f) is not None:
            data[f] = data[f].isoformat()
    for f in ("co_pis", "partner_institutions", "themes", "geographies"):
        data[f] = data[f] or []
    data["tag_ids"] = tag_ids
    return data


def tag_dict(t: ArchiveTag, usage: int = 0) -> dict:
    return {"id": t.id, "name": t.name, "group": t.group_name or "", "color": t.color, "usage": usage}


def view_dict(v: ArchiveInsightView, users: dict[str, User]) -> dict:
    creator = users.get(v.created_by_id) if v.created_by_id else None
    return {
        "id": v.id, "name": v.name, "config": v.config or {},
        "created_by_id": v.created_by_id,
        "created_by": creator.name if creator else None,
        "created_at": v.created_at.isoformat() if v.created_at else None,
        "updated_at": v.updated_at.isoformat() if v.updated_at else None,
    }


async def _tags_with_usage(db: AsyncSession, org_id: str) -> list[dict]:
    tags = (await db.execute(
        select(ArchiveTag).where(ArchiveTag.institution_id == org_id)
        .order_by(ArchiveTag.group_name, ArchiveTag.name)
    )).scalars().all()
    usage: dict[str, int] = {}
    if tags:
        usage = dict((await db.execute(
            select(ArchiveTagLink.tag_id, func.count())
            .where(ArchiveTagLink.tag_id.in_([t.id for t in tags]))
            .group_by(ArchiveTagLink.tag_id)
        )).all())
    return [tag_dict(t, usage.get(t.id, 0)) for t in tags]


async def _views(db: AsyncSession, org_id: str) -> list[dict]:
    views = (await db.execute(
        select(ArchiveInsightView).where(ArchiveInsightView.institution_id == org_id)
        .order_by(ArchiveInsightView.name)
    )).scalars().all()
    ids = {v.created_by_id for v in views if v.created_by_id}
    users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all()} if ids else {}
    return [view_dict(v, users) for v in views]


# ── Dataset ──────────────────────────────────────────────────────────────────

@router.get("/dataset")
async def insights_dataset(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Every archived grant of the active organization with its tag ids, plus
    the org's tags and saved views — everything the Insights tab computes from."""
    org_id = _require_viewer(current_user)
    archives = (await db.execute(
        select(GrantArchive).where(GrantArchive.institution_id == org_id)
        .order_by(GrantArchive.call_year.desc().nulls_last(), GrantArchive.title)
    )).scalars().all()

    links: dict[str, list[str]] = {}
    if archives:
        for archive_id, tag_id in (await db.execute(
            select(ArchiveTagLink.archive_id, ArchiveTagLink.tag_id)
            .where(ArchiveTagLink.archive_id.in_([a.id for a in archives]))
        )).all():
            links.setdefault(archive_id, []).append(tag_id)

    return {
        "entries": [entry_dict(a, links.get(a.id, [])) for a in archives],
        "tags": await _tags_with_usage(db, org_id),
        "views": await _views(db, org_id),
        "can_edit": can_edit_archive(current_user),
    }


# ── Tags ─────────────────────────────────────────────────────────────────────

class TagCreate(BaseModel):
    name: str
    group: Optional[str] = None
    color: Optional[str] = None


class TagUpdate(BaseModel):
    name: Optional[str] = None
    group: Optional[str] = None
    color: Optional[str] = None


class TagApply(BaseModel):
    archive_ids: list[str]
    remove: bool = False


class EntryTags(BaseModel):
    tag_ids: list[str]


@router.get("/tags")
async def list_tags(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    return await _tags_with_usage(db, _require_viewer(current_user))


@router.post("/tags", status_code=201)
async def create_tag(
    body: TagCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org_id = _require_editor(current_user)
    name = clean_text(body.name, 80)
    group = clean_text(body.group, 80)
    if not name:
        raise HTTPException(400, "Tag name is required")
    await _assert_unique_tag(db, org_id, name, group)
    color = check_color(body.color)
    if not color:
        existing = (await db.execute(
            select(ArchiveTag.color).where(ArchiveTag.institution_id == org_id)
        )).scalars().all()
        color = next_tag_color(list(existing))
    tag = ArchiveTag(
        id=str(uuid.uuid4()), institution_id=org_id, name=name, group_name=group,
        color=color, created_by_id=current_user.id,
    )
    db.add(tag)
    await db.commit()
    return tag_dict(tag)


@router.patch("/tags/{tag_id}")
async def update_tag(
    tag_id: str,
    body: TagUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org_id = _require_editor(current_user)
    tag = await _org_tag(db, tag_id, org_id)
    fields = body.model_dump(exclude_unset=True)
    name = clean_text(fields["name"], 80) if "name" in fields else tag.name
    group = clean_text(fields.get("group"), 80) if "group" in fields else tag.group_name
    if not name:
        raise HTTPException(400, "Tag name is required")
    if (name, group) != (tag.name, tag.group_name):
        await _assert_unique_tag(db, org_id, name, group, exclude_id=tag.id)
    tag.name, tag.group_name = name, group
    if fields.get("color"):
        tag.color = check_color(fields["color"])
    usage = (await db.execute(
        select(func.count()).select_from(ArchiveTagLink).where(ArchiveTagLink.tag_id == tag.id)
    )).scalar_one()
    await db.commit()
    return tag_dict(tag, usage)


@router.delete("/tags/{tag_id}", status_code=204)
async def delete_tag(
    tag_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org_id = _require_editor(current_user)
    tag = await _org_tag(db, tag_id, org_id)
    await db.execute(delete(ArchiveTagLink).where(ArchiveTagLink.tag_id == tag.id))
    await db.delete(tag)
    await db.commit()


@router.post("/tags/{tag_id}/apply")
async def apply_tag(
    tag_id: str,
    body: TagApply,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Add the tag to (or, with `remove`, take it off) many grants at once."""
    org_id = _require_editor(current_user)
    tag = await _org_tag(db, tag_id, org_id)
    ids = await _org_archive_ids(db, list(dict.fromkeys(body.archive_ids)), org_id)
    if body.remove:
        if ids:
            await db.execute(delete(ArchiveTagLink).where(
                ArchiveTagLink.tag_id == tag.id, ArchiveTagLink.archive_id.in_(ids),
            ))
    else:
        have = set((await db.execute(
            select(ArchiveTagLink.archive_id).where(ArchiveTagLink.tag_id == tag.id, ArchiveTagLink.archive_id.in_(ids))
        )).scalars().all()) if ids else set()
        for archive_id in ids - have:
            db.add(ArchiveTagLink(archive_id=archive_id, tag_id=tag.id))
    await db.commit()
    return {"tag_id": tag.id, "archive_ids": sorted(ids), "removed": body.remove}


@router.put("/entries/{archive_id}/tags")
async def set_entry_tags(
    archive_id: str,
    body: EntryTags,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Replace one grant's tags."""
    org_id = _require_editor(current_user)
    if not await _org_archive_ids(db, [archive_id], org_id):
        raise HTTPException(404, "Archive entry not found")
    wanted = list(dict.fromkeys(body.tag_ids))
    valid = set((await db.execute(
        select(ArchiveTag.id).where(ArchiveTag.id.in_(wanted), ArchiveTag.institution_id == org_id)
    )).scalars().all()) if wanted else set()
    if len(valid) != len(wanted):
        raise HTTPException(400, "Unknown tag")
    await db.execute(delete(ArchiveTagLink).where(ArchiveTagLink.archive_id == archive_id))
    for tag_id in wanted:
        db.add(ArchiveTagLink(archive_id=archive_id, tag_id=tag_id))
    await db.commit()
    return {"archive_id": archive_id, "tag_ids": wanted}


# ── Saved views ──────────────────────────────────────────────────────────────

class ViewCreate(BaseModel):
    name: str
    config: dict


class ViewUpdate(BaseModel):
    name: Optional[str] = None
    config: Optional[dict] = None


async def _org_view(db: AsyncSession, view_id: str, org_id: str) -> ArchiveInsightView:
    view = (await db.execute(select(ArchiveInsightView).where(
        ArchiveInsightView.id == view_id, ArchiveInsightView.institution_id == org_id,
    ))).scalar_one_or_none()
    if not view:
        raise HTTPException(404, "View not found")
    return view


def _require_view_owner(view: ArchiveInsightView, user: User) -> None:
    if view.created_by_id != user.id and not can_edit_archive(user):
        raise HTTPException(403, "Only the person who saved this view or an archive editor can change it.")


@router.get("/views")
async def list_views(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    return await _views(db, _require_viewer(current_user))


@router.post("/views", status_code=201)
async def create_view(
    body: ViewCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org_id = _require_viewer(current_user)
    name = clean_text(body.name, 120)
    if not name:
        raise HTTPException(400, "View name is required")
    view = ArchiveInsightView(
        id=str(uuid.uuid4()), institution_id=org_id, name=name,
        config=check_view_config(body.config), created_by_id=current_user.id,
    )
    db.add(view)
    await db.commit()
    await db.refresh(view)
    return view_dict(view, {current_user.id: current_user})


@router.patch("/views/{view_id}")
async def update_view(
    view_id: str,
    body: ViewUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org_id = _require_viewer(current_user)
    view = await _org_view(db, view_id, org_id)
    _require_view_owner(view, current_user)
    if body.name is not None:
        name = clean_text(body.name, 120)
        if not name:
            raise HTTPException(400, "View name is required")
        view.name = name
    if body.config is not None:
        view.config = check_view_config(body.config)
    await db.commit()
    await db.refresh(view)
    creator = (await db.get(User, view.created_by_id)) if view.created_by_id else None
    return view_dict(view, {creator.id: creator} if creator else {})


@router.delete("/views/{view_id}", status_code=204)
async def delete_view(
    view_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org_id = _require_viewer(current_user)
    view = await _org_view(db, view_id, org_id)
    _require_view_owner(view, current_user)
    await db.delete(view)
    await db.commit()

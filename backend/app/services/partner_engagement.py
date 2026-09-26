"""Engagement signals for the Partner CRM, computed from records that already
exist — no separate activity table.

A "touch" is a logged contact (a partner_updates row of type email, call,
meeting or other — notes are not contact) dated by its contact_date, or a
partner meeting that has taken place. From touches we derive each partner's
last contact and the 12-week activity strips on people and groups.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.partner import Partner, PartnerUpdate
from app.models.partner_meeting import PartnerMeeting

WEEKS = 12
TOUCH_TYPES = ("email", "call", "meeting", "other")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


async def touch_events(
    db: AsyncSession,
    partner_ids: Optional[Iterable[str]] = None,
    since: Optional[datetime] = None,
) -> list[tuple[str, datetime, str]]:
    """(partner_id, when, kind) for every touch, newest first. `kind` is the
    update type, or "meeting" for a partner meeting."""
    now = now_utc()
    ids = list(partner_ids) if partner_ids is not None else None
    if ids is not None and not ids:
        return []

    when = func.coalesce(PartnerUpdate.contact_date, PartnerUpdate.created_at)
    uq = select(PartnerUpdate.partner_id, when, PartnerUpdate.update_type).where(
        PartnerUpdate.update_type.in_(TOUCH_TYPES), when <= now)
    mq = select(PartnerMeeting.partner_id, PartnerMeeting.scheduled_at).where(
        PartnerMeeting.scheduled_at.isnot(None), PartnerMeeting.scheduled_at <= now)
    if ids is not None:
        uq = uq.where(PartnerUpdate.partner_id.in_(ids))
        mq = mq.where(PartnerMeeting.partner_id.in_(ids))
    if since is not None:
        uq = uq.where(when >= since)
        mq = mq.where(PartnerMeeting.scheduled_at >= since)

    out = [(pid, _aware(ts), kind or "other") for pid, ts, kind in (await db.execute(uq)).all()]
    out += [(pid, _aware(ts), "meeting") for pid, ts in (await db.execute(mq)).all()]
    out.sort(key=lambda e: e[1], reverse=True)
    return out


async def last_touch_map(db: AsyncSession, partner_ids: Iterable[str]) -> dict[str, datetime]:
    ids = list(partner_ids)
    if not ids:
        return {}
    now = now_utc()
    when = func.coalesce(PartnerUpdate.contact_date, PartnerUpdate.created_at)
    out: dict[str, datetime] = {}
    rows = (await db.execute(
        select(PartnerUpdate.partner_id, func.max(when))
        .where(PartnerUpdate.partner_id.in_(ids), PartnerUpdate.update_type.in_(TOUCH_TYPES), when <= now)
        .group_by(PartnerUpdate.partner_id)
    )).all()
    rows += (await db.execute(
        select(PartnerMeeting.partner_id, func.max(PartnerMeeting.scheduled_at))
        .where(PartnerMeeting.partner_id.in_(ids), PartnerMeeting.scheduled_at <= now)
        .group_by(PartnerMeeting.partner_id)
    )).all()
    for pid, ts in rows:
        ts = _aware(ts)
        if ts and (pid not in out or ts > out[pid]):
            out[pid] = ts
    return out


def week_index(ts: datetime, now: datetime) -> int | None:
    """0 = the oldest of the last WEEKS weeks, WEEKS-1 = this week."""
    ago = (now - ts).days // 7
    return None if ago >= WEEKS or ago < 0 else WEEKS - 1 - ago


async def weekly_by_partner(db: AsyncSession, partner_ids: Iterable[str]) -> dict[str, list[int]]:
    now = now_utc()
    out: dict[str, list[int]] = defaultdict(lambda: [0] * WEEKS)
    for pid, ts, _ in await touch_events(db, partner_ids, since=now - timedelta(weeks=WEEKS)):
        i = week_index(ts, now)
        if i is not None:
            out[pid][i] += 1
    return dict(out)


def days_since(ts: datetime | None, now: datetime) -> int | None:
    return None if ts is None else max(0, (now - ts).days)

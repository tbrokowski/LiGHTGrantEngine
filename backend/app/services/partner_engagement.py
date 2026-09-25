"""Engagement signals for the Partner CRM, computed from records that already
exist — no separate activity table.

A "touch" is a logged contact (a partner_updates row of type email, call,
meeting or other — notes are not contact) dated by its contact_date, or a
partner meeting that has taken place. From touches we derive each partner's
last contact, a 12-week activity strip, and the reach-out suggestions on the
Partners home.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from statistics import median
from typing import Iterable, Optional

from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.partner import Partner, PartnerUpdate
from app.models.partner_meeting import PartnerMeeting

WEEKS = 12
TOUCH_TYPES = ("email", "call", "meeting", "other")
# Days without contact before someone counts as "going cold", by priority.
COLD_AFTER_DAYS = {3: 30, 2: 45, 1: 90}


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


async def reach_out_suggestions(db: AsyncSession, limit: int = 6) -> list[dict]:
    """People worth contacting now, most important first, each with the reason.

    - Follow-up due: a logged next-contact date has passed.
    - Overdue task: an open task on them is past due.
    - Slipping: contact is well past their usual rhythm (≥3 touches in 180
      days, and it's been more than twice the typical gap and 14+ days).
    - Going cold: priority 2–3 and no contact for longer than COLD_AFTER_DAYS.
    Snoozed partners are skipped.
    """
    from app.models.partner_task import PartnerTask

    now = now_utc()
    partners = (await db.execute(
        select(Partner).where(
            Partner.status != "inactive",
            or_(Partner.snoozed_until.is_(None), Partner.snoozed_until < now),
        )
    )).scalars().all()
    if not partners:
        return []
    by_id = {p.id: p for p in partners}
    ids = list(by_id)

    events = await touch_events(db, ids, since=now - timedelta(days=180))
    history: dict[str, list[datetime]] = defaultdict(list)
    for pid, ts, _ in events:
        history[pid].append(ts)
    last = await last_touch_map(db, ids)

    followups = dict((await db.execute(
        select(PartnerUpdate.partner_id, func.max(PartnerUpdate.next_contact_date))
        .where(PartnerUpdate.partner_id.in_(ids), PartnerUpdate.next_contact_date.isnot(None))
        .group_by(PartnerUpdate.partner_id)
    )).all())
    overdue_tasks = (await db.execute(
        select(PartnerTask).where(
            PartnerTask.partner_id.in_(ids), PartnerTask.status.in_(["open", "in_progress"]),
            PartnerTask.due_date.isnot(None), PartnerTask.due_date < now,
        ).order_by(PartnerTask.due_date)
    )).scalars().all()
    task_for: dict[str, PartnerTask] = {}
    for t in overdue_tasks:
        task_for.setdefault(t.partner_id, t)

    out: list[dict] = []
    for pid, p in by_id.items():
        prio = p.priority or 1
        lt = last.get(pid)
        since = days_since(lt, now)
        reason = kind = None
        score = 0.0

        fu = _aware(followups.get(pid))
        if fu and fu <= now and (lt is None or lt < fu):
            late = (now - fu).days
            kind, score = "followup", 100 + prio * 10 + late
            reason = "Follow-up was due today." if late == 0 else f"Follow-up was due {late} day{'s' if late != 1 else ''} ago."
        elif pid in task_for:
            t = task_for[pid]
            late = (now - _aware(t.due_date)).days
            kind, score = "task", 90 + prio * 10 + late
            reason = f"“{t.title}” is {late or 1} day{'s' if late > 1 else ''} overdue."
        else:
            ts = sorted(history.get(pid, []))
            if len(ts) >= 3 and since is not None:
                gaps = [(b - a).days for a, b in zip(ts, ts[1:]) if (b - a).days > 0]
                typical = median(gaps) if gaps else None
                if typical and since > max(14, typical * 2):
                    kind, score = "slipping", 60 + prio * 10 + since / typical
                    reason = f"You usually talk every ~{round(typical)} days; it's been {since}."
            if kind is None and prio >= 2:
                limit_days = COLD_AFTER_DAYS[prio]
                if since is not None and since > limit_days:
                    kind, score = "cold", 40 + prio * 10 + since / limit_days
                    reason = f"Priority {prio} and no contact in {since} days."
                elif since is None and prio == 3 and p.created_at and (now - _aware(p.created_at)).days > 14:
                    kind, score = "cold", 40 + prio * 10
                    reason = "Priority 3 and no contact logged yet."
        if kind:
            out.append({
                "partner_id": pid, "name": p.name, "organization": p.organization,
                "priority": prio, "kind": kind, "reason": reason, "score": score,
                "last_touch": lt.isoformat() if lt else None,
            })
    out.sort(key=lambda s: s["score"], reverse=True)
    return out[:limit]

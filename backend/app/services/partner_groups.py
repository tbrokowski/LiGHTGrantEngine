"""Partner groups: membership helpers shared by the groups API and bulk import."""
from __future__ import annotations

from typing import Iterable

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.partner import Partner
from app.models.partner_group import PartnerGroupMember


def tag_matches(tags: Iterable[str] | None, wanted: list[str], match: str = "any") -> list[str]:
    """The wanted tags this partner has (case-insensitive). With match="all"
    it returns [] unless every wanted tag is present."""
    have = {str(t).strip().lower() for t in (tags or [])}
    hits = [w for w in wanted if w.strip().lower() in have]
    if match == "all" and len(hits) < len(wanted):
        return []
    return hits


async def partners_with_tags(db: AsyncSession, tags: list[str], match: str = "any") -> list[tuple[Partner, list[str]]]:
    """Partners carrying the given tags, with which tags matched. Matched in
    Python: tags is a plain JSON column and the CRM holds hundreds of rows."""
    wanted = [t for t in (t.strip() for t in tags) if t]
    if not wanted:
        return []
    rows = (await db.execute(select(Partner))).scalars().all()
    out = []
    for p in rows:
        hits = tag_matches(p.tags, wanted, match)
        if hits:
            out.append((p, hits))
    out.sort(key=lambda r: (-(r[0].priority or 1), r[0].name.lower()))
    return out


async def add_members(db: AsyncSession, group_id: str, partner_ids: Iterable[str], user_id: str | None) -> int:
    """Add partners to a group, skipping ones already in it. Returns how many
    were added. Caller commits."""
    ids = list(dict.fromkeys(partner_ids))
    if not ids:
        return 0
    existing = set((await db.execute(
        select(PartnerGroupMember.partner_id).where(
            PartnerGroupMember.group_id == group_id, PartnerGroupMember.partner_id.in_(ids))
    )).scalars().all())
    new = [pid for pid in ids if pid not in existing]
    if new:
        await db.execute(
            pg_insert(PartnerGroupMember)
            .values([{"group_id": group_id, "partner_id": pid, "added_by": user_id} for pid in new])
            .on_conflict_do_nothing()
        )
    return len(new)

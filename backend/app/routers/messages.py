"""Messaging: direct and group conversations between organization members."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.institution_membership import InstitutionMembership
from app.models.message import Conversation, ConversationMember, Message
from app.models.notification import NotificationType
from app.models.user import User
from app.routers.auth import get_current_user
from app.services.notify import notify

router = APIRouter()

MAX_BODY = 8000


class ConversationCreate(BaseModel):
    member_ids: list[str] = Field(min_length=1, max_length=100)
    title: str | None = Field(default=None, max_length=200)
    body: str | None = Field(default=None, max_length=MAX_BODY)


class ConversationUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    add_member_ids: list[str] = Field(default_factory=list, max_length=100)


class MessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=MAX_BODY)


def _iso(d: datetime | None) -> str | None:
    return d.isoformat() if d else None


def _parse_ts(s: str) -> datetime:
    try:
        # A literal "+" in a query string can arrive decoded as a space.
        return datetime.fromisoformat(s.replace(" ", "+"))
    except ValueError:
        raise HTTPException(400, "Invalid timestamp")


async def _org_member_ids(db: AsyncSession, institution_id: str | None, user_ids: set[str]) -> set[str]:
    """The subset of ``user_ids`` who are active members of the organization."""
    if not institution_id or not user_ids:
        return set()
    rows = await db.execute(
        select(User.id)
        .join(InstitutionMembership, InstitutionMembership.user_id == User.id)
        .where(
            InstitutionMembership.institution_id == institution_id,
            User.id.in_(user_ids),
            User.is_active.is_(True),
        )
    )
    return {r[0] for r in rows.all()}


async def _membership_or_404(db: AsyncSession, conversation_id: str, user_id: str) -> tuple[Conversation, ConversationMember]:
    row = (await db.execute(
        select(Conversation, ConversationMember)
        .join(ConversationMember, and_(
            ConversationMember.conversation_id == Conversation.id,
            ConversationMember.user_id == user_id,
        ))
        .where(Conversation.id == conversation_id)
    )).first()
    if not row:
        raise HTTPException(404, "Conversation not found")
    return row[0], row[1]


async def _serialize_conversations(
    db: AsyncSession, user: User, convs: list[tuple[Conversation, ConversationMember]]
) -> list[dict]:
    if not convs:
        return []
    ids = [c.id for c, _ in convs]

    members = (await db.execute(
        select(ConversationMember.conversation_id, User.id, User.name, User.email)
        .join(User, User.id == ConversationMember.user_id)
        .where(ConversationMember.conversation_id.in_(ids))
        .order_by(User.name)
    )).all()
    by_conv: dict[str, list[dict]] = {}
    for cid, uid, name, email in members:
        by_conv.setdefault(cid, []).append({"id": uid, "name": name, "email": email})

    # Latest message per conversation.
    latest_sub = (
        select(Message.conversation_id, func.max(Message.created_at).label("mx"))
        .where(Message.conversation_id.in_(ids))
        .group_by(Message.conversation_id)
        .subquery()
    )
    latest_rows = (await db.execute(
        select(Message, User.name)
        .join(latest_sub, and_(
            Message.conversation_id == latest_sub.c.conversation_id,
            Message.created_at == latest_sub.c.mx,
        ))
        .outerjoin(User, User.id == Message.sender_id)
    )).all()
    latest = {m.conversation_id: (m, name) for m, name in latest_rows}

    # Unread = messages from others after the member's read cursor.
    unread_rows = (await db.execute(
        select(Message.conversation_id, func.count())
        .join(ConversationMember, and_(
            ConversationMember.conversation_id == Message.conversation_id,
            ConversationMember.user_id == user.id,
        ))
        .where(
            Message.conversation_id.in_(ids),
            or_(Message.sender_id.is_(None), Message.sender_id != user.id),
            or_(ConversationMember.last_read_at.is_(None), Message.created_at > ConversationMember.last_read_at),
        )
        .group_by(Message.conversation_id)
    )).all()
    unread = {cid: n for cid, n in unread_rows}

    out = []
    for c, _m in convs:
        people = by_conv.get(c.id, [])
        others = [p for p in people if p["id"] != user.id]
        last = latest.get(c.id)
        out.append({
            "id": c.id,
            "title": c.title,
            "is_group": c.is_group,
            "display_name": c.title or ", ".join(p["name"] for p in others) or "Just you",
            "members": people,
            "last_message_at": _iso(c.last_message_at),
            "last_message": {
                "body": last[0].body[:200],
                "sender_id": last[0].sender_id,
                "sender_name": last[1],
                "created_at": _iso(last[0].created_at),
            } if last else None,
            "unread_count": unread.get(c.id, 0),
        })
    return out


@router.get("/people")
async def messageable_people(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Members of the active organization, for the new-message picker."""
    if not current_user.institution_id:
        return []
    rows = (await db.execute(
        select(User.id, User.name, User.email)
        .join(InstitutionMembership, InstitutionMembership.user_id == User.id)
        .where(
            InstitutionMembership.institution_id == current_user.institution_id,
            User.is_active.is_(True),
            User.id != current_user.id,
        )
        .order_by(User.name)
    )).all()
    return [{"id": i, "name": n, "email": e} for i, n, e in rows]


@router.get("/conversations")
async def list_conversations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (await db.execute(
        select(Conversation, ConversationMember)
        .join(ConversationMember, and_(
            ConversationMember.conversation_id == Conversation.id,
            ConversationMember.user_id == current_user.id,
        ))
        .order_by(Conversation.last_message_at.desc())
        .limit(200)
    )).all()
    return await _serialize_conversations(db, current_user, [(c, m) for c, m in rows])


@router.get("/unread-count")
async def unread_count(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    n = (await db.execute(
        select(func.count(Message.id))
        .join(ConversationMember, and_(
            ConversationMember.conversation_id == Message.conversation_id,
            ConversationMember.user_id == current_user.id,
        ))
        .where(
            or_(Message.sender_id.is_(None), Message.sender_id != current_user.id),
            or_(ConversationMember.last_read_at.is_(None), Message.created_at > ConversationMember.last_read_at),
        )
    )).scalar_one()
    return {"unread": n}


@router.post("/conversations")
async def create_conversation(
    data: ConversationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Start a conversation. Two people → a direct message (reused if one
    already exists); more → a group."""
    wanted = set(data.member_ids) - {current_user.id}
    valid = await _org_member_ids(db, current_user.institution_id, wanted)
    if not valid or valid != wanted:
        raise HTTPException(400, "Everyone in a conversation must be a member of your organization")

    is_group = len(valid) > 1 or bool(data.title)
    conv: Conversation | None = None
    if not is_group:
        other = next(iter(valid))
        # An existing DM: non-group, both users members, exactly two members.
        mine = select(ConversationMember.conversation_id).where(ConversationMember.user_id == current_user.id)
        theirs = select(ConversationMember.conversation_id).where(ConversationMember.user_id == other)
        conv = (await db.execute(
            select(Conversation).where(
                Conversation.is_group.is_(False),
                Conversation.id.in_(mine),
                Conversation.id.in_(theirs),
            ).limit(1)
        )).scalar_one_or_none()

    if conv is None:
        conv = Conversation(
            institution_id=current_user.institution_id,
            title=(data.title or "").strip() or None,
            is_group=is_group,
            created_by_id=current_user.id,
        )
        db.add(conv)
        await db.flush()
        now = datetime.now(timezone.utc)
        db.add(ConversationMember(conversation_id=conv.id, user_id=current_user.id, last_read_at=now))
        for uid in valid:
            db.add(ConversationMember(conversation_id=conv.id, user_id=uid))
        if is_group:
            await notify(
                db, valid, NotificationType.NEW_MESSAGE.value,
                f"{current_user.name} added you to {conv.title or 'a group conversation'}",
                entity_type="conversation", entity_id=conv.id, actor_id=current_user.id, collapse=True,
            )

    if data.body and data.body.strip():
        await _post_message(db, conv, current_user, data.body.strip())
    await db.commit()
    mem = (await db.execute(
        select(ConversationMember).where(
            ConversationMember.conversation_id == conv.id,
            ConversationMember.user_id == current_user.id,
        )
    )).scalar_one()
    return (await _serialize_conversations(db, current_user, [(conv, mem)]))[0]


@router.patch("/conversations/{conversation_id}")
async def update_conversation(
    conversation_id: str,
    data: ConversationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conv, mem = await _membership_or_404(db, conversation_id, current_user.id)
    if not conv.is_group:
        raise HTTPException(400, "Direct messages can't be renamed or extended; start a group instead")
    if data.title is not None:
        conv.title = data.title.strip() or None
    if data.add_member_ids:
        existing = set((await db.execute(
            select(ConversationMember.user_id).where(ConversationMember.conversation_id == conv.id)
        )).scalars().all())
        wanted = set(data.add_member_ids) - existing
        valid = await _org_member_ids(db, conv.institution_id, wanted)
        if valid != wanted:
            raise HTTPException(400, "Everyone in a conversation must be a member of the organization")
        for uid in valid:
            db.add(ConversationMember(conversation_id=conv.id, user_id=uid))
        await notify(
            db, valid, NotificationType.NEW_MESSAGE.value,
            f"{current_user.name} added you to {conv.title or 'a group conversation'}",
            entity_type="conversation", entity_id=conv.id, actor_id=current_user.id, collapse=True,
        )
    await db.commit()
    return (await _serialize_conversations(db, current_user, [(conv, mem)]))[0]


@router.delete("/conversations/{conversation_id}/members/me", status_code=204)
async def leave_conversation(
    conversation_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conv, mem = await _membership_or_404(db, conversation_id, current_user.id)
    if not conv.is_group:
        raise HTTPException(400, "You can't leave a direct message")
    await db.delete(mem)
    await db.commit()


@router.get("/conversations/{conversation_id}/messages")
async def list_messages(
    conversation_id: str,
    before: str | None = None,
    after: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Messages oldest-first. ``before`` pages back in history; ``after``
    fetches only what arrived since the last poll."""
    await _membership_or_404(db, conversation_id, current_user.id)
    q = (
        select(Message, User.name)
        .outerjoin(User, User.id == Message.sender_id)
        .where(Message.conversation_id == conversation_id)
    )
    if before:
        q = q.where(Message.created_at < _parse_ts(before))
    if after:
        q = q.where(Message.created_at > _parse_ts(after))
        rows = (await db.execute(q.order_by(Message.created_at).limit(limit))).all()
    else:
        rows = list(reversed((await db.execute(q.order_by(Message.created_at.desc()).limit(limit))).all()))
    return {
        "items": [
            {
                "id": m.id,
                "sender_id": m.sender_id,
                "sender_name": name,
                "body": m.body,
                "created_at": _iso(m.created_at),
            }
            for m, name in rows
        ],
        "has_more": not after and len(rows) == limit,
    }


async def _post_message(db: AsyncSession, conv: Conversation, sender: User, body: str) -> Message:
    now = datetime.now(timezone.utc)
    msg = Message(conversation_id=conv.id, sender_id=sender.id, body=body, created_at=now)
    db.add(msg)
    conv.last_message_at = now
    member_rows = (await db.execute(
        select(ConversationMember).where(ConversationMember.conversation_id == conv.id)
    )).scalars().all()
    for m in member_rows:
        if m.user_id == sender.id:
            m.last_read_at = now
    preview = body if len(body) <= 140 else body[:137] + "…"
    where = f" in {conv.title}" if conv.is_group and conv.title else (" in a group" if conv.is_group else "")
    await notify(
        db, [m.user_id for m in member_rows], NotificationType.NEW_MESSAGE.value,
        f"{sender.name}{where}: {preview}",
        entity_type="conversation", entity_id=conv.id, actor_id=sender.id, collapse=True,
    )
    return msg


@router.post("/conversations/{conversation_id}/messages")
async def send_message(
    conversation_id: str,
    data: MessageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conv, _ = await _membership_or_404(db, conversation_id, current_user.id)
    body = data.body.strip()
    if not body:
        raise HTTPException(400, "Message is empty")
    msg = await _post_message(db, conv, current_user, body)
    await db.commit()
    return {
        "id": msg.id,
        "sender_id": msg.sender_id,
        "sender_name": current_user.name,
        "body": msg.body,
        "created_at": _iso(msg.created_at),
    }


@router.post("/conversations/{conversation_id}/read")
async def mark_conversation_read(
    conversation_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from sqlalchemy import update
    from app.models.notification import Notification, NotificationStatus

    _, mem = await _membership_or_404(db, conversation_id, current_user.id)
    mem.last_read_at = datetime.now(timezone.utc)
    # Reading the thread also clears its inbox notice.
    await db.execute(
        update(Notification)
        .where(
            Notification.user_id == current_user.id,
            Notification.entity_type == "conversation",
            Notification.entity_id == conversation_id,
        )
        .values(status=NotificationStatus.READ)
    )
    await db.commit()
    return {"ok": True}

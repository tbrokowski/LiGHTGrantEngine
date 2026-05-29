"""Partner meetings sub-resource — schedule, prep, complete."""
import uuid
from typing import Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.partner import Partner
from app.models.partner_meeting import PartnerMeeting
from app.models.user import User
from app.routers.auth import get_current_user

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class MeetingCreate(BaseModel):
    title: str
    scheduled_at: Optional[datetime] = None
    duration_minutes: int = 60
    location: Optional[str] = None
    meeting_type: str = "video"
    agenda: list[str] = []
    attendees: list[dict] = []
    grant_context_entity_type: Optional[str] = None
    grant_context_entity_id: Optional[str] = None
    reminder_at: Optional[datetime] = None


class MeetingUpdate(BaseModel):
    title: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    duration_minutes: Optional[int] = None
    location: Optional[str] = None
    meeting_type: Optional[str] = None
    agenda: Optional[list[str]] = None
    notes: Optional[str] = None
    action_items: Optional[list[dict]] = None
    attendees: Optional[list[dict]] = None
    grant_context_entity_type: Optional[str] = None
    grant_context_entity_id: Optional[str] = None
    reminder_at: Optional[datetime] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _meeting_dict(m: PartnerMeeting) -> dict:
    return {
        "id": m.id,
        "partner_id": m.partner_id,
        "title": m.title,
        "scheduled_at": str(m.scheduled_at) if m.scheduled_at else None,
        "duration_minutes": m.duration_minutes,
        "location": m.location,
        "meeting_type": m.meeting_type,
        "agenda": m.agenda,
        "notes": m.notes,
        "action_items": m.action_items,
        "attendees": m.attendees,
        "grant_context_entity_type": m.grant_context_entity_type,
        "grant_context_entity_id": m.grant_context_entity_id,
        "meeting_prep": m.meeting_prep,
        "meeting_prep_generated_at": str(m.meeting_prep_generated_at) if m.meeting_prep_generated_at else None,
        "reminder_at": str(m.reminder_at) if m.reminder_at else None,
        "reminder_sent": m.reminder_sent,
        "completed_at": str(m.completed_at) if m.completed_at else None,
        "created_by": m.created_by,
        "created_at": str(m.created_at) if m.created_at else None,
        "updated_at": str(m.updated_at) if m.updated_at else None,
    }


async def _get_meeting_or_404(meeting_id: str, partner_id: str, db: AsyncSession) -> PartnerMeeting:
    res = await db.execute(
        select(PartnerMeeting).where(
            PartnerMeeting.id == meeting_id,
            PartnerMeeting.partner_id == partner_id,
        )
    )
    m = res.scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Meeting not found")
    return m


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/{partner_id}/meetings")
async def list_meetings(
    partner_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    res = await db.execute(
        select(PartnerMeeting)
        .where(PartnerMeeting.partner_id == partner_id)
        .order_by(PartnerMeeting.scheduled_at.desc().nullslast())
    )
    return [_meeting_dict(m) for m in res.scalars().all()]


@router.post("/{partner_id}/meetings", status_code=201)
async def create_meeting(
    partner_id: str,
    data: MeetingCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Verify partner exists
    res = await db.execute(select(Partner).where(Partner.id == partner_id))
    if not res.scalar_one_or_none():
        raise HTTPException(404, "Partner not found")

    meeting = PartnerMeeting(
        id=str(uuid.uuid4()),
        partner_id=partner_id,
        institution_id=getattr(current_user, "institution_id", "") or "",
        created_by=current_user.id,
        **data.model_dump(),
    )
    db.add(meeting)
    await db.commit()
    await db.refresh(meeting)
    return _meeting_dict(meeting)


@router.get("/{partner_id}/meetings/{meeting_id}")
async def get_meeting(
    partner_id: str,
    meeting_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _meeting_dict(await _get_meeting_or_404(meeting_id, partner_id, db))


@router.patch("/{partner_id}/meetings/{meeting_id}")
async def update_meeting(
    partner_id: str,
    meeting_id: str,
    data: MeetingUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = await _get_meeting_or_404(meeting_id, partner_id, db)
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(meeting, k, v)
    await db.commit()
    return _meeting_dict(meeting)


@router.delete("/{partner_id}/meetings/{meeting_id}", status_code=204)
async def delete_meeting(
    partner_id: str,
    meeting_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = await _get_meeting_or_404(meeting_id, partner_id, db)
    await db.delete(meeting)
    await db.commit()


@router.post("/{partner_id}/meetings/{meeting_id}/generate-prep")
async def generate_meeting_prep(
    partner_id: str,
    meeting_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate AI meeting briefing for this meeting."""
    meeting = await _get_meeting_or_404(meeting_id, partner_id, db)

    # Gather partner context
    res = await db.execute(select(Partner).where(Partner.id == partner_id))
    partner = res.scalar_one_or_none()
    if not partner:
        raise HTTPException(404, "Partner not found")

    from app.models.partner import PartnerUpdate
    updates_res = await db.execute(
        select(PartnerUpdate)
        .where(PartnerUpdate.partner_id == partner_id)
        .order_by(desc(PartnerUpdate.created_at))
        .limit(5)
    )
    recent_updates = updates_res.scalars().all()

    partner_data = {
        "name": partner.name,
        "title": partner.title,
        "organization": partner.organization,
        "tags": partner.tags,
        "notes": partner.notes,
        "h_index": partner.h_index,
    }
    recent_logs = [
        {"type": u.update_type, "date": str(u.contact_date or u.created_at), "notes": u.content[:300]}
        for u in recent_updates
    ]
    grant_context = None
    if meeting.grant_context_entity_id:
        grant_context = f"{meeting.grant_context_entity_type}:{meeting.grant_context_entity_id}"

    background_tasks.add_task(
        _generate_prep_background,
        meeting_id,
        partner_data,
        meeting.title,
        meeting.agenda,
        recent_logs,
        grant_context,
    )

    return {"status": "generating", "meeting_id": meeting_id}


async def _generate_prep_background(
    meeting_id: str,
    partner_data: dict,
    meeting_title: str,
    agenda: list,
    recent_logs: list,
    grant_context: str | None,
) -> None:
    import asyncio
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from app.config import get_settings
    from app.ai.agents.meeting_prep_agent import generate_meeting_prep

    try:
        prep_text = await generate_meeting_prep(
            partner=partner_data,
            meeting_title=meeting_title,
            agenda=agenda,
            recent_logs=recent_logs,
            grant_context=grant_context,
        )
        settings = get_settings()
        engine = create_engine(settings.database_url, pool_pre_ping=True)
        with Session(engine) as db:
            meeting = db.get(PartnerMeeting, meeting_id)
            if meeting:
                meeting.meeting_prep = prep_text
                meeting.meeting_prep_generated_at = datetime.now(timezone.utc)
                db.commit()
    except Exception:
        pass


@router.post("/{partner_id}/meetings/{meeting_id}/complete")
async def complete_meeting(
    partner_id: str,
    meeting_id: str,
    data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark meeting as complete and auto-create a contact log entry."""
    from app.models.partner import PartnerUpdate

    meeting = await _get_meeting_or_404(meeting_id, partner_id, db)
    meeting.completed_at = datetime.now(timezone.utc)
    if data.get("notes"):
        meeting.notes = data["notes"]
    if data.get("action_items"):
        meeting.action_items = data["action_items"]

    # Auto-create contact log
    log_content = f"Meeting: {meeting.title}"
    if meeting.notes:
        log_content += f"\n\n{meeting.notes}"
    if meeting.action_items:
        items = [f"• {a.get('text', '')}" for a in meeting.action_items if a.get("text")]
        if items:
            log_content += "\n\nAction items:\n" + "\n".join(items)

    log_entry = PartnerUpdate(
        id=str(uuid.uuid4()),
        partner_id=partner_id,
        user_id=current_user.id,
        content=log_content,
        update_type="meeting",
        contact_date=meeting.scheduled_at or datetime.now(timezone.utc),
        next_contact_date=data.get("next_contact_date"),
    )
    db.add(log_entry)
    await db.commit()
    return {"id": meeting.id, "status": "completed"}

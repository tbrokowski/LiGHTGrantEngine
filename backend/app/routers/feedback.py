"""User feedback: submit a comment / concern / bug / revision.

Every submission is stored in the `feedback` table (the running log) and emailed
to settings.feedback_email. Email failures never fail the request — the log is
the source of truth.
"""
import html
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import is_org_admin
from app.config import get_settings
from app.database import get_db
from app.models.feedback import Feedback
from app.models.user import User
from app.routers.auth import get_current_user
from app.services.email import send_email

router = APIRouter()

# Statuses an admin can set: unreviewed → in progress → done.
_VALID_STATUSES = {"new", "in_progress", "resolved"}

_CATEGORY_LABELS = {
    "bug": "Bug",
    "concern": "Concern",
    "idea": "Idea",
    "revision": "Revision",
    "other": "Comment",
}


class FeedbackCreate(BaseModel):
    category: str = "other"
    message: str = Field(min_length=1, max_length=5000)
    page_url: str | None = None


def _dict(f: Feedback) -> dict:
    return {
        "id": f.id,
        "user_id": f.user_id,
        "user_email": f.user_email,
        "user_name": f.user_name,
        "category": f.category,
        "message": f.message,
        "page_url": f.page_url,
        "status": f.status,
        "created_at": f.created_at.isoformat() if f.created_at else None,
    }


@router.post("", status_code=201)
async def submit_feedback(
    data: FeedbackCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    category = data.category if data.category in _CATEGORY_LABELS else "other"
    fb = Feedback(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        user_email=current_user.email,
        user_name=current_user.name,
        category=category,
        message=data.message.strip(),
        page_url=data.page_url,
        user_agent=request.headers.get("user-agent", "")[:500],
    )
    db.add(fb)
    await db.commit()

    # Email the feedback inbox — best-effort, never blocks the submission.
    settings = get_settings()
    label = _CATEGORY_LABELS[category]
    safe_msg = html.escape(fb.message).replace("\n", "<br>")
    who = html.escape(f"{fb.user_name or 'Unknown'} <{fb.user_email or 'no-email'}>")
    page = html.escape(fb.page_url or "—")
    html_body = (
        f"<h2>New {label} submitted</h2>"
        f"<p><strong>From:</strong> {who}</p>"
        f"<p><strong>Page:</strong> {page}</p>"
        f"<p><strong>Category:</strong> {html.escape(label)}</p>"
        f"<hr><p>{safe_msg}</p>"
    )
    text_body = (
        f"New {label} submitted\n"
        f"From: {fb.user_name or 'Unknown'} <{fb.user_email or 'no-email'}>\n"
        f"Page: {fb.page_url or '-'}\n\n{fb.message}"
    )
    await send_email(
        to=settings.feedback_email,
        subject=f"[LiGHT feedback] {label} from {fb.user_name or fb.user_email or 'a user'}",
        html=html_body,
        text=text_body,
    )
    return _dict(fb)


@router.get("")
async def list_feedback(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Admins see all feedback (the log); everyone else sees their own."""
    query = select(Feedback).order_by(desc(Feedback.created_at))
    if not is_org_admin(current_user):
        query = query.where(Feedback.user_id == current_user.id)
    result = await db.execute(query)
    return [_dict(f) for f in result.scalars().all()]


class FeedbackStatusUpdate(BaseModel):
    status: str  # new (unreviewed) | in_progress | resolved (done)


@router.patch("/{feedback_id}")
async def update_feedback_status(
    feedback_id: str,
    data: FeedbackStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Admins triage feedback: mark unreviewed / in progress / done."""
    if not is_org_admin(current_user):
        raise HTTPException(403, "Requires organization admin privileges.")
    if data.status not in _VALID_STATUSES:
        raise HTTPException(400, f"Invalid status. Must be one of {sorted(_VALID_STATUSES)}.")
    result = await db.execute(select(Feedback).where(Feedback.id == feedback_id))
    fb = result.scalar_one_or_none()
    if not fb:
        raise HTTPException(404, "Feedback not found.")
    fb.status = data.status
    await db.commit()
    return _dict(fb)

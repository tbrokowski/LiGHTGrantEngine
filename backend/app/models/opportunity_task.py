import uuid
from datetime import datetime, date

from sqlalchemy import String, Text, Date, DateTime, JSON, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class OpportunityTask(Base):
    """A task/deadline on an opportunity card, before it becomes a grant.

    Scoped like the shortlist board:
      scope='org'   -> owner_id is an institution_id; shared with the whole org.
      scope='user'  -> owner_id is a user_id; private to that user.

    A task with a due_date doubles as a "key date"; remind_days_before drives the
    daily reminder (org-scope -> Slack, user-scope -> in-app notification).
    """

    __tablename__ = "opportunity_tasks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    opportunity_id: Mapped[str] = mapped_column(
        String, ForeignKey("opportunities.id", ondelete="CASCADE"), nullable=False, index=True
    )
    scope: Mapped[str] = mapped_column(String(10), nullable=False)          # 'user' | 'org'
    owner_id: Mapped[str] = mapped_column(String, nullable=False, index=True)

    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    due_date: Mapped[date | None] = mapped_column(Date, index=True)
    status: Mapped[str] = mapped_column(String(20), default="open", nullable=False)  # open|in_progress|done
    assignee_ids: Mapped[list] = mapped_column(JSON, default=list)          # list of user ids
    remind_days_before: Mapped[list] = mapped_column(JSON, default=lambda: [7, 3, 1, 0])

    created_by_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class OpportunityNote(Base):
    """A free-text note on an opportunity card (multiple, team- or user-scoped)."""

    __tablename__ = "opportunity_notes"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    opportunity_id: Mapped[str] = mapped_column(
        String, ForeignKey("opportunities.id", ondelete="CASCADE"), nullable=False, index=True
    )
    scope: Mapped[str] = mapped_column(String(10), nullable=False)
    owner_id: Mapped[str] = mapped_column(String, nullable=False, index=True)

    body: Mapped[str] = mapped_column(Text, nullable=False)

    created_by_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class OpportunityLink(Base):
    """A labeled external link attached to an opportunity card."""

    __tablename__ = "opportunity_links"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    opportunity_id: Mapped[str] = mapped_column(
        String, ForeignKey("opportunities.id", ondelete="CASCADE"), nullable=False, index=True
    )
    scope: Mapped[str] = mapped_column(String(10), nullable=False)
    owner_id: Mapped[str] = mapped_column(String, nullable=False, index=True)

    label: Mapped[str] = mapped_column(String(300), nullable=False)
    url: Mapped[str] = mapped_column(String(2000), nullable=False)

    created_by_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

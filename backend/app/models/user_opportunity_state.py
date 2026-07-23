from datetime import datetime

from sqlalchemy import Boolean, String, DateTime, ForeignKey, JSON, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class UserOpportunityState(Base):
    """All per-user interactions with an opportunity in one row.

    Consolidates the former user_shortlists table (saved_at replaces it).
    user_shortlists is kept in the DB for backwards compatibility; new saves
    are written here only.
    """

    __tablename__ = "user_opportunity_states"

    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), primary_key=True)
    opportunity_id: Mapped[str] = mapped_column(String, ForeignKey("opportunities.id"), primary_key=True)

    # Tracking
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Personal save (replaces user_shortlists)
    saved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Personal organisation
    pinned: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    personal_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    personal_tags: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")

    # Which shortlist-board lane this saved opportunity sits in (My Shortlist).
    # Null → rendered in the fit-score-derived default lane.
    shortlist_category_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("shortlist_categories.id", ondelete="SET NULL"), nullable=True
    )

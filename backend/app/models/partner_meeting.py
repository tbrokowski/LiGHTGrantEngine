import uuid
from datetime import datetime

from sqlalchemy import String, Integer, Boolean, DateTime, Text, JSON, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class PartnerMeeting(Base):
    __tablename__ = "partner_meetings"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    partner_id: Mapped[str] = mapped_column(String, ForeignKey("partners.id", ondelete="CASCADE"), nullable=False, index=True)
    institution_id: Mapped[str] = mapped_column(String, ForeignKey("institutions.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=60)
    location: Mapped[str | None] = mapped_column(String(500))
    meeting_type: Mapped[str] = mapped_column(String(50), default="video")

    # Structured content
    agenda: Mapped[list] = mapped_column(JSON, default=list)
    notes: Mapped[str | None] = mapped_column(Text)
    action_items: Mapped[list] = mapped_column(JSON, default=list)
    attendees: Mapped[list] = mapped_column(JSON, default=list)

    # Optional grant context
    grant_context_entity_type: Mapped[str | None] = mapped_column(String(50))
    grant_context_entity_id: Mapped[str | None] = mapped_column(String)

    # AI meeting prep
    meeting_prep: Mapped[str | None] = mapped_column(Text)
    meeting_prep_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Reminder
    reminder_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reminder_sent: Mapped[bool] = mapped_column(Boolean, default=False)

    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    partner: Mapped["Partner"] = relationship("Partner", back_populates="meetings")  # type: ignore
    reminders: Mapped[list["PartnerReminder"]] = relationship("PartnerReminder", back_populates="meeting", cascade="all, delete-orphan")  # type: ignore

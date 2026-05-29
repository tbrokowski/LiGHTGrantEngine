import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, Text, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class PartnerReminder(Base):
    __tablename__ = "partner_reminders"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    partner_id: Mapped[str] = mapped_column(String, ForeignKey("partners.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False, index=True)
    institution_id: Mapped[str] = mapped_column(String, ForeignKey("institutions.id"), nullable=False)

    # follow_up / meeting_prep / deadline_approaching / custom
    reminder_type: Mapped[str] = mapped_column(String(50), default="follow_up")
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    scheduled_for: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)

    meeting_id: Mapped[str | None] = mapped_column(String, ForeignKey("partner_meetings.id"), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    partner: Mapped["Partner"] = relationship("Partner", back_populates="reminders")  # type: ignore
    meeting: Mapped["PartnerMeeting | None"] = relationship("PartnerMeeting", back_populates="reminders")  # type: ignore

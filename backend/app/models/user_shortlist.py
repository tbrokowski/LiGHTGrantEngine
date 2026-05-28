import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class UserShortlist(Base):
    """Per-user personal shortlist of opportunities."""

    __tablename__ = "user_shortlists"

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id"), primary_key=True
    )
    opportunity_id: Mapped[str] = mapped_column(
        String, ForeignKey("opportunities.id"), primary_key=True
    )
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

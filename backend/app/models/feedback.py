import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, Text, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Feedback(Base):
    """A user-submitted comment, concern, bug report or revision request.

    Every submission is persisted here (the running log) and also emailed to
    the feedback inbox (settings.feedback_email).
    """
    __tablename__ = "feedback"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"), index=True)
    user_email: Mapped[str | None] = mapped_column(String(300))
    user_name: Mapped[str | None] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(50), default="other")  # bug | concern | idea | revision | other
    message: Mapped[str] = mapped_column(Text, nullable=False)
    page_url: Mapped[str | None] = mapped_column(String(1000))
    user_agent: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(50), default="new")  # new | reviewed | resolved
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

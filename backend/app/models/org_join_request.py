import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import String, Text, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class JoinRequestStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class OrgJoinRequest(Base):
    __tablename__ = "org_join_requests"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    institution_id: Mapped[str] = mapped_column(String, ForeignKey("institutions.id"), nullable=False, index=True)
    user_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"), nullable=True, index=True)
    email: Mapped[str] = mapped_column(String(300), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    message: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50), default=JoinRequestStatus.PENDING, index=True)
    reviewed_by_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    institution: Mapped["Institution"] = relationship("Institution", foreign_keys=[institution_id])  # type: ignore
    user: Mapped["User | None"] = relationship("User", foreign_keys=[user_id])  # type: ignore
    reviewed_by: Mapped["User | None"] = relationship("User", foreign_keys=[reviewed_by_id])  # type: ignore

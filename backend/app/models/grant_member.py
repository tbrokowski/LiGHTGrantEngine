import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import String, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class GrantMemberRole(str, Enum):
    OWNER = "owner"
    EDITOR = "editor"
    VIEWER = "viewer"


class GrantMemberStatus(str, Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"


class GrantMember(Base):
    __tablename__ = "grant_members"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    grant_id: Mapped[str] = mapped_column(String, ForeignKey("active_grants.id"), nullable=False, index=True)
    user_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"), index=True)
    email: Mapped[str] = mapped_column(String(300), nullable=False)
    role: Mapped[str] = mapped_column(String(50), default=GrantMemberRole.EDITOR)
    status: Mapped[str] = mapped_column(String(50), default=GrantMemberStatus.ACCEPTED)
    invited_by_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User | None"] = relationship("User", foreign_keys=[user_id])  # type: ignore
    invited_by: Mapped["User | None"] = relationship("User", foreign_keys=[invited_by_id])  # type: ignore

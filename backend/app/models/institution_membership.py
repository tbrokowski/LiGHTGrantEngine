"""A user's membership in an organization.

A user can belong to several organizations. This table is the source of truth;
the `institution_id` / `institution_role` / `role` / `module_permissions`
columns on `users` mirror whichever membership is currently *active*, so the
rest of the app can keep reading `current_user.institution_id`. Always change
memberships through `app.services.membership`, which keeps the two in sync.
"""
import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, ForeignKey, JSON, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class InstitutionMembership(Base):
    __tablename__ = "institution_memberships"
    __table_args__ = (UniqueConstraint("user_id", "institution_id", name="uq_membership_user_institution"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    institution_id: Mapped[str] = mapped_column(
        String, ForeignKey("institutions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    institution_role: Mapped[str] = mapped_column(String(50), nullable=False, default="member")
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="contributor")
    module_permissions: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
    # "signup" | "code" | "invite" | "request" | "created" | "admin" | "backfill"
    joined_via: Mapped[str | None] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

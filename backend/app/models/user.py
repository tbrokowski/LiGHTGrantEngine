import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import String, Boolean, DateTime, JSON, ForeignKey, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class UserRole(str, Enum):
    ADMIN = "admin"
    GRANT_LEAD = "grant_lead"
    OPERATIONS_MANAGER = "operations_manager"
    REVIEWER = "reviewer"
    CONTRIBUTOR = "contributor"
    VIEWER = "viewer"


class InstitutionRole(str, Enum):
    ADMIN = "admin"
    MEMBER = "member"


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[str] = mapped_column(String(300), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str | None] = mapped_column(String(300), nullable=True)
    role: Mapped[str] = mapped_column(String(50), default=UserRole.REVIEWER)
    team: Mapped[str | None] = mapped_column(String(200))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    notification_preferences: Mapped[dict] = mapped_column(JSON, default=dict)
    grant_preferences: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Institution membership
    institution_id: Mapped[str | None] = mapped_column(String, ForeignKey("institutions.id"), index=True)
    institution_role: Mapped[str] = mapped_column(String(50), default=InstitutionRole.MEMBER)
    # Onboarding & verification
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    email_verification_token: Mapped[str | None] = mapped_column(String(200), nullable=True)
    onboarding_complete: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    # AI billing (personal usage only)
    ai_usage_cents: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    ai_usage_limit_cents: Mapped[int] = mapped_column(Integer, default=300, server_default="300", nullable=False)
    # Google OAuth
    google_access_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    google_refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    google_token_expiry: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

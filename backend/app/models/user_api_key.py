import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class UserApiKey(Base):
    """A user's own API key for an LLM provider (openai | anthropic | google).

    Stored encrypted at rest. When a user runs grant writing, their key for the
    resolved provider is used in preference to the system key.
    """
    __tablename__ = "user_api_keys"
    __table_args__ = (UniqueConstraint("user_id", "provider", name="uq_user_provider_key"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(30), nullable=False)  # openai | anthropic | google
    encrypted_key: Mapped[str] = mapped_column(String(2000), nullable=False)
    label: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

import uuid
from datetime import datetime

from sqlalchemy import String, Integer, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class LLMUsage(Base):
    """One row per LLM call made during a tracked run (grant writing), for
    per-provider/model usage + cost reporting."""
    __tablename__ = "llm_usage"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"), index=True)
    grant_id: Mapped[str | None] = mapped_column(String, index=True)
    provider: Mapped[str] = mapped_column(String(30), nullable=False)
    model: Mapped[str] = mapped_column(String(80), nullable=False)
    agent: Mapped[str | None] = mapped_column(String(80))
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_cents: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

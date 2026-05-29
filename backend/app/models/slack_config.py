import uuid
from datetime import datetime

from sqlalchemy import String, Boolean, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class SlackGrantConfig(Base):
    """Slack channel linked to an active grant for fund request approvals."""
    __tablename__ = "slack_grant_configs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    grant_id: Mapped[str] = mapped_column(String, ForeignKey("active_grants.id"), nullable=False, unique=True, index=True)
    slack_team_id: Mapped[str | None] = mapped_column(String(50))
    slack_channel_id: Mapped[str] = mapped_column(String(50), nullable=False)
    slack_channel_name: Mapped[str | None] = mapped_column(String(200))
    slack_bot_token: Mapped[str | None] = mapped_column(String(500))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

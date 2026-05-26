import uuid
from datetime import datetime

from sqlalchemy import String, Boolean, DateTime, JSON, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Institution(Base):
    __tablename__ = "institutions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    domain: Mapped[str | None] = mapped_column(String(200))  # e.g. "epfl.ch" for auto-join
    access_code: Mapped[str | None] = mapped_column(String(20))
    access_code_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_personal: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false", index=True)
    grant_profile: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

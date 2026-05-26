from datetime import datetime

from sqlalchemy import String, Boolean, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class InstitutionSource(Base):
    """Org-level subscription to a global source (enabled/disabled per institution)."""

    __tablename__ = "institution_sources"

    institution_id: Mapped[str] = mapped_column(
        String, ForeignKey("institutions.id"), primary_key=True
    )
    source_id: Mapped[str] = mapped_column(
        String, ForeignKey("sources.id"), primary_key=True
    )
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

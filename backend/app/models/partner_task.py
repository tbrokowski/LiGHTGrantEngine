import uuid
from datetime import datetime

from sqlalchemy import String, Text, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship as orm_relationship

from app.database import Base


class PartnerTask(Base):
    __tablename__ = "partner_tasks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    partner_id: Mapped[str] = mapped_column(String, ForeignKey("partners.id", ondelete="CASCADE"), nullable=False, index=True)
    institution_id: Mapped[str | None] = mapped_column(String, ForeignKey("institutions.id"), nullable=True)

    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    # low / normal / high / urgent
    priority: Mapped[str] = mapped_column(String(20), default="normal")
    # open / in_progress / done / cancelled
    status: Mapped[str] = mapped_column(String(20), default="open", index=True)

    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    assigned_to: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"), index=True)
    created_by: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    partner: Mapped["Partner"] = orm_relationship("Partner", back_populates="tasks")  # type: ignore

import uuid
from datetime import datetime, date
from enum import Enum

from sqlalchemy import String, DateTime, Date, Text, Integer, Boolean, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ChecklistStatus(str, Enum):
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    COMPLETE = "complete"
    NOT_APPLICABLE = "not_applicable"
    BLOCKED = "blocked"


class ChecklistCategory(str, Enum):
    NARRATIVE = "narrative"
    BUDGET = "budget"
    LETTERS = "letters"
    CVS = "cvs"
    INSTITUTIONAL_APPROVALS = "institutional_approvals"
    ETHICS = "ethics"
    DATA_MANAGEMENT = "data_management"
    FORMATTING = "formatting"
    SUBMISSION_PORTAL = "submission_portal"
    PARTNER_MATERIALS = "partner_materials"
    COMPLIANCE = "compliance"
    SIGNATURES = "signatures"
    GENERAL = "general"


class ChecklistItem(Base):
    __tablename__ = "checklist_items"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    grant_id: Mapped[str] = mapped_column(String, ForeignKey("active_grants.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(100), default=ChecklistCategory.GENERAL)
    required: Mapped[bool] = mapped_column(Boolean, default=True)
    owner_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    due_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(50), default=ChecklistStatus.NOT_STARTED)
    linked_document_url: Mapped[str | None] = mapped_column(String(1000))
    evidence_url: Mapped[str | None] = mapped_column(String(1000))
    notes: Mapped[str | None] = mapped_column(Text)
    display_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

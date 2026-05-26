import uuid
from datetime import datetime, date
from enum import Enum

from sqlalchemy import String, DateTime, Date, Text, Integer, Float, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class WorkspaceSectionStatus(str, Enum):
    NOT_STARTED = "not_started"
    OUTLINE_CREATED = "outline_created"
    DRAFTING = "drafting"
    NEEDS_INPUT = "needs_input"
    NEEDS_REVIEW = "needs_review"
    REVISING = "revising"
    APPROVED = "approved"
    FINALIZED = "finalized"
    SUBMITTED = "submitted"


class WorkspaceSection(Base):
    __tablename__ = "workspace_sections"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    grant_id: Mapped[str] = mapped_column(String, ForeignKey("active_grants.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    section_type: Mapped[str] = mapped_column(String(100), default="other")
    requirement_text: Mapped[str | None] = mapped_column(Text)
    word_limit: Mapped[int | None] = mapped_column(Integer)
    page_limit: Mapped[float | None] = mapped_column(Float)
    owner_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    reviewer_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(50), default=WorkspaceSectionStatus.NOT_STARTED)
    due_date: Mapped[date | None] = mapped_column(Date)
    linked_document_url: Mapped[str | None] = mapped_column(String(1000))
    current_word_count: Mapped[int] = mapped_column(Integer, default=0)
    compliance_status: Mapped[str] = mapped_column(String(50), default="unchecked")
    notes: Mapped[str | None] = mapped_column(Text)
    display_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

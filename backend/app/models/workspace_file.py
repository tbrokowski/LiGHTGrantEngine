import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import String, DateTime, Text, Boolean, JSON, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class FileCategory(str, Enum):
    CALL_DOCUMENTS = "call_documents"
    GUIDANCE_DOCUMENTS = "guidance_documents"
    PROPOSAL_DRAFTS = "proposal_drafts"
    FINAL_PROPOSAL = "final_proposal"
    BUDGET = "budget"
    BUDGET_JUSTIFICATION = "budget_justification"
    LETTERS_OF_SUPPORT = "letters_of_support"
    CVS_BIOSKETCHES = "cvs_biosketches"
    PARTNER_DOCUMENTS = "partner_documents"
    INSTITUTIONAL_DOCUMENTS = "institutional_documents"
    TEMPLATES = "templates"
    LOGOS = "logos"
    FIGURES = "figures"
    REFERENCES = "references"
    SUBMISSION_CONFIRMATION = "submission_confirmation"
    AWARD_REJECTION = "award_rejection"
    OTHER = "other"


class FileSourceType(str, Enum):
    UPLOADED = "uploaded"
    GOOGLE_DRIVE = "google_drive"
    EXTERNAL_URL = "external_url"
    TEMPLATE = "template"
    PARTNER_PROVIDED = "partner_provided"
    AI_GENERATED = "ai_generated"


class WorkspaceFile(Base):
    __tablename__ = "workspace_files"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    grant_id: Mapped[str] = mapped_column(String, ForeignKey("active_grants.id"), nullable=False, index=True)
    file_name: Mapped[str] = mapped_column(String(500), nullable=False)
    file_type: Mapped[str | None] = mapped_column(String(100))
    file_category: Mapped[str] = mapped_column(String(100), default=FileCategory.OTHER)
    file_url: Mapped[str] = mapped_column(String(1000), nullable=False)
    source_type: Mapped[str] = mapped_column(String(50), default=FileSourceType.UPLOADED)
    version: Mapped[str] = mapped_column(String(50), default="1")
    owner_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    access_level: Mapped[str] = mapped_column(String(50), default="team")
    ai_retrieval_allowed: Mapped[bool] = mapped_column(Boolean, default=True)
    description: Mapped[str | None] = mapped_column(Text)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    related_task_id: Mapped[str | None] = mapped_column(String, ForeignKey("tasks.id"))
    related_section_id: Mapped[str | None] = mapped_column(String, ForeignKey("workspace_sections.id"))
    uploaded_by: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import String, Boolean, DateTime, Integer, Text, JSON, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from pgvector.sqlalchemy import Vector

from app.database import Base


class DocumentType(str, Enum):
    CALL_DOCUMENT = "call_document"
    GUIDANCE_NOTES = "guidance_notes"
    FAQ = "faq"
    CONCEPT_NOTE = "concept_note"
    FULL_PROPOSAL = "full_proposal"
    BUDGET = "budget"
    BUDGET_JUSTIFICATION = "budget_justification"
    REVIEW_FEEDBACK = "review_feedback"
    AWARD_LETTER = "award_letter"
    REJECTION_LETTER = "rejection_letter"
    PARTNER_LETTER = "partner_letter"
    INSTITUTIONAL_LETTER = "institutional_letter"
    CV_BIOSKETCH = "cv_biosketch"
    ETHICS_ATTACHMENT = "ethics_attachment"
    DATA_MANAGEMENT_PLAN = "data_management_plan"
    MEL_PLAN = "mel_plan"
    THEORY_OF_CHANGE = "theory_of_change"
    SUBMISSION_CONFIRMATION = "submission_confirmation"
    INTERNAL_NOTES = "internal_notes"
    OTHER = "other"


class ProcessingStatus(str, Enum):
    NOT_PROCESSED = "not_processed"
    PROCESSING = "processing"
    PROCESSED = "processed"
    FAILED = "failed"
    NEEDS_MANUAL_REVIEW = "needs_manual_review"
    RESTRICTED = "restricted"


class AccessLevel(str, Enum):
    PUBLIC_INTERNAL = "public_internal"
    TEAM_ONLY = "team_only"
    GRANT_TEAM_ONLY = "grant_team_only"
    PI_ONLY = "pi_only"
    RESTRICTED_BUDGET = "restricted_budget"
    ADMIN_ONLY = "admin_only"


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    opportunity_id: Mapped[str | None] = mapped_column(String, ForeignKey("opportunities.id"))
    grant_id: Mapped[str | None] = mapped_column(String, ForeignKey("active_grants.id"))
    archive_id: Mapped[str | None] = mapped_column(String, ForeignKey("grant_archives.id"))

    document_type: Mapped[str] = mapped_column(String(100), default=DocumentType.OTHER)
    file_name: Mapped[str | None] = mapped_column(String(500))
    file_url: Mapped[str | None] = mapped_column(String(1000))
    file_format: Mapped[str | None] = mapped_column(String(50))
    version: Mapped[str | None] = mapped_column(String(50))
    uploaded_by_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    parsed_text: Mapped[str | None] = mapped_column(Text)
    processing_status: Mapped[str] = mapped_column(String(50), default=ProcessingStatus.NOT_PROCESSED)
    access_level: Mapped[str] = mapped_column(String(50), default=AccessLevel.TEAM_ONLY)
    ai_retrieval_allowed: Mapped[bool] = mapped_column(Boolean, default=True)
    text_reuse_allowed: Mapped[bool] = mapped_column(Boolean, default=False)
    last_parsed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)

    # Word files (.docx) on a grant are edited in place in the OnlyOffice
    # Document Server (see routers/grant_word_docs.py). `oo_doc_key` names the
    # live co-editing session and rotates whenever a new file replaces the
    # stored one; `oo_session_users` is who has it open in the app right now.
    edit_version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    oo_doc_key: Mapped[str | None] = mapped_column(String(128))
    oo_session_users: Mapped[list | None] = mapped_column(JSON)
    last_edited_by_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id", ondelete="SET NULL"))
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # A Google Docs copy, made from the user's Drive with their token. The app's
    # file stays the source of truth: the copy is pushed to before it opens and
    # pulled from when it was edited since `google_synced_at`.
    google_file_id: Mapped[str | None] = mapped_column(String(200))
    google_file_url: Mapped[str | None] = mapped_column(String(1000))
    google_owner_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id", ondelete="SET NULL"))
    google_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    google_synced_version: Mapped[int | None] = mapped_column(Integer)

    # Vector embedding
    embedding: Mapped[list | None] = mapped_column(Vector(1536), nullable=True)

    opportunity: Mapped["Opportunity"] = relationship("Opportunity", back_populates="documents")  # type: ignore
    grant: Mapped["ActiveGrant"] = relationship("ActiveGrant", back_populates="documents")  # type: ignore
    sections: Mapped[list["ProposalSection"]] = relationship("ProposalSection", back_populates="document")  # type: ignore


class DocumentVersion(Base):
    """A saved snapshot of an edited Word document. Version 1 is the upload;
    `source` says where each later one came from (editor | google)."""
    __tablename__ = "document_versions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    document_id: Mapped[str] = mapped_column(String, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_key: Mapped[str] = mapped_column(String(1000), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    source: Mapped[str] = mapped_column(String(20), default="editor")
    created_by: Mapped[str | None] = mapped_column(String, ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

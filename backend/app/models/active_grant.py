import uuid
from datetime import datetime, date
from enum import Enum

from sqlalchemy import String, Float, Boolean, DateTime, Date, Text, JSON, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ActiveGrantStatus(str, Enum):
    SCOPING = "scoping"
    GO_NO_GO_PENDING = "go_no_go_pending"
    CONCEPT_NOTE_DRAFTING = "concept_note_drafting"
    FULL_PROPOSAL_DRAFTING = "full_proposal_drafting"
    BUDGET_DRAFTING = "budget_drafting"
    PARTNER_CONFIRMATION = "partner_confirmation"
    INTERNAL_REVIEW = "internal_review"
    PI_REVIEW = "pi_review"
    INSTITUTIONAL_APPROVAL = "institutional_approval"
    READY_FOR_SUBMISSION = "ready_for_submission"
    SUBMITTED = "submitted"
    UNDER_REVIEW = "under_review"
    AWARDED = "awarded"
    REJECTED = "rejected"
    DEFERRED = "deferred"
    WITHDRAWN = "withdrawn"
    CLOSED = "closed"


class GrantStage(str, Enum):
    """High-level pipeline stage — drives which sub-tab the grant appears under."""
    PROPOSAL = "proposal"      # Being written
    PENDING = "pending"        # Submitted, awaiting decision
    ACTIVE = "active"          # Funded / awarded
    REJECTED = "rejected"      # Rejected outcome
    ARCHIVED = "archived"      # Completed / closed


class ActiveGrant(Base):
    __tablename__ = "active_grants"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    opportunity_id: Mapped[str | None] = mapped_column(String, ForeignKey("opportunities.id"))

    # Org scoping
    institution_id: Mapped[str | None] = mapped_column(String, ForeignKey("institutions.id"), index=True)
    created_by_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"), index=True)
    is_personal: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false", index=True)

    # Core info
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    funder: Mapped[str | None] = mapped_column(String(300))
    program: Mapped[str | None] = mapped_column(String(300))
    call_url: Mapped[str | None] = mapped_column(String(1000))

    # Team
    internal_lead_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    pi_name: Mapped[str | None] = mapped_column(String(200))
    co_pis: Mapped[list] = mapped_column(JSON, default=list)
    proposal_team: Mapped[list] = mapped_column(JSON, default=list)
    partner_institutions: Mapped[list] = mapped_column(JSON, default=list)

    # Deadlines
    external_deadline: Mapped[date | None] = mapped_column(Date, index=True)
    internal_deadline: Mapped[date | None] = mapped_column(Date)
    concept_note_deadline: Mapped[date | None] = mapped_column(Date)
    budget_deadline: Mapped[date | None] = mapped_column(Date)
    partner_doc_deadline: Mapped[date | None] = mapped_column(Date)

    # Links
    submission_portal_url: Mapped[str | None] = mapped_column(String(1000))
    drive_folder_url: Mapped[str | None] = mapped_column(String(1000))
    proposal_draft_url: Mapped[str | None] = mapped_column(String(1000))
    budget_url: Mapped[str | None] = mapped_column(String(1000))
    letters_folder_url: Mapped[str | None] = mapped_column(String(1000))
    partner_docs_url: Mapped[str | None] = mapped_column(String(1000))
    final_package_url: Mapped[str | None] = mapped_column(String(1000))

    # Status & financials
    status: Mapped[str] = mapped_column(String(50), default=ActiveGrantStatus.SCOPING, index=True)
    priority: Mapped[str | None] = mapped_column(String(50))
    requested_amount: Mapped[float | None] = mapped_column(Float)
    currency: Mapped[str | None] = mapped_column(String(10))
    project_duration: Mapped[str | None] = mapped_column(String(100))
    themes: Mapped[list] = mapped_column(JSON, default=list)
    geographies: Mapped[list] = mapped_column(JSON, default=list)
    submission_type: Mapped[str | None] = mapped_column(String(100))

    # Outcome
    decision_outcome: Mapped[str | None] = mapped_column(String(100))
    award_amount: Mapped[float | None] = mapped_column(Float)

    notes: Mapped[str | None] = mapped_column(Text)

    # Live editor: stores {section_id: {title, section_type, content_html, content_text, word_count, order}}
    editor_sections: Mapped[dict] = mapped_column(JSON, default=dict)
    # Unified single-document HTML (replaces multi-section editor)
    editor_document: Mapped[str | None] = mapped_column(Text)
    # Free-form call requirements text used as RAG/AI context
    call_requirements: Mapped[str | None] = mapped_column(Text)

    # Grant writing studio session state
    grant_idea: Mapped[str | None] = mapped_column(Text)
    call_analysis: Mapped[dict] = mapped_column(JSON, default=dict)
    proposal_skeleton: Mapped[dict] = mapped_column(JSON, default=dict)
    style_profile: Mapped[dict] = mapped_column(JSON, default=dict)
    writing_phase: Mapped[str] = mapped_column(String(30), default="idea")
    last_review: Mapped[dict] = mapped_column(JSON, default=dict)
    # Google Docs sync
    google_doc_id: Mapped[str | None] = mapped_column(String(100))
    google_doc_url: Mapped[str | None] = mapped_column(String(1000))
    google_doc_last_synced: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Pipeline stage (drives Proposals / Pending / Active sub-tabs)
    grant_stage: Mapped[str] = mapped_column(String(30), default="proposal", server_default="proposal", nullable=False, index=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    stage_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    reporting_deadlines: Mapped[list] = mapped_column(JSON, default=list)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    tasks: Mapped[list["Task"]] = relationship("Task", back_populates="grant")  # type: ignore
    documents: Mapped[list["Document"]] = relationship("Document", back_populates="grant")  # type: ignore

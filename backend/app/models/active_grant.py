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


class ActiveGrant(Base):
    __tablename__ = "active_grants"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    opportunity_id: Mapped[str | None] = mapped_column(String, ForeignKey("opportunities.id"))

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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    tasks: Mapped[list["Task"]] = relationship("Task", back_populates="grant")  # type: ignore
    documents: Mapped[list["Document"]] = relationship("Document", back_populates="grant")  # type: ignore

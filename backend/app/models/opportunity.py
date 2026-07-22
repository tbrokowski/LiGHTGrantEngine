import uuid
from datetime import datetime, date
from enum import Enum

from sqlalchemy import String, Float, Integer, Boolean, DateTime, Date, Text, JSON, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from pgvector.sqlalchemy import Vector

from app.database import Base


class OpportunityType(str, Enum):
    GRANT = "grant"
    FELLOWSHIP = "fellowship"
    SCHOLARSHIP = "scholarship"
    RESIDENCY = "residency"
    OPEN_CALL = "open_call"
    PRIZE = "prize"
    BURSARY = "bursary"
    COMMISSION = "commission"
    OTHER = "other"


class OpportunityStatus(str, Enum):
    NEW = "new"
    NEEDS_REVIEW = "needs_review"
    IN_REVIEW = "in_review"
    WATCHING = "watching"
    POTENTIAL_FIT = "potential_fit"
    HIGH_PRIORITY = "high_priority"
    ACTIVELY_PURSUING = "actively_pursuing"
    REJECTED = "rejected"
    DUPLICATE = "duplicate"
    ARCHIVED = "archived"


# ReviewStatus was identical to OpportunityStatus — use OpportunityStatus everywhere.
# Kept as alias for backwards compatibility with any existing imports.
ReviewStatus = OpportunityStatus


class DuplicateStatus(str, Enum):
    UNIQUE = "unique"
    POSSIBLE_DUPLICATE = "possible_duplicate"
    CONFIRMED_DUPLICATE = "confirmed_duplicate"
    UPDATED_VERSION = "updated_version"


class Opportunity(Base):
    __tablename__ = "opportunities"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))

    # Core identification
    title: Mapped[str] = mapped_column(String(500), nullable=False, index=True)
    funder: Mapped[str | None] = mapped_column(String(300), index=True)
    program_name: Mapped[str | None] = mapped_column(String(300))
    opportunity_number: Mapped[str | None] = mapped_column(String(200))
    source_id: Mapped[str | None] = mapped_column(String, ForeignKey("sources.id"))
    source_url: Mapped[str | None] = mapped_column(String(1000))
    opportunity_url: Mapped[str | None] = mapped_column(String(1000))
    # The funding body itself (e.g. "Fulbright") — distinct from source_id,
    # which is the scraper portal this opportunity was discovered through.
    funder_org_id: Mapped[str | None] = mapped_column(String, ForeignKey("funder_orgs.id"))

    # Description
    description: Mapped[str | None] = mapped_column(Text)
    short_summary: Mapped[str | None] = mapped_column(Text)
    ai_summary: Mapped[str | None] = mapped_column(Text)

    # Deadlines
    deadline: Mapped[date | None] = mapped_column(Date, index=True)
    opening_date: Mapped[date | None] = mapped_column(Date)
    loi_deadline: Mapped[date | None] = mapped_column(Date)
    concept_note_deadline: Mapped[date | None] = mapped_column(Date)
    full_proposal_deadline: Mapped[date | None] = mapped_column(Date)

    # Financials
    award_min: Mapped[float | None] = mapped_column(Float)
    award_max: Mapped[float | None] = mapped_column(Float)
    currency: Mapped[str | None] = mapped_column(String(10))
    total_funding_envelope: Mapped[float | None] = mapped_column(Float)
    expected_awards: Mapped[int | None] = mapped_column(Integer)
    project_duration: Mapped[str | None] = mapped_column(String(100))

    # Eligibility
    eligibility_criteria: Mapped[str | None] = mapped_column(Text)
    institutional_eligibility: Mapped[str | None] = mapped_column(Text)
    pi_eligibility: Mapped[str | None] = mapped_column(Text)
    geographic_eligibility: Mapped[str | None] = mapped_column(Text)
    partner_requirements: Mapped[str | None] = mapped_column(Text)
    cost_sharing_requirements: Mapped[str | None] = mapped_column(Text)
    indirect_cost_rules: Mapped[str | None] = mapped_column(Text)
    allowed_countries: Mapped[list] = mapped_column(JSON, default=list)
    excluded_countries: Mapped[list] = mapped_column(JSON, default=list)
    clinical_trial_allowed: Mapped[bool | None] = mapped_column(Boolean)

    # Classification
    opportunity_type: Mapped[str | None] = mapped_column(String(50), index=True)
    thematic_areas: Mapped[list] = mapped_column(JSON, default=list)
    keywords: Mapped[list] = mapped_column(JSON, default=list)
    geography: Mapped[list] = mapped_column(JSON, default=list)
    funding_mechanism: Mapped[str | None] = mapped_column(String(100))
    submission_type: Mapped[str | None] = mapped_column(String(100))
    trl_level: Mapped[str | None] = mapped_column(String(50))

    # Submission
    submission_portal: Mapped[str | None] = mapped_column(String(500))
    required_documents: Mapped[list] = mapped_column(JSON, default=list)
    evaluation_criteria: Mapped[str | None] = mapped_column(Text)
    page_limit: Mapped[int | None] = mapped_column(Integer)
    word_limit: Mapped[int | None] = mapped_column(Integer)
    language_requirements: Mapped[str | None] = mapped_column(String(100))
    data_sharing_requirements: Mapped[str | None] = mapped_column(Text)
    open_science_requirements: Mapped[str | None] = mapped_column(Text)
    ethics_requirements: Mapped[str | None] = mapped_column(Text)
    reporting_requirements: Mapped[str | None] = mapped_column(Text)
    contact_information: Mapped[str | None] = mapped_column(Text)

    # Links
    prior_winners_link: Mapped[str | None] = mapped_column(String(1000))
    faq_link: Mapped[str | None] = mapped_column(String(1000))
    guidance_doc_link: Mapped[str | None] = mapped_column(String(1000))

    # Scoring & status
    fit_score: Mapped[float | None] = mapped_column(Float, index=True)
    fit_rationale: Mapped[str | None] = mapped_column(Text)
    priority: Mapped[str | None] = mapped_column(String(50))
    status: Mapped[str] = mapped_column(String(50), default=OpportunityStatus.NEW, index=True)
    duplicate_status: Mapped[str] = mapped_column(String(50), default=DuplicateStatus.UNIQUE)
    assigned_reviewer_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))

    # Funder logo
    funder_logo_url: Mapped[str | None] = mapped_column(String(500))

    # Raw text
    raw_text: Mapped[str | None] = mapped_column(Text)
    parsed_text: Mapped[str | None] = mapped_column(Text)

    # Vector embedding for semantic search
    embedding: Mapped[list | None] = mapped_column(Vector(1536), nullable=True)

    # Cluster assignment for graph view
    cluster_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("opportunity_clusters.id"), nullable=True, index=True)

    # UMAP 2D layout coordinates (set by clustering task)
    umap_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    umap_y: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Metadata
    date_discovered: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    date_updated: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    notes: Mapped[str | None] = mapped_column(Text)

    # Relationships
    reviews: Mapped[list["OpportunityReview"]] = relationship("OpportunityReview", back_populates="opportunity")
    documents: Mapped[list["Document"]] = relationship("Document", back_populates="opportunity")  # type: ignore


class RejectionReason(str, Enum):
    NOT_ELIGIBLE = "not_eligible"
    POOR_THEMATIC_FIT = "poor_thematic_fit"
    DEADLINE_TOO_SOON = "deadline_too_soon"
    BUDGET_TOO_SMALL = "budget_too_small"
    BUDGET_TOO_LARGE = "budget_too_large"
    UNSUITABLE_PARTNER = "unsuitable_partner"
    WRONG_GEOGRAPHY = "wrong_geography"
    WRONG_INSTITUTION_TYPE = "wrong_institution_type"
    LOW_PROBABILITY = "low_probability"
    NOT_STRATEGIC = "not_strategic"
    DUPLICATE = "duplicate"
    ALREADY_PURSUED = "already_pursued"
    INSUFFICIENT_CAPACITY = "insufficient_capacity"
    DEFERRED = "deferred"


class OpportunityReview(Base):
    __tablename__ = "opportunity_reviews"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    opportunity_id: Mapped[str] = mapped_column(String, ForeignKey("opportunities.id"), nullable=False, index=True)
    reviewer_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    review_status: Mapped[str] = mapped_column(String(50))
    recommendation: Mapped[str | None] = mapped_column(String(50))
    fit_comments: Mapped[str | None] = mapped_column(Text)
    eligibility_comments: Mapped[str | None] = mapped_column(Text)
    risk_notes: Mapped[str | None] = mapped_column(Text)
    decision: Mapped[str | None] = mapped_column(String(50))
    decision_reason: Mapped[str | None] = mapped_column(String(100))
    follow_up_actions: Mapped[str | None] = mapped_column(Text)
    review_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    opportunity: Mapped["Opportunity"] = relationship("Opportunity", back_populates="reviews")

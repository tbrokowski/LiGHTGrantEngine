import uuid
from datetime import datetime, date
from enum import Enum

from sqlalchemy import String, Float, Boolean, DateTime, Date, Text, JSON, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ArchiveOutcome(str, Enum):
    AWARDED = "awarded"
    REJECTED = "rejected"
    PENDING = "pending"
    WITHDRAWN = "withdrawn"
    DEFERRED = "deferred"
    NOT_SUBMITTED = "not_submitted"
    RESUBMITTED = "resubmitted"
    PARTIALLY_FUNDED = "partially_funded"


class GrantArchive(Base):
    __tablename__ = "grant_archives"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    opportunity_id: Mapped[str | None] = mapped_column(String, ForeignKey("opportunities.id"))
    grant_id: Mapped[str | None] = mapped_column(String, ForeignKey("active_grants.id"))

    title: Mapped[str] = mapped_column(String(500), nullable=False)
    funder: Mapped[str | None] = mapped_column(String(300), index=True)
    program: Mapped[str | None] = mapped_column(String(300))
    call_year: Mapped[int | None] = mapped_column()
    submission_cycle: Mapped[str | None] = mapped_column(String(100))

    lead_pi: Mapped[str | None] = mapped_column(String(200))
    co_pis: Mapped[list] = mapped_column(JSON, default=list)
    team_members: Mapped[list] = mapped_column(JSON, default=list)
    partner_institutions: Mapped[list] = mapped_column(JSON, default=list)

    themes: Mapped[list] = mapped_column(JSON, default=list)
    geographies: Mapped[list] = mapped_column(JSON, default=list)

    submitted: Mapped[bool] = mapped_column(Boolean, default=False)
    submission_date: Mapped[date | None] = mapped_column(Date)
    outcome: Mapped[str | None] = mapped_column(String(50))
    decision_date: Mapped[date | None] = mapped_column(Date)

    requested_amount: Mapped[float | None] = mapped_column(Float)
    awarded_amount: Mapped[float | None] = mapped_column(Float)
    currency: Mapped[str | None] = mapped_column(String(10))
    project_duration: Mapped[str | None] = mapped_column(String(100))

    repository_folder_url: Mapped[str | None] = mapped_column(String(1000))
    access_level: Mapped[str] = mapped_column(String(50), default="team_only")
    ai_retrieval_allowed: Mapped[bool] = mapped_column(Boolean, default=True)
    text_reuse_allowed: Mapped[bool] = mapped_column(Boolean, default=False)

    lessons_learned: Mapped[str | None] = mapped_column(Text)
    internal_debrief: Mapped[str | None] = mapped_column(Text)
    reviewer_feedback: Mapped[str | None] = mapped_column(Text)

    notes: Mapped[str | None] = mapped_column(Text)

    document_structure: Mapped[list | None] = mapped_column(JSON, default=list)
    style_fingerprint: Mapped[dict | None] = mapped_column(JSON, default=dict)
    style_indexed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # pending | processing | complete | failed
    indexing_status: Mapped[str] = mapped_column(String(50), default="complete")
    indexing_error: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

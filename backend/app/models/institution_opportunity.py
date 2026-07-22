from datetime import datetime

from sqlalchemy import String, Float, DateTime, Text, JSON, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class InstitutionOpportunity(Base):
    """Links a global opportunity to an institution's surfaced feed.

    This is the canonical source for per-org fit scoring, workflow status,
    and reviewer assignment. The legacy fields on the global `opportunities`
    table (fit_score, priority, status) are kept for backwards compatibility
    but this table is the authoritative record.
    """

    __tablename__ = "institution_opportunities"

    institution_id: Mapped[str] = mapped_column(
        String, ForeignKey("institutions.id"), primary_key=True
    )
    opportunity_id: Mapped[str] = mapped_column(
        String, ForeignKey("opportunities.id"), primary_key=True
    )
    fit_score: Mapped[float | None] = mapped_column(Float, index=True)
    priority: Mapped[str | None] = mapped_column(String(50))
    fit_rationale: Mapped[str | None] = mapped_column(Text)
    matched_themes: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(50), default="needs_review", index=True)
    ai_summary: Mapped[str | None] = mapped_column(Text)
    # Reviewer assignment lives here (per-org), not on the global opportunity
    assigned_reviewer_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("users.id"), nullable=True
    )
    scored_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    surfaced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # Outcome tracking — distinct from `status` (workflow stage) and from a
    # past deadline (which just means the call closed, not that we won it).
    # One of: "awarded", "declined", "not_pursued", or null (no outcome yet).
    outcome: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    outcome_recorded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

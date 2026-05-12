import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, Text, JSON, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class FunderProfile(Base):
    __tablename__ = "funder_profiles"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(300), nullable=False, unique=True, index=True)
    website: Mapped[str | None] = mapped_column(String(1000))
    programs_tracked: Mapped[list] = mapped_column(JSON, default=list)
    themes: Mapped[list] = mapped_column(JSON, default=list)
    geographic_priorities: Mapped[list] = mapped_column(JSON, default=list)
    typical_award_min: Mapped[float | None] = mapped_column()
    typical_award_max: Mapped[float | None] = mapped_column()
    typical_duration: Mapped[str | None] = mapped_column(String(100))
    eligibility_notes: Mapped[str | None] = mapped_column(Text)
    indirect_cost_rules: Mapped[str | None] = mapped_column(Text)
    common_evaluation_criteria: Mapped[str | None] = mapped_column(Text)
    reviewer_feedback_patterns: Mapped[str | None] = mapped_column(Text)
    known_contacts: Mapped[list] = mapped_column(JSON, default=list)
    strategic_notes: Mapped[str | None] = mapped_column(Text)
    upcoming_cycles: Mapped[list] = mapped_column(JSON, default=list)
    relationship_owner_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    ai_generated_profile: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

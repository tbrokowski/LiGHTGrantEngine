import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import String, Boolean, DateTime, Integer, Text, JSON, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from pgvector.sqlalchemy import Vector

from app.database import Base


class SectionType(str, Enum):
    ABSTRACT = "abstract"
    EXECUTIVE_SUMMARY = "executive_summary"
    PROBLEM_STATEMENT = "problem_statement"
    BACKGROUND = "background"
    JUSTIFICATION = "justification"
    SPECIFIC_AIMS = "specific_aims"
    OBJECTIVES = "objectives"
    INNOVATION = "innovation"
    RESEARCH_PLAN = "research_plan"
    METHODS = "methods"
    IMPLEMENTATION_PLAN = "implementation_plan"
    WORK_PACKAGES = "work_packages"
    TIMELINE = "timeline"
    GOVERNANCE = "governance"
    TEAM_CAPACITY = "team_capacity"
    INSTITUTIONAL_ENVIRONMENT = "institutional_environment"
    PARTNERSHIPS = "partnerships"
    COMMUNITY_ENGAGEMENT = "community_engagement"
    MEL_EVALUATION = "mel_evaluation"
    THEORY_OF_CHANGE = "theory_of_change"
    ETHICS = "ethics"
    DATA_GOVERNANCE = "data_governance"
    RESPONSIBLE_AI = "responsible_ai"
    RISK_MITIGATION = "risk_mitigation"
    SUSTAINABILITY = "sustainability"
    SCALE_UP = "scale_up"
    POLICY_TRANSLATION = "policy_translation"
    BUDGET_JUSTIFICATION = "budget_justification"
    IMPACT_STATEMENT = "impact_statement"
    DISSEMINATION = "dissemination"
    OPEN_SCIENCE = "open_science"
    LETTERS_OF_SUPPORT = "letters_of_support"
    OTHER = "other"


class ProposalSection(Base):
    __tablename__ = "proposal_sections"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    document_id: Mapped[str | None] = mapped_column(String, ForeignKey("documents.id"))
    archive_id: Mapped[str | None] = mapped_column(String, ForeignKey("grant_archives.id"))
    # Per-grant workspace reference docs (chunked from uploaded past proposals/reports)
    grant_id: Mapped[str | None] = mapped_column(String, ForeignKey("active_grants.id", ondelete="CASCADE"), nullable=True, index=True)

    grant_title: Mapped[str | None] = mapped_column(String(500))
    funder: Mapped[str | None] = mapped_column(String(300), index=True)
    year: Mapped[int | None] = mapped_column()
    outcome: Mapped[str | None] = mapped_column(String(50), index=True)

    section_type: Mapped[str] = mapped_column(String(100), index=True)
    section_title: Mapped[str | None] = mapped_column(String(500))
    section_text: Mapped[str] = mapped_column(Text, nullable=False)
    section_order: Mapped[int | None] = mapped_column(Integer)
    heading_level: Mapped[int | None] = mapped_column(Integer)
    word_count: Mapped[int | None] = mapped_column(Integer)
    page_count: Mapped[float | None] = mapped_column()

    tags: Mapped[list] = mapped_column(JSON, default=list)
    themes: Mapped[list] = mapped_column(JSON, default=list)
    geography: Mapped[list] = mapped_column(JSON, default=list)

    quality_rating: Mapped[int | None] = mapped_column(Integer)  # 1-5
    reusable_status: Mapped[bool] = mapped_column(Boolean, default=False)
    ai_retrieval_allowed: Mapped[bool] = mapped_column(Boolean, default=True)
    text_reuse_allowed: Mapped[bool] = mapped_column(Boolean, default=False)
    paraphrase_allowed: Mapped[bool] = mapped_column(Boolean, default=True)
    contains_confidential: Mapped[bool] = mapped_column(Boolean, default=False)
    contains_pii: Mapped[bool] = mapped_column(Boolean, default=False)
    is_outdated: Mapped[bool] = mapped_column(Boolean, default=False)

    last_reviewed: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    owner_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    notes: Mapped[str | None] = mapped_column(Text)

    # Vector embedding for semantic search
    embedding: Mapped[list | None] = mapped_column(Vector(1536), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    document: Mapped["Document"] = relationship("Document", back_populates="sections")  # type: ignore

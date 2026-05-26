import uuid
from datetime import datetime
from enum import Enum
from sqlalchemy import String, DateTime, Text, JSON, Integer, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class AgentType(str, Enum):
    CALL_ANALYZER = "call_analyzer"
    SIMILAR_GRANT_RETRIEVER = "similar_grant_retriever"
    GO_NO_GO = "go_no_go"
    PROPOSAL_ARCHITECT = "proposal_architect"
    SECTION_DRAFTER = "section_drafter"
    COMPLIANCE_CHECKER = "compliance_checker"
    STYLE_REVIEWER = "style_reviewer"
    STYLE_PROFILER = "style_profiler"
    GRANT_REVIEWER = "grant_reviewer"
    CITATION_AGENT = "citation_agent"
    INTRO_ARCHITECT = "intro_architect"
    GRANT_WRITER = "grant_writer"
    BUDGET_ASSISTANT = "budget_assistant"
    FEEDBACK_ANALYZER = "feedback_analyzer"
    MEMORY_AGENT = "memory_agent"
    FIT_SCORER = "fit_scorer"
    CALL_SUMMARIZER = "call_summarizer"
    PROFILE_AUGMENTER = "profile_augmenter"


class AIRunStatus(str, Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class AIRun(Base):
    __tablename__ = "ai_runs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    entity_type: Mapped[str | None] = mapped_column(String(50))
    entity_id: Mapped[str | None] = mapped_column(String)
    agent_type: Mapped[str] = mapped_column(String(100))
    prompt_type: Mapped[str | None] = mapped_column(String(100))
    sources_retrieved: Mapped[list] = mapped_column(JSON, default=list)
    output: Mapped[str | None] = mapped_column(Text)
    output_structured: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(50), default=AIRunStatus.RUNNING)
    warnings: Mapped[list] = mapped_column(JSON, default=list)
    model_used: Mapped[str | None] = mapped_column(String(200))
    tokens_used: Mapped[int | None] = mapped_column()
    cost_cents: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

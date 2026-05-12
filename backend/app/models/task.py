import uuid
from datetime import datetime, date
from enum import Enum

from sqlalchemy import String, DateTime, Date, Text, JSON, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class TaskStatus(str, Enum):
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    BLOCKED = "blocked"
    NEEDS_REVIEW = "needs_review"
    COMPLETE = "complete"
    DROPPED = "dropped"


class TaskPriority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class TaskType(str, Enum):
    ELIGIBILITY_CHECK = "eligibility_check"
    CALL_ANALYSIS = "call_analysis"
    CONCEPT_NOTE = "concept_note"
    NARRATIVE_WRITING = "narrative_writing"
    SPECIFIC_AIMS = "specific_aims"
    BACKGROUND = "background"
    METHODS = "methods"
    IMPLEMENTATION_PLAN = "implementation_plan"
    MEL_EVALUATION = "mel_evaluation"
    ETHICS = "ethics"
    DATA_MANAGEMENT = "data_management"
    BUDGET = "budget"
    BUDGET_JUSTIFICATION = "budget_justification"
    PARTNER_LETTER = "partner_letter"
    CV_BIOSKETCH = "cv_biosketch"
    INSTITUTIONAL_APPROVAL = "institutional_approval"
    COMPLIANCE_CHECK = "compliance_check"
    FORMATTING = "formatting"
    SUBMISSION_PORTAL = "submission_portal"
    FINAL_UPLOAD = "final_upload"
    POST_SUBMISSION_ARCHIVE = "post_submission_archive"
    OTHER = "other"


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    grant_id: Mapped[str] = mapped_column(String, ForeignKey("active_grants.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    owner_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    reviewer_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    due_date: Mapped[date | None] = mapped_column(Date, index=True)
    priority: Mapped[str] = mapped_column(String(50), default=TaskPriority.MEDIUM)
    status: Mapped[str] = mapped_column(String(50), default=TaskStatus.NOT_STARTED, index=True)
    task_type: Mapped[str] = mapped_column(String(100), default=TaskType.OTHER)
    dependencies: Mapped[list] = mapped_column(JSON, default=list)  # list of task IDs
    document_url: Mapped[str | None] = mapped_column(String(1000))
    reminder_settings: Mapped[dict] = mapped_column(JSON, default=dict)
    created_by_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    grant: Mapped["ActiveGrant"] = relationship("ActiveGrant", back_populates="tasks")  # type: ignore

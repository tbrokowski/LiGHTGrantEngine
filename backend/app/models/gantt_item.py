import uuid
from datetime import datetime, date
from enum import Enum

from sqlalchemy import String, DateTime, Date, JSON, Integer, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class GanttItemType(str, Enum):
    TASK = "task"
    SUBTASK = "subtask"
    MILESTONE = "milestone"
    DEADLINE = "deadline"
    REVIEW_PERIOD = "review_period"
    PARTNER_DEPENDENCY = "partner_dependency"
    INSTITUTIONAL_APPROVAL = "institutional_approval"
    SUBMISSION_WINDOW = "submission_window"


class GanttItem(Base):
    __tablename__ = "gantt_items"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    grant_id: Mapped[str] = mapped_column(String, ForeignKey("active_grants.id"), nullable=False, index=True)
    linked_task_id: Mapped[str | None] = mapped_column(String, ForeignKey("tasks.id"))
    linked_milestone_id: Mapped[str | None] = mapped_column(String, ForeignKey("milestones.id"))
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    item_type: Mapped[str] = mapped_column(String(50), default=GanttItemType.TASK)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(50), default="not_started")
    owner_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    dependency_ids: Mapped[list] = mapped_column(JSON, default=list)
    display_order: Mapped[int] = mapped_column(Integer, default=0)
    color_category: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

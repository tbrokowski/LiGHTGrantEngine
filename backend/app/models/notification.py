import uuid
from datetime import datetime
from enum import Enum
from sqlalchemy import String, DateTime, Text, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class NotificationType(str, Enum):
    NEW_OPPORTUNITY = "new_opportunity"
    HIGH_FIT_OPPORTUNITY = "high_fit_opportunity"
    OPPORTUNITY_ASSIGNED = "opportunity_assigned"
    REVIEW_PENDING_TOO_LONG = "review_pending_too_long"
    OPPORTUNITY_DEADLINE = "opportunity_deadline"
    GRANT_INTERNAL_DEADLINE = "grant_internal_deadline"
    GRANT_EXTERNAL_DEADLINE = "grant_external_deadline"
    TASK_ASSIGNED = "task_assigned"
    TASK_DUE_SOON = "task_due_soon"
    TASK_OVERDUE = "task_overdue"
    COMMENT_MENTION = "comment_mention"
    GRANT_STATUS_CHANGED = "grant_status_changed"
    PROPOSAL_READY_FOR_REVIEW = "proposal_ready_for_review"
    SUBMISSION_DEADLINE_TOMORROW = "submission_deadline_tomorrow"
    SCRAPER_FAILED = "scraper_failed"
    OPPORTUNITY_PAGE_UPDATED = "opportunity_page_updated"
    GRANT_OUTCOME_RECORDED = "grant_outcome_recorded"
    FINANCE_OVERSPEND_WARNING = "finance_overspend_warning"
    FINANCE_OVERSPEND_CRITICAL = "finance_overspend_critical"
    FUND_REQUEST_PENDING = "fund_request_pending"


class NotificationChannel(str, Enum):
    EMAIL = "email"
    IN_APP = "in_app"
    SLACK = "slack"
    TEAMS = "teams"


class NotificationStatus(str, Enum):
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"
    READ = "read"


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False, index=True)
    notification_type: Mapped[str] = mapped_column(String(100))
    entity_type: Mapped[str | None] = mapped_column(String(50))
    entity_id: Mapped[str | None] = mapped_column(String)
    message: Mapped[str] = mapped_column(Text)
    channel: Mapped[str] = mapped_column(String(50), default=NotificationChannel.IN_APP)
    status: Mapped[str] = mapped_column(String(50), default=NotificationStatus.PENDING)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

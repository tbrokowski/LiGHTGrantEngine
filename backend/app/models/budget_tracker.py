import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import String, DateTime, Float, Boolean, Text, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class BudgetStatus(str, Enum):
    NOT_STARTED = "not_started"
    SHELL_CREATED = "shell_created"
    IN_PROGRESS = "in_progress"
    PARTNER_BUDGETS_PENDING = "partner_budgets_pending"
    INTERNAL_REVIEW = "internal_review"
    REVISION_NEEDED = "revision_needed"
    APPROVED = "approved"
    FINALIZED = "finalized"
    SUBMITTED = "submitted"


class BudgetTracker(Base):
    __tablename__ = "budget_tracker"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    grant_id: Mapped[str] = mapped_column(String, ForeignKey("active_grants.id"), nullable=False, unique=True)
    requested_amount: Mapped[float | None] = mapped_column(Float)
    maximum_amount: Mapped[float | None] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(10), default="USD")
    budget_owner_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(50), default=BudgetStatus.NOT_STARTED)
    spreadsheet_url: Mapped[str | None] = mapped_column(String(1000))
    justification_url: Mapped[str | None] = mapped_column(String(1000))
    indirect_cost_rule: Mapped[str | None] = mapped_column(Text)
    cost_share_required: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

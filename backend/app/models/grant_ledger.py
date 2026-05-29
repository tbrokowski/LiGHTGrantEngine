import uuid
from datetime import datetime, date
from enum import Enum

from sqlalchemy import String, Float, DateTime, Date, Text, JSON, ForeignKey, Integer, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class FundRequestStatus(str, Enum):
    PENDING = "pending"
    UNDER_REVIEW = "under_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    PAID = "paid"
    CANCELLED = "cancelled"


class GrantLedger(Base):
    """Post-award financial ledger — 1:1 with an active grant."""
    __tablename__ = "grant_ledgers"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    grant_id: Mapped[str] = mapped_column(String, ForeignKey("active_grants.id"), nullable=False, unique=True, index=True)
    total_awarded: Mapped[float | None] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(10), default="USD")
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    categories: Mapped[list["LedgerCategory"]] = relationship(
        "LedgerCategory", back_populates="ledger", cascade="all, delete-orphan"
    )


class LedgerCategory(Base):
    __tablename__ = "ledger_categories"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    ledger_id: Mapped[str] = mapped_column(String, ForeignKey("grant_ledgers.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    approved_amount: Mapped[float] = mapped_column(Float, default=0.0)
    description: Mapped[str | None] = mapped_column(Text)
    display_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    ledger: Mapped["GrantLedger"] = relationship("GrantLedger", back_populates="categories")


class FundRequest(Base):
    __tablename__ = "fund_requests"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    grant_id: Mapped[str] = mapped_column(String, ForeignKey("active_grants.id"), nullable=False, index=True)
    category_id: Mapped[str | None] = mapped_column(String, ForeignKey("ledger_categories.id"), index=True)
    requested_by_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    vendor: Mapped[str | None] = mapped_column(String(300))
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="USD")
    status: Mapped[str] = mapped_column(String(50), default=FundRequestStatus.PENDING, index=True)
    slack_message_ts: Mapped[str | None] = mapped_column(String(50))
    slack_channel_id: Mapped[str | None] = mapped_column(String(50))
    approved_by_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    rejection_reason: Mapped[str | None] = mapped_column(Text)
    attachments: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Expenditure(Base):
    __tablename__ = "expenditures"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    grant_id: Mapped[str] = mapped_column(String, ForeignKey("active_grants.id"), nullable=False, index=True)
    category_id: Mapped[str | None] = mapped_column(String, ForeignKey("ledger_categories.id"), index=True)
    fund_request_id: Mapped[str | None] = mapped_column(String, ForeignKey("fund_requests.id"), index=True)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="USD")
    expense_date: Mapped[date | None] = mapped_column(Date)
    vendor: Mapped[str | None] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text)
    receipt_url: Mapped[str | None] = mapped_column(String(1000))
    recorded_by_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

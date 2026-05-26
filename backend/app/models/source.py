import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import String, Boolean, DateTime, Integer, JSON, Text, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class SourceType(str, Enum):
    API = "api"
    RSS = "rss"
    HTML_STATIC = "html_static"
    HTML_DYNAMIC = "html_dynamic"
    PDF_LISTING = "pdf_listing"
    EMAIL = "email"
    MANUAL = "manual"
    CSV = "csv"


class SourceStatus(str, Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    BROKEN = "broken"
    UNDER_REVIEW = "under_review"


class Source(Base):
    __tablename__ = "sources"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    category: Mapped[str | None] = mapped_column(String(100))
    url: Mapped[str | None] = mapped_column(String(1000))
    source_type: Mapped[str] = mapped_column(String(50), default=SourceType.HTML_STATIC)
    api_endpoint: Mapped[str | None] = mapped_column(String(1000))
    auth_required: Mapped[bool] = mapped_column(Boolean, default=False)
    refresh_frequency: Mapped[str] = mapped_column(String(50), default="weekly")
    last_checked: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_successful_run: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(50), default=SourceStatus.ACTIVE)
    owner_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    relevant_themes: Mapped[list] = mapped_column(JSON, default=list)
    relevant_geographies: Mapped[list] = mapped_column(JSON, default=list)
    parser_type: Mapped[str | None] = mapped_column(String(100))
    scraper_config: Mapped[dict] = mapped_column(JSON, default=dict)
    terms_of_use_notes: Mapped[str | None] = mapped_column(Text)
    robots_txt_notes: Mapped[str | None] = mapped_column(Text)
    error_log: Mapped[list] = mapped_column(JSON, default=list)
    opportunities_discovered: Mapped[int] = mapped_column(Integer, default=0)
    opportunities_added: Mapped[int] = mapped_column(Integer, default=0)
    duplicates_detected: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str | None] = mapped_column(Text)
    logo_url: Mapped[str | None] = mapped_column(String(500))
    is_high_priority: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    runs: Mapped[list["SourceRun"]] = relationship("SourceRun", back_populates="source", lazy="select")


class SourceRunStatus(str, Enum):
    SUCCESS = "success"
    FAILED = "failed"
    PARTIAL = "partial"
    RUNNING = "running"


class SourceRun(Base):
    __tablename__ = "source_runs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    source_id: Mapped[str] = mapped_column(String, ForeignKey("sources.id"), nullable=False, index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(50), default=SourceRunStatus.RUNNING)
    records_found: Mapped[int] = mapped_column(Integer, default=0)
    new_opportunities: Mapped[int] = mapped_column(Integer, default=0)
    updated_opportunities: Mapped[int] = mapped_column(Integer, default=0)
    duplicates: Mapped[int] = mapped_column(Integer, default=0)
    errors: Mapped[list] = mapped_column(JSON, default=list)
    warnings: Mapped[list] = mapped_column(JSON, default=list)
    log_summary: Mapped[str | None] = mapped_column(Text)
    raw_response_saved: Mapped[bool] = mapped_column(Boolean, default=False)
    parser_version: Mapped[str | None] = mapped_column(String(50))
    notes: Mapped[str | None] = mapped_column(Text)

    source: Mapped["Source"] = relationship("Source", back_populates="runs")

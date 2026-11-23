"""Tags an organization puts on its archived grants, and saved Insights views.

Tags are org-scoped labels (e.g. "EOI", "Horizon Europe", "Capacity building"),
optionally grouped ("Stage", "Programme", "Genre") so the Insights tab can break
statistics down by a group. A grant can carry any number of tags.
"""
import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ArchiveTag(Base):
    __tablename__ = "archive_tags"
    __table_args__ = (
        UniqueConstraint("institution_id", "group_name", "name", name="uq_archive_tag_org_group_name"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    institution_id: Mapped[str] = mapped_column(
        String, ForeignKey("institutions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    # "" = ungrouped. Not NULL so the unique constraint also covers ungrouped tags.
    group_name: Mapped[str] = mapped_column(String(80), nullable=False, default="", server_default="")
    color: Mapped[str] = mapped_column(String(20), nullable=False)
    created_by_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ArchiveTagLink(Base):
    __tablename__ = "archive_tag_links"

    archive_id: Mapped[str] = mapped_column(
        String, ForeignKey("grant_archives.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[str] = mapped_column(
        String, ForeignKey("archive_tags.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ArchiveInsightView(Base):
    """A named Insights configuration (which grants, how to break them down),
    shared with everyone in the organization."""
    __tablename__ = "archive_insight_views"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    institution_id: Mapped[str] = mapped_column(
        String, ForeignKey("institutions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    config: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_by_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

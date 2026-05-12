import uuid
from datetime import datetime, date
from sqlalchemy import String, Boolean, DateTime, Date, Text, JSON, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column
from pgvector.sqlalchemy import Vector
from app.database import Base


class ReusableLanguageBlock(Base):
    __tablename__ = "reusable_language_blocks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    source_grant: Mapped[str | None] = mapped_column(String(500))
    source_section: Mapped[str | None] = mapped_column(String(100))
    text: Mapped[str] = mapped_column(Text, nullable=False)
    section_type: Mapped[str | None] = mapped_column(String(100))
    tags: Mapped[list] = mapped_column(JSON, default=list)

    approved_for_reuse: Mapped[bool] = mapped_column(Boolean, default=False)
    approved_by_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    paraphrase_only: Mapped[bool] = mapped_column(Boolean, default=False)
    restricted_to_team: Mapped[bool] = mapped_column(Boolean, default=False)
    restricted_to_funder: Mapped[str | None] = mapped_column(String(300))
    do_not_reuse: Mapped[bool] = mapped_column(Boolean, default=False)

    owner_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    last_reviewed: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_date: Mapped[date | None] = mapped_column(Date)
    access_level: Mapped[str] = mapped_column(String(50), default="team_only")
    usage_notes: Mapped[str | None] = mapped_column(Text)
    do_not_use_notes: Mapped[str | None] = mapped_column(Text)
    version: Mapped[str | None] = mapped_column(String(50))

    # Vector embedding
    embedding: Mapped[list | None] = mapped_column(Vector(4096), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

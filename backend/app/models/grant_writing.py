import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, Text, JSON, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class GrantWritingConversation(Base):
    __tablename__ = "grant_writing_conversations"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    grant_id: Mapped[str] = mapped_column(String, ForeignKey("active_grants.id"), index=True)
    messages: Mapped[list] = mapped_column(JSON, default=list)
    summary: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class GrantCitation(Base):
    __tablename__ = "grant_citations"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    grant_id: Mapped[str] = mapped_column(String, ForeignKey("active_grants.id"), index=True)
    section_title: Mapped[str | None] = mapped_column(String(500))
    claim_text: Mapped[str | None] = mapped_column(Text)
    source_type: Mapped[str | None] = mapped_column(String(50))
    external_id: Mapped[str | None] = mapped_column(String(200))
    formatted_citation: Mapped[str | None] = mapped_column(Text)
    url: Mapped[str | None] = mapped_column(String(1000))
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

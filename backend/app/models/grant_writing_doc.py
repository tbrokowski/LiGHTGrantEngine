import uuid
from datetime import datetime

from sqlalchemy import Boolean, String, DateTime, Integer, Text, ForeignKey, false, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class GrantWritingDoc(Base):
    """An extra writing document in a grant's editor, beside the main proposal
    (which stays in `active_grants.editor_document`). Shown as a tab; comments
    on it use its id as `comments.document_id`.

    With `document_id` set the tab is an imported Word file: the original .docx
    lives on that Document and opens in OnlyOffice; `content_html` stays empty.

    `is_main` marks the grant's main document — the team's own uploaded proposal —
    which then leads the tabs in place of the AI-drafted proposal (at most one
    per grant).
    """
    __tablename__ = "grant_writing_docs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    grant_id: Mapped[str] = mapped_column(String, ForeignKey("active_grants.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    content_html: Mapped[str] = mapped_column(Text, nullable=False, default="")
    document_id: Mapped[str | None] = mapped_column(String, ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    is_main: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=false())
    created_by: Mapped[str | None] = mapped_column(String, ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

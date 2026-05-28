import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, Text, JSON, ForeignKey, func, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    entity_type: Mapped[str] = mapped_column(String(50))  # opportunity | grant | task | archive
    entity_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    author_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    mentions: Mapped[list] = mapped_column(JSON, default=list)  # list of user IDs
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Grant editor comment extensions
    parent_id: Mapped[str | None] = mapped_column(String, ForeignKey("comments.id"), nullable=True)
    anchor_text: Mapped[str | None] = mapped_column(Text, nullable=True)  # highlighted text the comment is anchored to
    resolved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    google_doc_comment_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    # Which document within the grant these comments belong to ("draft" for main editor, tab id for new documents)
    document_id: Mapped[str] = mapped_column(String(255), nullable=False, server_default="draft", index=True)

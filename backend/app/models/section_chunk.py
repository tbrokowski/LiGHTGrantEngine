import uuid
from datetime import datetime

from sqlalchemy import String, Integer, Text, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column
from pgvector.sqlalchemy import Vector

from app.database import Base


class SectionChunk(Base):
    """A contextual-retrieval chunk of a ProposalSection.

    Large archive sections are sub-chunked into ~paragraph-sized windows. Before
    embedding, each chunk is prefixed with a short LLM-generated `context` that
    situates it within its section/grant (Anthropic's "Contextual Retrieval"),
    and the embedding is computed over `context + chunk_text`. Retrieval matches
    at chunk granularity, then maps back to the parent section for scoring,
    permissions, and full-text reuse — so the rest of the RAG stack is unchanged.
    """

    __tablename__ = "section_chunks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    section_id: Mapped[str] = mapped_column(
        String, ForeignKey("proposal_sections.id", ondelete="CASCADE"), nullable=False, index=True
    )
    chunk_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    chunk_text: Mapped[str] = mapped_column(Text, nullable=False)
    # Short generated prefix situating the chunk within its document. Embedded
    # together with chunk_text; kept so retrieval can show why a chunk matched.
    context: Mapped[str | None] = mapped_column(Text, nullable=True)

    embedding: Mapped[list | None] = mapped_column(Vector(1536), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

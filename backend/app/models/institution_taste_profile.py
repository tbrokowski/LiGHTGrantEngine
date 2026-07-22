from datetime import datetime

from sqlalchemy import String, Integer, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column
from pgvector.sqlalchemy import Vector

from app.database import Base


class InstitutionTasteProfile(Base):
    """
    Per-institution "taste profile" — centroid embeddings summarizing what an
    org has liked/won (positive) vs. rejected/declined (negative), computed
    from InstitutionOpportunity outcome/status history and personal shortlist
    activity. Used to nudge auto-ranking toward opportunities that resemble
    what the org has actually pursued and away from ones like what it passed
    on, without requiring a trained model — just centroid similarity.
    """

    __tablename__ = "institution_taste_profiles"

    institution_id: Mapped[str] = mapped_column(
        String, ForeignKey("institutions.id"), primary_key=True
    )
    positive_embedding: Mapped[list | None] = mapped_column(Vector(1536), nullable=True)
    negative_embedding: Mapped[list | None] = mapped_column(Vector(1536), nullable=True)
    positive_count: Mapped[int] = mapped_column(Integer, default=0)
    negative_count: Mapped[int] = mapped_column(Integer, default=0)
    computed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

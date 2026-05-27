"""Opportunity similarity edges for the graph view (kNN cosine similarity)."""
from sqlalchemy import String, Float, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class OpportunityEdge(Base):
    __tablename__ = "opportunity_edges"

    source_id: Mapped[str] = mapped_column(String(36), ForeignKey("opportunities.id", ondelete="CASCADE"), primary_key=True)
    target_id: Mapped[str] = mapped_column(String(36), ForeignKey("opportunities.id", ondelete="CASCADE"), primary_key=True)
    weight: Mapped[float] = mapped_column(Float, nullable=False)

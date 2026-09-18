from datetime import datetime

from sqlalchemy import String, Integer, DateTime, ForeignKey, JSON, func
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
    # Embedding of the org's *declared* profile (keywords/geographies/mission) —
    # the primary semantic anchor for fit scoring, and a graceful fallback when
    # the org has too little pursued/rejected history for the centroids above.
    profile_embedding: Mapped[list | None] = mapped_column(Vector(1536), nullable=True)
    positive_count: Mapped[int] = mapped_column(Integer, default=0)
    negative_count: Mapped[int] = mapped_column(Integer, default=0)

    # ── Calibrated-ranking artifacts (see services/grant_ranker.py) ───────────
    # Multi-prototype taste. A single averaged centroid represents a
    # multi-interest lab badly — the mean of "water sanitation in East Africa"
    # and "ML for medical imaging" is a point describing neither, closest to
    # bland generic grants. These are a small set of prototypes (from the
    # institution-scoped archive plus pursued opportunities) that similarity is
    # taken as a `max` over instead.
    #
    # Shape: {"positive": <b64 float32>, "negative": <b64 float32>,
    #         "labels": [...], "won": [bool, ...], "dim": 1536}
    # Vectors are packed rather than stored as JSON float lists — they are read
    # on every single-opportunity rescore, and packing cuts the payload ~5x.
    prototypes: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Ranking metadata: funder affinity map, median awarded amount, and the
    # raw-score quantile breakpoints used to calibrate 0-100 fit scores.
    # Shape: {"funder_affinity": {...}, "award_median": float, "quantiles": [...]}
    ranking_meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    computed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

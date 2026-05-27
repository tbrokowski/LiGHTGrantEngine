"""Archive similarity edges — kNN cosine-similarity graph for the archive view."""
from sqlalchemy import String, Float, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ArchiveEdge(Base):
    __tablename__ = "archive_edges"

    source_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("grant_archives.id", ondelete="CASCADE"),
        primary_key=True,
    )
    target_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("grant_archives.id", ondelete="CASCADE"),
        primary_key=True,
    )
    weight: Mapped[float] = mapped_column(Float, nullable=False)

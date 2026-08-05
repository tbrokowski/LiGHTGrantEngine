from datetime import datetime

from sqlalchemy import String, Integer, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from pgvector.sqlalchemy import Vector

from app.database import Base


class UserTasteProfile(Base):
    """Per-user taste signal used to personalize the opportunities feed on top of
    the org score.

    positive_embedding — centroid of what this user has engaged with (shortlisted /
      read / pursued), i.e. the *behavioral* signal.
    negative_embedding — centroid of opportunities the user dismissed ("Not
      interested"); the feed pushes down items close to this centroid.
    profile_embedding  — embedding of the user's *explicit* preference keywords.
    The feed blends similarity to these with the org fit score, so ranking reflects
    both the individual and the institution. Cold-start users (no signal) fall back
    to the org profile.
    """

    __tablename__ = "user_taste_profiles"

    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    positive_embedding: Mapped[list | None] = mapped_column(Vector(1536), nullable=True)
    negative_embedding: Mapped[list | None] = mapped_column(Vector(1536), nullable=True)
    profile_embedding: Mapped[list | None] = mapped_column(Vector(1536), nullable=True)
    positive_count: Mapped[int] = mapped_column(Integer, default=0)
    negative_count: Mapped[int] = mapped_column(Integer, default=0)
    computed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

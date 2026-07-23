import uuid
from datetime import datetime

from sqlalchemy import String, Integer, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ShortlistCategory(Base):
    """
    A user- or org-defined lane on the shortlist board (Kanban).

    scope='user'  -> owner_id is a user_id; the lane belongs to My Shortlist.
    scope='org'   -> owner_id is an institution_id; shared on the Org Shortlist.

    Cards (opportunities) reference a category via
    UserOpportunityState.shortlist_category_id (user scope) or
    InstitutionOpportunity.shortlist_category_id (org scope). A null reference
    means the card falls back to its fit-score-derived default lane.
    """

    __tablename__ = "shortlist_categories"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    scope: Mapped[str] = mapped_column(String(10), nullable=False)          # 'user' | 'org'
    owner_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

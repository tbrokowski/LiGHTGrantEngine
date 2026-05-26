from datetime import datetime

from sqlalchemy import String, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class UserOpportunityState(Base):
    __tablename__ = "user_opportunity_states"

    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), primary_key=True)
    opportunity_id: Mapped[str] = mapped_column(String, ForeignKey("opportunities.id"), primary_key=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

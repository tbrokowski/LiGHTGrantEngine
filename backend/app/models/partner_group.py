import uuid
from datetime import datetime

from sqlalchemy import String, Text, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# Assigned round-robin to new groups; the same palette the UI offers.
GROUP_COLORS = ["#0F766E", "#1D4ED8", "#C2410C", "#6D28D9", "#15803D", "#BE123C", "#475569", "#A16207"]


class PartnerGroup(Base):
    """A named set of partners — a site, consortium or project (migration 063)."""
    __tablename__ = "partner_groups"
    __table_args__ = (UniqueConstraint("institution_id", "name", name="uq_partner_groups_institution_name"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    institution_id: Mapped[str | None] = mapped_column(String, ForeignKey("institutions.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str | None] = mapped_column(String(20))
    created_by: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class PartnerGroupMember(Base):
    __tablename__ = "partner_group_members"

    group_id: Mapped[str] = mapped_column(String, ForeignKey("partner_groups.id", ondelete="CASCADE"), primary_key=True)
    partner_id: Mapped[str] = mapped_column(String, ForeignKey("partners.id", ondelete="CASCADE"), primary_key=True, index=True)
    added_by: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

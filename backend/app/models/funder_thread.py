"""Open threads on the Funders tab: a running conversation inside the team
(e.g. "Swiss foundations push"), with the funders it concerns assigned to it."""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class FunderThread(Base):
    __tablename__ = "funder_threads"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    institution_id: Mapped[str] = mapped_column(
        String, ForeignKey("institutions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    # open / closed
    status: Mapped[str] = mapped_column(String(20), default="open", server_default="open", index=True)
    created_by: Mapped[str | None] = mapped_column(String, ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_activity_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class FunderThreadPartner(Base):
    """A funder (partner) assigned to a thread."""
    __tablename__ = "funder_thread_partners"
    __table_args__ = (UniqueConstraint("thread_id", "partner_id", name="uq_funder_thread_partner"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    thread_id: Mapped[str] = mapped_column(
        String, ForeignKey("funder_threads.id", ondelete="CASCADE"), nullable=False, index=True
    )
    partner_id: Mapped[str] = mapped_column(
        String, ForeignKey("partners.id", ondelete="CASCADE"), nullable=False, index=True
    )
    added_by: Mapped[str | None] = mapped_column(String, ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class FunderThreadPost(Base):
    __tablename__ = "funder_thread_posts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    thread_id: Mapped[str] = mapped_column(
        String, ForeignKey("funder_threads.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id", ondelete="SET NULL"))
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

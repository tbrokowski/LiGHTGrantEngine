import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ArchiveShare(Base):
    """An archived grant shared with one person (by email, or picked from Partners).

    `is_internal` is decided when shared: true when the recipient already belongs
    to the sharer's organization. `user_id` fills in once they have an account.
    """
    __tablename__ = "archive_shares"
    __table_args__ = (UniqueConstraint("archive_id", "email", name="uq_archive_share_email"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    archive_id: Mapped[str] = mapped_column(
        String, ForeignKey("grant_archives.id", ondelete="CASCADE"), nullable=False, index=True
    )
    email: Mapped[str] = mapped_column(String(300), nullable=False, index=True)
    user_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id", ondelete="SET NULL"), index=True)
    partner_id: Mapped[str | None] = mapped_column(String, ForeignKey("partners.id", ondelete="SET NULL"))
    institution_id: Mapped[str | None] = mapped_column(String, ForeignKey("institutions.id", ondelete="SET NULL"))
    is_internal: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    shared_by_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

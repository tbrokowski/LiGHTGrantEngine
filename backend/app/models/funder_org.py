import uuid
from datetime import datetime

from sqlalchemy import String, Text, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class FunderOrg(Base):
    """
    A funding organization/body (e.g. Fulbright, LMCC) — distinct from Source,
    which represents a scrapeable portal. Funder Orgs are typically manually
    curated for funders that are hard or impossible to scrape, with a name,
    URL, notes, and freeform recurring-deadline info an admin maintains by hand.
    """

    __tablename__ = "funder_orgs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(300), nullable=False, index=True)
    url: Mapped[str | None] = mapped_column(String(500))
    notes: Mapped[str | None] = mapped_column(Text)
    # Freeform recurring-deadline notes, e.g. "Rounds open Feb/Jun/Oct" — not a
    # single structured date, since these funders' cycles are tracked by hand.
    deadline_info: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

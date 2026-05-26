import uuid
from datetime import datetime, date
from enum import Enum

from sqlalchemy import String, DateTime, Date, Text, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class PartnerStatus(str, Enum):
    NOT_CONTACTED = "not_contacted"
    CONTACTED = "contacted"
    CONFIRMED = "confirmed"
    MATERIALS_REQUESTED = "materials_requested"
    MATERIALS_RECEIVED = "materials_received"
    NEEDS_REVISION = "needs_revision"
    COMPLETE = "complete"
    DROPPED = "dropped"


class PartnerMaterialStatus(str, Enum):
    NOT_REQUESTED = "not_requested"
    REQUESTED = "requested"
    RECEIVED = "received"
    NEEDS_REVISION = "needs_revision"
    COMPLETE = "complete"
    WAIVED = "waived"


class WorkspacePartner(Base):
    __tablename__ = "workspace_partners"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    grant_id: Mapped[str] = mapped_column(String, ForeignKey("active_grants.id"), nullable=False, index=True)
    institution_name: Mapped[str] = mapped_column(String(300), nullable=False)
    contact_person: Mapped[str | None] = mapped_column(String(200))
    email: Mapped[str | None] = mapped_column(String(200))
    role: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(50), default=PartnerStatus.NOT_CONTACTED)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    materials: Mapped[list["PartnerMaterial"]] = relationship("PartnerMaterial", back_populates="partner", cascade="all, delete-orphan")


class PartnerMaterial(Base):
    __tablename__ = "partner_materials"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    partner_id: Mapped[str] = mapped_column(String, ForeignKey("workspace_partners.id"), nullable=False, index=True)
    grant_id: Mapped[str] = mapped_column(String, ForeignKey("active_grants.id"), nullable=False, index=True)
    material_type: Mapped[str] = mapped_column(String(100), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(50), default=PartnerMaterialStatus.NOT_REQUESTED)
    linked_file_url: Mapped[str | None] = mapped_column(String(1000))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    partner: Mapped["WorkspacePartner"] = relationship("WorkspacePartner", back_populates="materials")

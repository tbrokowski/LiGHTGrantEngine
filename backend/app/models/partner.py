import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import String, Boolean, Integer, DateTime, Text, JSON, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship as orm_relationship
from pgvector.sqlalchemy import Vector

from app.database import Base


class PartnerStatus(str, Enum):
    ACTIVE = "active"
    PROSPECT = "prospect"
    INACTIVE = "inactive"


class PartnerUpdateType(str, Enum):
    NOTE = "note"
    EMAIL = "email"
    CALL = "call"
    MEETING = "meeting"
    OTHER = "other"


class PartnerRelationship(str, Enum):
    PI = "PI"
    CO_I = "co-I"
    FUNDER_CONTACT = "funder_contact"
    REVIEWER = "reviewer"
    COLLABORATOR = "collaborator"
    ADVISOR = "advisor"
    INDUSTRY_PARTNER = "industry_partner"
    NGO_PARTNER = "ngo_partner"
    GOVERNMENT_PARTNER = "government_partner"
    OTHER = "other"


class PartnerRelationshipStage(str, Enum):
    PROSPECT = "prospect"
    QUALIFIED = "qualified"
    ENGAGED = "engaged"
    COLLABORATING = "collaborating"
    ALUMNI = "alumni"


class Partner(Base):
    __tablename__ = "partners"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))

    # Core contact info
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    email: Mapped[str | None] = mapped_column(String(300), index=True)
    phone: Mapped[str | None] = mapped_column(String(100))
    organization: Mapped[str | None] = mapped_column(String(300), index=True)
    title: Mapped[str | None] = mapped_column(String(200))
    linkedin_url: Mapped[str | None] = mapped_column(String(1000))
    website: Mapped[str | None] = mapped_column(String(1000))

    # Classification
    tags: Mapped[list] = mapped_column(JSON, default=list)
    project_types: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(50), default=PartnerStatus.ACTIVE, index=True)
    notes: Mapped[str | None] = mapped_column(Text)

    # CRM enrichment fields (added in migration 032)
    organization_id: Mapped[str | None] = mapped_column(String, ForeignKey("partner_organizations.id"), nullable=True, index=True)
    institution_id: Mapped[str | None] = mapped_column(String, ForeignKey("institutions.id"), nullable=True, index=True)
    orcid: Mapped[str | None] = mapped_column(String(100))
    google_scholar_id: Mapped[str | None] = mapped_column(String(200))
    h_index: Mapped[int | None] = mapped_column(Integer)
    expertise_embedding: Mapped[list | None] = mapped_column(Vector(1536), nullable=True)
    relationship_stage: Mapped[str] = mapped_column(String(50), default=PartnerRelationshipStage.PROSPECT, index=True)
    avatar_url: Mapped[str | None] = mapped_column(String(1000))
    department: Mapped[str | None] = mapped_column(String(200))
    country: Mapped[str | None] = mapped_column(String(100))
    city: Mapped[str | None] = mapped_column(String(100))
    last_enriched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    enrichment_source: Mapped[str | None] = mapped_column(String(200))
    # none / pending / done / failed
    enrichment_status: Mapped[str] = mapped_column(String(50), default="none")

    # Ownership
    created_by: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    updates: Mapped[list["PartnerUpdate"]] = orm_relationship("PartnerUpdate", back_populates="partner", cascade="all, delete-orphan")
    grant_links: Mapped[list["PartnerGrantLink"]] = orm_relationship("PartnerGrantLink", back_populates="partner", cascade="all, delete-orphan")
    meetings: Mapped[list["PartnerMeeting"]] = orm_relationship("PartnerMeeting", back_populates="partner", cascade="all, delete-orphan")  # type: ignore
    documents: Mapped[list["PartnerDocument"]] = orm_relationship("PartnerDocument", back_populates="partner", cascade="all, delete-orphan")  # type: ignore
    reminders: Mapped[list["PartnerReminder"]] = orm_relationship("PartnerReminder", back_populates="partner", cascade="all, delete-orphan")  # type: ignore
    partner_org: Mapped["PartnerOrganization | None"] = orm_relationship("PartnerOrganization", back_populates="partners", foreign_keys=[organization_id])  # type: ignore


class PartnerUpdate(Base):
    __tablename__ = "partner_updates"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    partner_id: Mapped[str] = mapped_column(String, ForeignKey("partners.id"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    update_type: Mapped[str] = mapped_column(String(50), default=PartnerUpdateType.NOTE)
    contact_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_contact_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    partner: Mapped["Partner"] = orm_relationship("Partner", back_populates="updates")


class PartnerGrantLink(Base):
    __tablename__ = "partner_grant_links"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    partner_id: Mapped[str] = mapped_column(String, ForeignKey("partners.id"), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(), nullable=False, index=True)
    relationship: Mapped[str] = mapped_column(String(100), default=PartnerRelationship.COLLABORATOR)
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    partner: Mapped["Partner"] = orm_relationship("Partner", back_populates="grant_links")

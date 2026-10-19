import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, Integer, BigInteger, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class GrantSpreadsheet(Base):
    """An Excel workbook (.xlsx / .xlsm) attached to a grant, co-edited in the
    OnlyOffice Document Server.

    The original file bytes live in object storage and are never converted, so
    formatting, formulas, named ranges and VBA macros survive round trips.
    `doc_key` identifies the live editing session to OnlyOffice: everyone who
    opens the workbook with the same key joins the same session. It is rotated
    every time the Document Server hands back a saved file.
    """
    __tablename__ = "grant_spreadsheets"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    grant_id: Mapped[str] = mapped_column(String, ForeignKey("active_grants.id", ondelete="CASCADE"), nullable=False, index=True)
    # Shown in the grant's Saved files too; may sit in one of its folders.
    folder_id: Mapped[str | None] = mapped_column(String, ForeignKey("workspace_folders.id", ondelete="SET NULL"), index=True)
    file_name: Mapped[str] = mapped_column(String(500), nullable=False)
    file_ext: Mapped[str] = mapped_column(String(10), nullable=False)  # xlsx | xlsm
    storage_key: Mapped[str] = mapped_column(String(1000), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    version: Mapped[int] = mapped_column(Integer, default=1)
    doc_key: Mapped[str] = mapped_column(String(128), nullable=False)
    uploaded_by: Mapped[str | None] = mapped_column(String, ForeignKey("users.id", ondelete="SET NULL"))
    last_edited_by: Mapped[str | None] = mapped_column(String, ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class GrantSpreadsheetVersion(Base):
    """A saved snapshot of a workbook. Version 1 is the original upload."""
    __tablename__ = "grant_spreadsheet_versions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    spreadsheet_id: Mapped[str] = mapped_column(String, ForeignKey("grant_spreadsheets.id", ondelete="CASCADE"), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_key: Mapped[str] = mapped_column(String(1000), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    created_by: Mapped[str | None] = mapped_column(String, ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

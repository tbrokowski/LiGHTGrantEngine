"""Shared document text extraction from uploaded bytes."""
from __future__ import annotations

import io

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt"}
ARCHIVE_EXTENSIONS = ALLOWED_EXTENSIONS | {".xlsx", ".xls", ".csv"}


def validate_proposal_filename(filename: str) -> None:
    lower = (filename or "").lower()
    if not any(lower.endswith(ext) for ext in ALLOWED_EXTENSIONS):
        raise ValueError(f"Unsupported file type. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}")


def validate_archive_filename(filename: str) -> None:
    lower = (filename or "").lower()
    if not any(lower.endswith(ext) for ext in ARCHIVE_EXTENSIONS):
        raise ValueError(
            f"Unsupported file type. Allowed: {', '.join(sorted(ARCHIVE_EXTENSIONS))}"
        )


def parse_uploaded_bytes(content: bytes, filename: str) -> str:
    """Extract plain text from PDF, DOCX, or UTF-8 text bytes."""
    if not content:
        return ""

    lower = (filename or "").lower()
    if lower.endswith(".pdf"):
        import pdfplumber
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            return "\n".join(p.extract_text() or "" for p in pdf.pages).strip()
    if lower.endswith(".docx"):
        import docx
        document = docx.Document(io.BytesIO(content))
        return "\n".join(p.text for p in document.paragraphs).strip()
    return content.decode("utf-8", errors="ignore").strip()


def parse_bytes_for_document(content: bytes, file_format: str | None, file_name: str | None) -> str:
    """Parse using document model fields (for Celery embedding task)."""
    fmt = (file_format or "").lower()
    name = file_name or ""
    if fmt == "pdf" or name.endswith(".pdf"):
        return parse_uploaded_bytes(content, "file.pdf")
    if fmt == "docx" or name.endswith(".docx"):
        return parse_uploaded_bytes(content, "file.docx")
    return content.decode("utf-8", errors="ignore").strip()

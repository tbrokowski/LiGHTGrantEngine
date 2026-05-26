"""Download grant call PDFs from opportunity pages and store as Document records."""
from __future__ import annotations

import json
import logging
import uuid
from urllib.parse import unquote, urlparse

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.document import Document, DocumentType, ProcessingStatus
from app.models.opportunity import Opportunity
from app.services.document_parser import parse_uploaded_bytes

logger = logging.getLogger(__name__)

_USER_AGENT = "LiGHT Grant System/1.0"
_MAX_PDFS = 10

_PRIMARY_KEYWORDS = (
    "call",
    "guidance",
    "rfp",
    "application",
    "instructions",
    "guidelines",
    "funding",
    "proposal",
)


def _r2_configured() -> bool:
    s = get_settings()
    return bool(s.r2_account_id and s.r2_access_key_id and s.r2_secret_access_key)


def _filename_from_url(url: str) -> str:
    path = unquote(urlparse(url).path)
    name = path.rsplit("/", 1)[-1] if "/" in path else path
    return name or "call_document.pdf"


def _score_primary_pdf(url: str, anchor_text: str = "") -> int:
    haystack = f"{anchor_text} {url}".lower()
    score = 0
    for kw in _PRIMARY_KEYWORDS:
        if kw in haystack:
            score += 10
    if haystack.endswith(".pdf"):
        score += 1
    return score


def _document_exists(session: Session, opportunity_id: str, source_url: str) -> bool:
    rows = session.execute(
        select(Document).where(
            Document.opportunity_id == opportunity_id,
            Document.document_type == DocumentType.CALL_DOCUMENT,
        )
    ).scalars().all()
    for doc in rows:
        if doc.file_url == source_url:
            return True
        if doc.notes:
            try:
                meta = json.loads(doc.notes)
                if meta.get("source_url") == source_url:
                    return True
            except (json.JSONDecodeError, TypeError):
                pass
    return False


def _download_pdf(url: str, timeout: int = 60) -> bytes | None:
    try:
        resp = httpx.get(
            url,
            timeout=timeout,
            follow_redirects=True,
            headers={"User-Agent": _USER_AGENT},
        )
        resp.raise_for_status()
        content_type = (resp.headers.get("content-type") or "").lower()
        if "pdf" not in content_type and not url.lower().endswith(".pdf"):
            return None
        return resp.content
    except Exception as exc:
        logger.warning("PDF download failed for %s: %s", url, exc)
        return None


def fetch_and_store_call_documents(
    session: Session,
    opportunity: Opportunity,
    pdf_urls: list[str],
    *,
    pdf_anchors: dict[str, str] | None = None,
    skip_pdf: bool = False,
) -> dict:
    """
    Download all PDF links, store in R2 (when configured), create Document rows.

    Returns:
        merged_pdf_text: combined extracted text from all PDFs
        primary_pdf_url: best-match URL for guidance_doc_link
        stored_count: number of new documents created
    """
    if skip_pdf or not pdf_urls:
        return {"merged_pdf_text": "", "primary_pdf_url": None, "stored_count": 0}

    anchors = pdf_anchors or {}
    settings = get_settings()
    api_url = settings.api_url.rstrip("/")
    merged_sections: list[str] = []
    stored_count = 0
    primary_url: str | None = None
    primary_score = -1

    for pdf_url in pdf_urls[:_MAX_PDFS]:
        if _document_exists(session, opportunity.id, pdf_url):
            continue

        content = _download_pdf(pdf_url)
        if not content:
            continue

        filename = _filename_from_url(pdf_url)
        parsed_text = parse_uploaded_bytes(content, filename)
        doc_id = str(uuid.uuid4())

        r2_key = None
        file_url = pdf_url
        notes: str | None = None
        processing_status = ProcessingStatus.PROCESSED
        if not parsed_text.strip():
            processing_status = ProcessingStatus.NEEDS_MANUAL_REVIEW

        if _r2_configured():
            try:
                from app.services import storage as storage_svc

                r2_key = storage_svc.build_key(
                    filename,
                    opportunity_id=opportunity.id,
                    doc_id=doc_id,
                )
                storage_svc.upload_file(r2_key, content, content_type="application/pdf")
                file_url = f"{api_url}/api/v1/documents/{doc_id}/content"
                notes = json.dumps({"r2_key": r2_key, "source_url": pdf_url})
                if parsed_text.strip():
                    processing_status = ProcessingStatus.NOT_PROCESSED
            except Exception as exc:
                logger.warning("R2 upload failed for %s: %s", pdf_url, exc)
                notes = json.dumps({"source_url": pdf_url})
        else:
            notes = json.dumps({"source_url": pdf_url})

        doc = Document(
            id=doc_id,
            opportunity_id=opportunity.id,
            document_type=DocumentType.CALL_DOCUMENT,
            file_name=filename,
            file_url=file_url,
            file_format="pdf",
            parsed_text=parsed_text or None,
            processing_status=processing_status,
            ai_retrieval_allowed=True,
            notes=notes or r2_key,
        )
        session.add(doc)
        stored_count += 1

        if parsed_text:
            merged_sections.append(f"### {filename}\n\n{parsed_text}")

        score = _score_primary_pdf(pdf_url, anchors.get(pdf_url, ""))
        if score > primary_score:
            primary_score = score
            primary_url = pdf_url

        if processing_status == ProcessingStatus.NOT_PROCESSED:
            from app.workers.celery_app import celery_app

            celery_app.send_task(
                "app.workers.embedding_tasks.parse_and_embed_document",
                args=[doc_id],
            )

    if primary_url and not opportunity.guidance_doc_link:
        opportunity.guidance_doc_link = primary_url
    elif primary_url and opportunity.guidance_doc_link:
        # Prefer higher-scored primary when re-enriching
        if _score_primary_pdf(primary_url, anchors.get(primary_url, "")) > _score_primary_pdf(
            opportunity.guidance_doc_link, ""
        ):
            opportunity.guidance_doc_link = primary_url

    merged_pdf_text = "\n\n".join(merged_sections)
    return {
        "merged_pdf_text": merged_pdf_text,
        "primary_pdf_url": primary_url,
        "stored_count": stored_count,
    }


def merge_enrichment_text(
    html_description: str | None,
    html_parsed: str | None,
    pdf_text: str,
) -> dict:
    """Merge HTML and PDF extracted text into opportunity fields."""
    description = html_description or ""
    parsed_text = html_parsed or ""

    if pdf_text:
        if len(pdf_text) > len(description):
            description = pdf_text[:10000]
        elif pdf_text.strip() and pdf_text.strip() not in (parsed_text or ""):
            parsed_text = _append_section(parsed_text, "## Call documents", pdf_text)

    short_summary = None
    if description:
        from app.scrapers.detail_fetcher import _extract_short_summary, _strip_markdown

        short_summary = _extract_short_summary(_strip_markdown(description))

    return {
        "description": description[:10000] if description else None,
        "parsed_text": parsed_text[:20000] if parsed_text else None,
        "short_summary": short_summary,
    }


def _append_section(base: str, header: str, body: str) -> str:
    body = body.strip()
    if not body:
        return base
    if body in base:
        return base
    if base.strip():
        return f"{base.rstrip()}\n\n{header}\n\n{body}"
    return f"{header}\n\n{body}"

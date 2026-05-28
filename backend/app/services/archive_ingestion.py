"""Archive ingestion — split documents into ProposalSection rows for RAG."""
from __future__ import annotations

import asyncio
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.agents.memory_agent import process_completed_grant
from app.ai.agents.section_splitter import split_proposal_into_sections
from app.ai.agents.style_profiler import build_style_profile
from app.models.archive import GrantArchive
from app.models.document import Document, DocumentType, ProcessingStatus
from app.models.language import ReusableLanguageBlock
from app.models.section import ProposalSection
from app.services.document_parser import (
    parse_uploaded_bytes,
    validate_archive_filename,
    validate_proposal_filename,
)

STYLE_SECTION_TYPES = (
    "abstract", "background", "problem_statement", "specific_aims",
    "methods", "impact_statement", "team_capacity", "executive_summary",
)


def split_text_into_sections(text: str) -> list[tuple[str, str]]:
    """Split plain text on common section heading patterns (regex fallback)."""
    if not text:
        return []

    pattern = r"(?m)^(?:#{1,3}\s+|[\d]+\.\s+|[A-Z][A-Za-z\s/&-]{3,50}:?\s*$)"
    parts = re.split(pattern, text)
    headings = re.findall(pattern, text)

    sections = []
    if parts and parts[0].strip() and not headings:
        sections.append(("Full Document", parts[0].strip()))

    for i, heading in enumerate(headings):
        body = parts[i + 1].strip() if i + 1 < len(parts) else ""
        title = heading.strip().rstrip(":").strip("#").strip()
        if body:
            sections.append((title, body))
    if not sections and text.strip():
        sections.append(("Full Document", text.strip()))
    return sections


def _infer_section_type(title: str) -> str:
    t = title.lower()
    mapping = {
        "abstract": "abstract",
        "introduction": "background",
        "background": "background",
        "problem": "problem_statement",
        "aim": "specific_aims",
        "objective": "objectives",
        "method": "methods",
        "approach": "methods",
        "implementation": "implementation_plan",
        "team": "team_capacity",
        "budget": "budget_justification",
        "impact": "impact_statement",
        "evaluation": "mel_evaluation",
        "ethics": "ethics",
    }
    for key, stype in mapping.items():
        if key in t:
            return stype
    return "other"


def _queue_embedding_jobs(section_ids: list[str], language_block_ids: list[str]) -> None:
    from app.workers.celery_app import celery_app
    for sid in section_ids:
        celery_app.send_task("app.workers.embedding_tasks.embed_section", args=[sid])
    for bid in language_block_ids:
        celery_app.send_task("app.workers.embedding_tasks.embed_language_block", args=[bid])


def _build_document_structure(split_sections: list[dict]) -> list[dict]:
    return [
        {
            "order": sec.get("order", i + 1),
            "title": sec.get("title", f"Section {i + 1}"),
            "section_type": sec.get("section_type", "other"),
            "word_count": sec.get("word_count") or len((sec.get("text") or "").split()),
            "heading_level": sec.get("heading_level", 1),
        }
        for i, sec in enumerate(split_sections)
    ]


def _sections_for_style_profile(sections: list[ProposalSection]) -> list[dict]:
    """Pick up to 8 representative sections, deduped by section_type."""
    by_type: dict[str, ProposalSection] = {}
    for sec in sorted(sections, key=lambda s: s.section_order or 0):
        if sec.section_type not in by_type:
            by_type[sec.section_type] = sec

    priority = [by_type[t] for t in STYLE_SECTION_TYPES if t in by_type]
    remaining = [s for s in by_type.values() if s not in priority]
    chosen = (priority + remaining)[:8]

    return [
        {
            "section_type": s.section_type,
            "grant_title": s.grant_title,
            "funder": s.funder,
            "outcome": s.outcome,
            "full_text": s.section_text,
        }
        for s in chosen
    ]


async def build_archive_style_fingerprint(
    archive: GrantArchive,
    sections: list[ProposalSection],
) -> dict:
    """Build and persist the style fingerprint inline (used by backfill script)."""
    exemplars = _sections_for_style_profile(sections)
    if not exemplars:
        return {}
    profile = await build_style_profile(
        grant_title=archive.title,
        funder=archive.funder or "",
        grant_idea=archive.notes or archive.title,
        retrieved_sections=exemplars,
    )
    archive.style_fingerprint = profile
    archive.style_indexed_at = datetime.now(timezone.utc)
    return profile


def _queue_style_profile_job(archive_id: str) -> None:
    """Queue the style fingerprint LLM call as a background task."""
    from app.workers.celery_app import celery_app
    celery_app.send_task(
        "app.workers.embedding_tasks.embed_style_profile",
        args=[archive_id],
    )


async def _delete_sections_for_document(db: AsyncSession, document_id: str) -> None:
    """Remove prior sections and linked language blocks before re-index."""
    existing = (
        await db.execute(select(ProposalSection.id).where(ProposalSection.document_id == document_id))
    ).scalars().all()
    if existing:
        await db.execute(
            delete(ReusableLanguageBlock).where(ReusableLanguageBlock.source_section_id.in_(existing))
        )
        await db.execute(delete(ProposalSection).where(ProposalSection.document_id == document_id))


async def ingest_archive_document(
    db: AsyncSession,
    archive: GrantArchive,
    document: Document,
    memory_output: dict | None = None,
    *,
    commit: bool = True,
    replace_existing: bool = True,
    pre_split_sections: list[dict] | None = None,
) -> tuple[list[str], list[str], list[str]]:
    """
    Create ProposalSection rows from a parsed document.
    Returns (section_ids, language_block_ids, warnings).
    """
    text = document.parsed_text or ""
    if pre_split_sections is not None:
        split_sections = pre_split_sections
        split_warnings = []
    else:
        split_sections, split_warnings = await split_proposal_into_sections(text, archive.funder or "")
    section_ids: list[str] = []
    language_block_ids: list[str] = []
    created_sections: list[ProposalSection] = []

    if replace_existing:
        await _delete_sections_for_document(db, document.id)

    archive.document_structure = _build_document_structure(split_sections)

    for sec in split_sections:
        body = sec.get("text") or ""
        if not body.strip():
            continue
        title = sec.get("title") or "Untitled"
        section = ProposalSection(
            id=str(uuid.uuid4()),
            document_id=document.id,
            archive_id=archive.id,
            grant_title=archive.title,
            funder=archive.funder,
            year=archive.call_year,
            outcome=archive.outcome,
            section_type=sec.get("section_type") or _infer_section_type(title),
            section_title=title,
            section_text=body,
            section_order=sec.get("order"),
            heading_level=sec.get("heading_level"),
            word_count=sec.get("word_count") or len(body.split()),
            themes=archive.themes or [],
            geography=archive.geographies or [],
            ai_retrieval_allowed=archive.ai_retrieval_allowed,
            text_reuse_allowed=archive.text_reuse_allowed,
            paraphrase_allowed=True,
        )
        db.add(section)
        section_ids.append(section.id)
        created_sections.append(section)

    section_by_type = {s.section_type: s for s in created_sections}

    if memory_output:
        for candidate in memory_output.get("reusable_language_candidates", [])[:10]:
            block_text = candidate.get("text") or candidate.get("passage") or ""
            if not block_text:
                continue
            stype = candidate.get("type") or "other"
            source_sec = section_by_type.get(stype)
            block_id = str(uuid.uuid4())
            block = ReusableLanguageBlock(
                id=block_id,
                title=candidate.get("title") or candidate.get("type") or "Reusable block",
                text=block_text,
                section_type=stype,
                source_grant=archive.title,
                archive_id=archive.id,
                source_section_id=source_sec.id if source_sec else None,
                approved_for_reuse=True,
                paraphrase_only=not archive.text_reuse_allowed,
            )
            db.add(block)
            language_block_ids.append(block_id)

    if commit:
        await db.commit()
        _queue_embedding_jobs(section_ids, language_block_ids)
        if created_sections:
            _queue_style_profile_job(archive.id)

    return section_ids, language_block_ids, split_warnings


async def reindex_archive_style(
    db: AsyncSession,
    archive: GrantArchive,
    document: Document,
) -> dict:
    """Force full Phase 2 re-index: LLM split, structure, style fingerprint."""
    parsed = document.parsed_text or ""
    split_sections, split_warnings = await split_proposal_into_sections(parsed, archive.funder or "")

    memory = await process_completed_grant(
        grant_title=archive.title,
        funder=archive.funder or "",
        outcome=archive.outcome or "unknown",
        submitted_text=parsed,
        reviewer_feedback=archive.reviewer_feedback or "",
        internal_notes=archive.internal_debrief or "",
        split_sections=split_sections,
    )

    if memory.get("archive_summary") and not archive.notes:
        archive.notes = memory["archive_summary"]
    if memory.get("lessons_learned") and not archive.lessons_learned:
        lessons = memory["lessons_learned"]
        archive.lessons_learned = "\n".join(lessons) if isinstance(lessons, list) else lessons

    section_ids, language_block_ids, ingest_warnings = await ingest_archive_document(
        db, archive, document, memory, commit=True, replace_existing=True,
        pre_split_sections=split_sections,
    )

    return {
        "sections_created": len(section_ids),
        "language_blocks_created": len(language_block_ids),
        "section_ids": section_ids,
        "document_structure": archive.document_structure,
        "style_fingerprint": archive.style_fingerprint,
        "style_indexed_at": str(archive.style_indexed_at) if archive.style_indexed_at else None,
        "warnings": split_warnings + ingest_warnings,
        "message": "Archive re-indexed. Style fingerprint is generating in the background.",
    }


def _parse_archive_file_content(content: bytes, filename: str, document_type: str) -> str:
    """Extract plain text from an archive upload (proposal, call, or budget)."""
    lower = (filename or "").lower()
    if document_type == DocumentType.BUDGET and any(
        lower.endswith(ext) for ext in (".xlsx", ".xls", ".csv")
    ):
        from app.services.budget_parser import parse_budget_file

        items = parse_budget_file(content, filename)
        if not items:
            return ""
        lines = []
        for item in items:
            desc = item.get("description") or "Line item"
            total = item.get("total")
            cat = item.get("category")
            parts = [desc]
            if cat:
                parts.append(f"({cat})")
            if total is not None:
                parts.append(f": {total}")
            lines.append(" ".join(parts))
        return "\n".join(lines).strip()

    return parse_uploaded_bytes(content, filename)


async def _store_archive_document(
    db: AsyncSession,
    archive: GrantArchive,
    file_content: bytes,
    filename: str,
    document_type: str,
    user_id: str,
) -> Document:
    validate_archive_filename(filename)
    if not file_content:
        raise ValueError(f"File is empty: {filename}")

    doc_id = str(uuid.uuid4())
    safe_name = Path(filename).name

    from app.services.storage import build_key, upload_file as r2_upload
    from app.config import get_settings

    r2_key = build_key(safe_name, archive_id=archive.id, doc_id=doc_id)
    r2_upload(r2_key, file_content)

    api_url = get_settings().api_url.rstrip("/")
    doc = Document(
        id=doc_id,
        archive_id=archive.id,
        document_type=document_type,
        file_name=safe_name,
        file_url=f"{api_url}/api/v1/documents/{doc_id}/content",
        file_format=safe_name.rsplit(".", 1)[-1].lower() if "." in safe_name else None,
        processing_status=ProcessingStatus.NOT_PROCESSED,
        uploaded_by_id=user_id,
        ai_retrieval_allowed=archive.ai_retrieval_allowed,
        text_reuse_allowed=archive.text_reuse_allowed,
        notes=r2_key,
    )
    db.add(doc)
    await db.flush()
    return doc


async def create_archive_with_files(
    db: AsyncSession,
    archive_fields: dict,
    proposal_content: bytes,
    proposal_filename: str,
    user_id: str,
    call_content: bytes | None = None,
    call_filename: str | None = None,
    budget_content: bytes | None = None,
    budget_filename: str | None = None,
) -> dict:
    """
    Create archive entry and document records; indexing runs in a background worker.
    """
    validate_proposal_filename(proposal_filename)

    archive_id = str(uuid.uuid4())
    archive = GrantArchive(
        id=archive_id,
        indexing_status="pending",
        **archive_fields,
    )
    db.add(archive)
    await db.flush()

    proposal_doc = await _store_archive_document(
        db, archive, proposal_content, proposal_filename, DocumentType.FULL_PROPOSAL, user_id
    )
    document_ids: dict[str, str] = {"proposal": proposal_doc.id}

    if call_content and call_filename:
        call_doc = await _store_archive_document(
            db, archive, call_content, call_filename, DocumentType.CALL_DOCUMENT, user_id
        )
        document_ids["call"] = call_doc.id

    if budget_content and budget_filename:
        budget_doc = await _store_archive_document(
            db, archive, budget_content, budget_filename, DocumentType.BUDGET, user_id
        )
        document_ids["budget"] = budget_doc.id

    await db.commit()

    from app.workers.celery_app import celery_app

    celery_app.send_task("app.workers.archive_tasks.index_archive", args=[archive_id])

    return {
        "id": archive_id,
        "document_id": proposal_doc.id,
        "document_ids": document_ids,
        "indexing_status": "pending",
        "indexing": "pending",
        "sections_created": 0,
        "message": "Archive entry saved. AI indexing is running in the background.",
    }


async def run_archive_indexing(db: AsyncSession, archive_id: str) -> dict:
    """Parse documents and index the submitted proposal into the RAG corpus."""
    result = await db.execute(select(GrantArchive).where(GrantArchive.id == archive_id))
    archive = result.scalar_one_or_none()
    if not archive:
        raise ValueError(f"Archive not found: {archive_id}")

    archive.indexing_status = "processing"
    archive.indexing_error = None
    await db.commit()

    docs_result = await db.execute(
        select(Document).where(Document.archive_id == archive_id)
    )
    documents = list(docs_result.scalars().all())
    proposal_doc = next(
        (d for d in documents if d.document_type == DocumentType.FULL_PROPOSAL),
        None,
    )
    if not proposal_doc:
        archive.indexing_status = "failed"
        archive.indexing_error = "No submitted proposal document found"
        await db.commit()
        raise ValueError(archive.indexing_error)

    from app.services.storage import download_file, resolve_storage_key

    warnings: list[str] = []

    try:
        for doc in documents:
            r2_key = resolve_storage_key(doc.notes)
            if not r2_key:
                continue
            content = download_file(r2_key)
            parsed_text = _parse_archive_file_content(
                content, doc.file_name or "file.pdf", doc.document_type
            )
            doc.parsed_text = parsed_text
            doc.processing_status = (
                ProcessingStatus.PROCESSED if parsed_text.strip() else ProcessingStatus.FAILED
            )
            if doc.id == proposal_doc.id and not parsed_text.strip():
                raise ValueError(
                    "Could not extract text from the submitted proposal. "
                    "The PDF may be scanned/image-only — try a text-based PDF or DOCX."
                )

        parsed_text = proposal_doc.parsed_text or ""

        # Run section splitting and memory extraction concurrently — they are independent
        # and both make LLM calls, so parallelizing cuts wall-clock time roughly in half.
        (split_sections, split_warnings), memory = await asyncio.gather(
            split_proposal_into_sections(parsed_text, archive.funder or ""),
            process_completed_grant(
                grant_title=archive.title,
                funder=archive.funder or "",
                outcome=archive.outcome or "unknown",
                submitted_text=parsed_text,
                reviewer_feedback=archive.reviewer_feedback or "",
                internal_notes=archive.internal_debrief or "",
                split_sections=None,
            ),
        )
        warnings.extend(split_warnings)

        if memory.get("archive_summary") and not archive.notes:
            archive.notes = memory["archive_summary"]
        if memory.get("lessons_learned") and not archive.lessons_learned:
            lessons = memory["lessons_learned"]
            archive.lessons_learned = (
                "\n".join(lessons) if isinstance(lessons, list) else lessons
            )

        section_ids, language_block_ids, ingest_warnings = await ingest_archive_document(
            db,
            archive,
            proposal_doc,
            memory,
            commit=False,
            replace_existing=True,
            pre_split_sections=split_sections,
        )
        warnings.extend(ingest_warnings)

        for doc in documents:
            if doc.id == proposal_doc.id:
                continue
            if doc.parsed_text and doc.ai_retrieval_allowed:
                from app.workers.celery_app import celery_app

                celery_app.send_task(
                    "app.workers.embedding_tasks.parse_and_embed_document",
                    args=[doc.id],
                )

        archive.indexing_status = "complete"
        archive.indexing_error = None
        await db.commit()
        _queue_embedding_jobs(section_ids, language_block_ids)
        if section_ids:
            _queue_style_profile_job(archive_id)

        return {
            "id": archive_id,
            "document_id": proposal_doc.id,
            "sections_created": len(section_ids),
            "language_blocks_created": len(language_block_ids),
            "indexing_status": "complete",
            "warnings": warnings,
            "message": "Archive indexed for AI retrieval",
        }
    except Exception as exc:
        archive.indexing_status = "failed"
        archive.indexing_error = str(exc)[:2000]
        await db.commit()
        raise


async def create_archive_and_ingest(
    db: AsyncSession,
    archive_fields: dict,
    file_content: bytes,
    filename: str,
    user_id: str,
    upload_dir: "Path | None" = None,
) -> dict:
    """Backwards-compatible wrapper: create archive and queue background indexing."""
    result = await create_archive_with_files(
        db=db,
        archive_fields=archive_fields,
        proposal_content=file_content,
        proposal_filename=filename,
        user_id=user_id,
    )
    return result

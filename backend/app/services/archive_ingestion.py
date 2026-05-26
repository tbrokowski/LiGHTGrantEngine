"""Archive ingestion — split documents into ProposalSection rows for RAG."""
from __future__ import annotations

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
from app.services.document_parser import parse_uploaded_bytes, validate_proposal_filename

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


async def _build_archive_style_fingerprint(
    archive: GrantArchive,
    sections: list[ProposalSection],
) -> dict:
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

    if created_sections:
        await _build_archive_style_fingerprint(archive, created_sections)

    if commit:
        await db.commit()
        _queue_embedding_jobs(section_ids, language_block_ids)

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
        "message": "Archive re-indexed with structure and style fingerprint",
    }


async def create_archive_and_ingest(
    db: AsyncSession,
    archive_fields: dict,
    file_content: bytes,
    filename: str,
    user_id: str,
    upload_dir: "Path | None" = None,
) -> dict:
    """
    Create archive entry, parse proposal, index into RAG corpus.
    Rolls back on parse failure (no orphan archive row).
    upload_dir is kept as an optional parameter for backwards compatibility
    but is no longer used — files go to R2.
    """
    validate_proposal_filename(filename)
    parsed_text = parse_uploaded_bytes(file_content, filename)
    if not parsed_text.strip():
        raise ValueError(
            "Could not extract text from the proposal file. "
            "The PDF may be scanned/image-only — try a text-based PDF or DOCX."
        )

    archive_id = str(uuid.uuid4())
    archive = GrantArchive(id=archive_id, **archive_fields)
    db.add(archive)
    await db.flush()

    doc_id = str(uuid.uuid4())
    safe_name = Path(filename).name

    # Upload archive document to R2
    from app.services.storage import build_key, upload_file as r2_upload
    r2_key = build_key(safe_name, archive_id=archive_id, doc_id=doc_id)
    r2_upload(r2_key, file_content)

    from app.config import get_settings
    api_url = get_settings().api_url.rstrip("/")
    doc = Document(
        id=doc_id,
        archive_id=archive_id,
        document_type=DocumentType.FULL_PROPOSAL,
        file_name=safe_name,
        file_url=f"{api_url}/api/v1/documents/{doc_id}/content",
        file_format=safe_name.rsplit(".", 1)[-1].lower(),
        parsed_text=parsed_text,
        processing_status=ProcessingStatus.PROCESSED,
        uploaded_by_id=user_id,
        ai_retrieval_allowed=archive.ai_retrieval_allowed,
        text_reuse_allowed=archive.text_reuse_allowed,
        notes=r2_key,
    )
    db.add(doc)
    await db.flush()

    split_sections, split_warnings = await split_proposal_into_sections(parsed_text, archive.funder or "")

    memory = await process_completed_grant(
        grant_title=archive.title,
        funder=archive.funder or "",
        outcome=archive.outcome or "unknown",
        submitted_text=parsed_text,
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
        db, archive, doc, memory, commit=False, replace_existing=False,
        pre_split_sections=split_sections,
    )

    warnings = split_warnings + ingest_warnings

    await db.commit()
    _queue_embedding_jobs(section_ids, language_block_ids)

    return {
        "id": archive_id,
        "document_id": doc_id,
        "sections_created": len(section_ids),
        "language_blocks_created": len(language_block_ids),
        "section_ids": section_ids,
        "document_structure": archive.document_structure,
        "style_indexed": bool(archive.style_fingerprint),
        "indexing": "complete",
        "warnings": warnings,
        "message": "Archive entry created and indexed for AI retrieval",
    }

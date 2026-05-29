"""
RAG Retrieval Layer — permission-aware hybrid search over the grant archive.
Supports style, content, and format retrieval modes.

All public retrieval functions accept an optional `accessible_grant_ids` parameter.
When provided, ProposalSection results are filtered to only include sections that:
  - come from a grant archive entry (archive_id IS NOT NULL) — org-wide
  - OR come from a document whose grant_id is NULL (not grant-specific)
  - OR come from a document whose grant_id is in accessible_grant_ids
"""
from typing import Optional

import structlog
from sqlalchemy import select, text, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.client import get_embedding
from app.config import get_settings
from app.models.archive import GrantArchive
from app.models.document import Document
from app.models.section import ProposalSection
from app.models.language import ReusableLanguageBlock

logger = structlog.get_logger()
settings = get_settings()

OUTCOME_BOOST = {
    "awarded": 0.15,
    "partially_funded": 0.10,
    "pending": 0.0,
    "rejected": -0.10,
    "withdrawn": -0.05,
    "deferred": -0.05,
    "not_submitted": -0.05,
    "resubmitted": 0.05,
}


def _reuse_label(section: ProposalSection) -> str:
    if section.text_reuse_allowed:
        return "direct_reuse_allowed"
    elif section.paraphrase_allowed:
        return "paraphrase_only"
    return "context_only"


def _build_warnings(section: ProposalSection) -> list[str]:
    warnings = []
    if section.contains_confidential:
        warnings.append("Contains confidential information — do not reuse directly")
    if section.contains_pii:
        warnings.append("Contains personal data — review before use")
    if section.is_outdated:
        warnings.append("Marked as outdated — verify before using")
    if not section.text_reuse_allowed and not section.paraphrase_allowed:
        warnings.append("Context only — text reuse not permitted")
    return warnings


def _section_to_dict(section: ProposalSection, relevance_score: float) -> dict:
    return {
        "id": section.id,
        "source": "section",
        "grant_title": section.grant_title,
        "funder": section.funder,
        "year": section.year,
        "outcome": section.outcome,
        "section_type": section.section_type,
        "section_title": section.section_title,
        "text_snippet": section.section_text[:500] + "..." if len(section.section_text) > 500 else section.section_text,
        "full_text": section.section_text,
        "relevance_score": round(relevance_score, 3),
        "reuse_permission": _reuse_label(section),
        "warnings": _build_warnings(section),
        "archive_id": section.archive_id,
        # Populated for workspace reference docs (no archive_id, but has grant_id)
        "grant_id": getattr(section, "grant_id", None),
        "is_reference_doc": section.archive_id is None and getattr(section, "grant_id", None) is not None,
    }


def _outcome_boost(outcome: str | None) -> float:
    return OUTCOME_BOOST.get(outcome or "", 0.0)


def _quality_boost(section: ProposalSection) -> float:
    if section.quality_rating:
        return section.quality_rating / 5.0
    return 1.0


def _keyword_score(section: ProposalSection, query_words: list[str]) -> float:
    if not query_words:
        return 0.0
    haystack = " ".join(filter(None, [
        section.section_title or "",
        section.section_type or "",
        section.funder or "",
        section.grant_title or "",
    ])).lower()
    hits = sum(1 for w in query_words if w.lower() in haystack)
    return min(1.0, hits / max(len(query_words), 1))


def _hybrid_score(vector_sim: float, keyword_sim: float, section: ProposalSection) -> float:
    rag_cfg = settings.rag
    base = (rag_cfg.vector_weight * vector_sim) + (rag_cfg.keyword_weight * keyword_sim)
    return base * _quality_boost(section) + _outcome_boost(section.outcome)


def _grant_access_filter(accessible_grant_ids: Optional[list[str]]) -> Optional[object]:
    """
    Returns a SQLAlchemy filter clause that restricts ProposalSection results
    to sections the caller has access to.  Returns None (no extra filter) when
    accessible_grant_ids is not provided (i.e. org-admin bypass).
    """
    if accessible_grant_ids is None:
        return None

    accessible_doc_ids_subq = (
        select(Document.id).where(
            or_(
                Document.grant_id.is_(None),
                Document.grant_id.in_(accessible_grant_ids),
            )
        )
    ).scalar_subquery()

    return or_(
        ProposalSection.archive_id.isnot(None),
        ProposalSection.document_id.in_(accessible_doc_ids_subq),
    )


async def _vector_candidates(
    db: AsyncSession,
    query_embedding: list[float],
    filters: list,
    limit: int,
) -> list[tuple[ProposalSection, float]]:
    embedding_str = f"[{','.join(str(x) for x in query_embedding)}]"
    vector_q = (
        select(
            ProposalSection,
            text(f"embedding <=> '{embedding_str}'::vector AS distance"),
        )
        .where(ProposalSection.embedding.isnot(None))
    )
    if filters:
        vector_q = vector_q.where(and_(*filters))
    vector_q = vector_q.order_by(text("distance")).limit(limit)

    rows = await db.execute(vector_q)
    results = []
    for section, distance in rows:
        similarity = 1.0 - float(distance)
        results.append((section, similarity))
    return results


async def retrieve_style_exemplars(
    db: AsyncSession,
    section_type: Optional[str] = None,
    funder: Optional[str] = None,
    top_k: Optional[int] = None,
    accessible_grant_ids: Optional[list[str]] = None,
) -> list[dict]:
    """
    Metadata-first retrieval for writing voice and tone.
    Prefers awarded grants and archives with style fingerprints.
    """
    rag_cfg = settings.rag
    k = top_k or rag_cfg.top_k

    filters = []
    if rag_cfg.enforce_ai_permissions:
        filters.append(ProposalSection.ai_retrieval_allowed == True)
    if section_type:
        filters.append(ProposalSection.section_type == section_type)
    if funder:
        filters.append(ProposalSection.funder.ilike(f"%{funder}%"))
    grant_filter = _grant_access_filter(accessible_grant_ids)
    if grant_filter is not None:
        filters.append(grant_filter)

    style_query = f"grant writing {section_type or 'proposal'} institutional voice"
    query_embedding = await get_embedding(style_query)

    try:
        candidates = await _vector_candidates(db, query_embedding, filters, k * 3)
    except Exception as e:
        logger.warning("Style vector retrieval failed", error=str(e))
        candidates = []

    # Boost sections from archives with style fingerprints
    archive_ids = {s.archive_id for s, _ in candidates if s.archive_id}
    styled_archives: set[str] = set()
    if archive_ids:
        arch_rows = await db.execute(
            select(GrantArchive.id).where(
                GrantArchive.id.in_(archive_ids),
                GrantArchive.style_fingerprint.isnot(None),
            )
        )
        styled_archives = {r[0] for r in arch_rows.all()}

    query_words = style_query.split()
    scored: list[tuple[ProposalSection, float]] = []
    for section, vector_sim in candidates:
        keyword_sim = _keyword_score(section, query_words)
        score = _hybrid_score(vector_sim, keyword_sim, section)
        if section.archive_id in styled_archives:
            score += 0.05
        if score < rag_cfg.min_similarity - 0.2:
            continue
        scored.append((section, score))

    scored.sort(key=lambda x: x[1], reverse=True)
    return [_section_to_dict(s, sc) for s, sc in scored[:k]]


async def retrieve_content_exemplars(
    query: str,
    db: AsyncSession,
    section_type: Optional[str] = None,
    funder: Optional[str] = None,
    themes: Optional[list[str]] = None,
    top_k: Optional[int] = None,
    require_ai_retrieval: bool = True,
    accessible_grant_ids: Optional[list[str]] = None,
    current_grant_id: Optional[str] = None,
) -> list[dict]:
    """Topic-relevant retrieval for substantive content inspiration.

    When `current_grant_id` is provided, workspace-uploaded reference documents
    indexed for that grant are always included in the candidate pool alongside
    the org-wide archive sections.
    """
    rag_cfg = settings.rag
    k = top_k or rag_cfg.top_k

    filters = []
    if require_ai_retrieval and rag_cfg.enforce_ai_permissions:
        filters.append(ProposalSection.ai_retrieval_allowed == True)
    if section_type:
        filters.append(ProposalSection.section_type == section_type)
    if funder:
        filters.append(ProposalSection.funder.ilike(f"%{funder}%"))
    grant_filter = _grant_access_filter(accessible_grant_ids)
    if grant_filter is not None:
        # Always include per-grant reference sections regardless of access filter
        if current_grant_id:
            filters.append(
                or_(grant_filter, ProposalSection.grant_id == current_grant_id)
            )
        else:
            filters.append(grant_filter)
    elif current_grant_id:
        # No access filter, but still scope reference docs to this grant
        filters.append(
            or_(
                ProposalSection.archive_id.isnot(None),
                ProposalSection.grant_id == current_grant_id,
            )
        )

    query_embedding = await get_embedding(query)
    query_words = query.split()[:8]

    try:
        candidates = await _vector_candidates(db, query_embedding, filters, k * 2)
    except Exception as e:
        logger.warning("Content vector retrieval failed, using keyword fallback", error=str(e))
        return await _keyword_fallback(query, db, filters, k)

    scored: list[tuple[ProposalSection, float]] = []
    for section, vector_sim in candidates:
        keyword_sim = _keyword_score(section, query_words)
        score = _hybrid_score(vector_sim, keyword_sim, section)

        if themes and section.themes:
            overlap = len(set(themes) & set(section.themes))
            score += overlap * 0.03

        if score < rag_cfg.min_similarity:
            continue
        scored.append((section, score))

    scored.sort(key=lambda x: x[1], reverse=True)
    return [_section_to_dict(s, sc) for s, sc in scored[:k]]


async def retrieve_document_structure(
    db: AsyncSession,
    funder: Optional[str] = None,
    top_k: int = 3,
) -> list[dict]:
    """Retrieve structural templates from archived grants."""
    q = select(GrantArchive).where(GrantArchive.document_structure.isnot(None))
    if funder:
        q = q.where(GrantArchive.funder.ilike(f"%{funder}%"))

    result = await db.execute(q)
    archives = result.scalars().all()

    def rank(archive: GrantArchive) -> tuple:
        funder_match = 1 if funder and archive.funder and funder.lower() in archive.funder.lower() else 0
        outcome_rank = {"awarded": 3, "partially_funded": 2, "resubmitted": 1}.get(archive.outcome or "", 0)
        year = archive.call_year or 0
        has_style = 1 if archive.style_fingerprint else 0
        return (funder_match, outcome_rank, has_style, year)

    archives.sort(key=rank, reverse=True)

    templates = []
    for archive in archives[:top_k]:
        structure = archive.document_structure or []
        if not structure:
            continue
        templates.append({
            "archive_id": archive.id,
            "grant_title": archive.title,
            "funder": archive.funder,
            "outcome": archive.outcome,
            "call_year": archive.call_year,
            "sections": structure,
            "total_word_count": sum(s.get("word_count", 0) for s in structure),
        })
    return templates


async def retrieve_similar_sections(
    query: str,
    db: AsyncSession,
    section_type: Optional[str] = None,
    funder: Optional[str] = None,
    outcome: Optional[str] = None,
    top_k: Optional[int] = None,
    require_ai_retrieval: bool = True,
    accessible_grant_ids: Optional[list[str]] = None,
    current_grant_id: Optional[str] = None,
) -> list[dict]:
    """Backward-compatible wrapper — delegates to content exemplar retrieval."""
    results = await retrieve_content_exemplars(
        query=query,
        db=db,
        section_type=section_type,
        funder=funder,
        top_k=top_k,
        require_ai_retrieval=require_ai_retrieval,
        accessible_grant_ids=accessible_grant_ids,
        current_grant_id=current_grant_id,
    )
    if outcome:
        results = [r for r in results if r.get("outcome") == outcome] + [
            r for r in results if r.get("outcome") != outcome
        ]
    return results


async def retrieve_reusable_language(
    query: str,
    db: AsyncSession,
    section_type: Optional[str] = None,
    top_k: int = 5,
) -> list[dict]:
    """Retrieve approved reusable language blocks."""
    embedding = await get_embedding(query)
    embedding_str = f"[{','.join(str(x) for x in embedding)}]"

    filters = [
        ReusableLanguageBlock.approved_for_reuse == True,
        ReusableLanguageBlock.do_not_reuse == False,
    ]
    if section_type:
        filters.append(ReusableLanguageBlock.section_type == section_type)

    q = (
        select(ReusableLanguageBlock, text(f"embedding <=> '{embedding_str}'::vector AS distance"))
        .where(and_(*filters))
        .where(ReusableLanguageBlock.embedding.isnot(None))
        .order_by(text("distance"))
        .limit(top_k)
    )

    try:
        rows = await db.execute(q)
        results = []
        for block, distance in rows:
            similarity = 1.0 - float(distance)
            results.append({
                "id": block.id,
                "title": block.title,
                "source_grant": block.source_grant,
                "section_type": block.section_type,
                "text_snippet": block.text[:400] + "..." if len(block.text) > 400 else block.text,
                "full_text": block.text,
                "relevance_score": round(similarity, 3),
                "paraphrase_only": block.paraphrase_only,
                "usage_notes": block.usage_notes,
            })
        return results
    except Exception as e:
        logger.warning("Language block retrieval failed", error=str(e))
        return []


async def retrieve_archive_style_fingerprints(
    db: AsyncSession,
    funder: Optional[str] = None,
    top_k: int = 3,
) -> list[dict]:
    """Load pre-computed style fingerprints from archived grants."""
    q = select(GrantArchive).where(GrantArchive.style_fingerprint.isnot(None))
    if funder:
        q = q.where(GrantArchive.funder.ilike(f"%{funder}%"))
    result = await db.execute(q)
    archives = result.scalars().all()

    def rank(a: GrantArchive) -> tuple:
        funder_match = 1 if funder and a.funder and funder.lower() in a.funder.lower() else 0
        outcome_rank = {"awarded": 2, "partially_funded": 1}.get(a.outcome or "", 0)
        return (funder_match, outcome_rank, a.call_year or 0)

    archives.sort(key=rank, reverse=True)
    return [
        {
            "archive_id": a.id,
            "grant_title": a.title,
            "funder": a.funder,
            "outcome": a.outcome,
            "style_fingerprint": a.style_fingerprint,
        }
        for a in archives[:top_k]
    ]


async def _keyword_fallback(query: str, db: AsyncSession, filters: list, k: int) -> list[dict]:
    """Keyword fallback when vector search fails."""
    words = query.split()[:5]
    q = select(ProposalSection)
    if filters:
        q = q.where(and_(*filters))
    for word in words:
        q = q.where(or_(
            ProposalSection.section_text.ilike(f"%{word}%"),
            ProposalSection.section_title.ilike(f"%{word}%"),
        ))
    q = q.limit(k)
    result = await db.execute(q)
    return [_section_to_dict(s, 0.5) for s in result.scalars().all()]

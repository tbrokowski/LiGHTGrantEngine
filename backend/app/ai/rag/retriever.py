"""
RAG Retrieval Layer — permission-aware hybrid search over the grant archive.
Retrieves section-level passages, not full documents.
"""
from typing import Optional
import structlog
from sqlalchemy import select, text, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.client import get_embedding
from app.config import get_settings
from app.models.section import ProposalSection
from app.models.language import ReusableLanguageBlock

logger = structlog.get_logger()
settings = get_settings()


async def retrieve_similar_sections(
    query: str,
    db: AsyncSession,
    section_type: Optional[str] = None,
    funder: Optional[str] = None,
    outcome: Optional[str] = None,
    top_k: Optional[int] = None,
    require_ai_retrieval: bool = True,
) -> list[dict]:
    """
    Hybrid retrieval: vector similarity + keyword + metadata filters.
    Returns section-level results with source attribution.
    """
    rag_cfg = settings.rag
    k = top_k or rag_cfg.top_k

    # Get query embedding
    query_embedding = await get_embedding(query)

    # Build filter conditions
    filters = []
    if require_ai_retrieval and rag_cfg.enforce_ai_permissions:
        filters.append(ProposalSection.ai_retrieval_allowed == True)
    if section_type:
        filters.append(ProposalSection.section_type == section_type)
    if funder:
        filters.append(ProposalSection.funder.ilike(f"%{funder}%"))
    if outcome:
        filters.append(ProposalSection.outcome == outcome)

    # Vector search using pgvector cosine distance
    # <=> is cosine distance operator in pgvector
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

    vector_q = vector_q.order_by(text("distance")).limit(k * 2)

    try:
        rows = await db.execute(vector_q)
        results = []
        for section, distance in rows:
            similarity = 1.0 - float(distance)
            if similarity < rag_cfg.min_similarity:
                continue
            results.append({
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
                "relevance_score": round(similarity, 3),
                "reuse_permission": _reuse_label(section),
                "warnings": _build_warnings(section),
                "archive_id": section.archive_id,
            })
        return sorted(results, key=lambda x: x["relevance_score"], reverse=True)[:k]
    except Exception as e:
        logger.warning("Vector retrieval failed, falling back to keyword search", error=str(e))
        return await _keyword_fallback(query, db, filters, k)


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


def _reuse_label(section: ProposalSection) -> str:
    if section.text_reuse_allowed:
        return "direct_reuse_allowed"
    elif section.paraphrase_allowed:
        return "paraphrase_only"
    else:
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


async def _keyword_fallback(query: str, db: AsyncSession, filters: list, k: int) -> list[dict]:
    """Simple keyword fallback when vector search fails."""
    words = query.split()[:5]
    q = select(ProposalSection)
    if filters:
        q = q.where(and_(*filters))
    for word in words:
        q = q.where(ProposalSection.section_text.ilike(f"%{word}%"))
    q = q.limit(k)
    result = await db.execute(q)
    return [{
        "id": s.id, "source": "section", "grant_title": s.grant_title,
        "funder": s.funder, "year": s.year, "outcome": s.outcome,
        "section_type": s.section_type, "text_snippet": s.section_text[:400],
        "full_text": s.section_text, "relevance_score": 0.5,
        "reuse_permission": _reuse_label(s), "warnings": _build_warnings(s),
    } for s in result.scalars().all()]

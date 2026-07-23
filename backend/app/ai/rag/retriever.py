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

from app.ai.client import get_embedding, chat_complete
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
    body_snip = (section.section_text or "")[:2000]
    haystack = " ".join(filter(None, [
        section.section_title or "",
        section.section_type or "",
        section.funder or "",
        section.grant_title or "",
        body_snip,
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


async def _chunk_vector_candidates(
    db: AsyncSession,
    query_embedding: list[float],
    filters: list,
    limit: int,
) -> tuple[list[tuple[ProposalSection, float]], dict[str, tuple[str, str | None]]]:
    """Contextual-retrieval candidate generation: match at chunk granularity, then
    map back to parent sections (best chunk per section wins).

    Returns (candidates, matched) where candidates is [(section, similarity)] just
    like _vector_candidates, and matched maps section_id -> (chunk_text, context)
    so callers can surface the exact passage that matched. `filters` are the same
    ProposalSection clauses used for whole-section retrieval and are applied via a
    join, so permissions/section_type/funder scoping carry over unchanged.
    """
    from app.models.section_chunk import SectionChunk

    embedding_str = f"[{','.join(str(x) for x in query_embedding)}]"
    q = (
        select(
            ProposalSection,
            SectionChunk.chunk_text,
            SectionChunk.context,
            text(f"section_chunks.embedding <=> '{embedding_str}'::vector AS distance"),
        )
        .join(SectionChunk, SectionChunk.section_id == ProposalSection.id)
        .where(SectionChunk.embedding.isnot(None))
    )
    if filters:
        q = q.where(and_(*filters))
    q = q.order_by(text("distance")).limit(limit * 3)

    rows = await db.execute(q)
    best_sim: dict[str, float] = {}
    best_section: dict[str, ProposalSection] = {}
    matched: dict[str, tuple[str, str | None]] = {}
    for section, chunk_text, context, distance in rows:
        sim = 1.0 - float(distance)
        if section.id not in best_sim or sim > best_sim[section.id]:
            best_sim[section.id] = sim
            best_section[section.id] = section
            matched[section.id] = (chunk_text, context)
        if len(best_sim) >= limit and section.id in best_sim:
            # keep collecting only to improve already-seen sections is unnecessary
            pass

    candidates = sorted(
        ((best_section[sid], best_sim[sid]) for sid in best_sim),
        key=lambda x: x[1],
        reverse=True,
    )[:limit]
    return candidates, matched


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


async def _llm_rerank(query: str, candidates: list[dict], top_k: int) -> list[dict]:
    """Reorder candidate sections by true relevance to `query` using an LLM judge.

    Returns the top_k candidates in reranked order. On any failure (or if disabled)
    the caller keeps the original hybrid ordering — reranking is purely additive.
    """
    if not candidates:
        return []
    # Compact numbered menu of candidates — title + a text window, enough for the
    # judge to assess relevance without blowing the context budget.
    menu = []
    for i, c in enumerate(candidates):
        snippet = (c.get("full_text") or c.get("text_snippet") or "")[:700]
        menu.append(
            f"[{i}] {c.get('grant_title', '?')} · {c.get('section_type', '?')} · "
            f"outcome={c.get('outcome', '?')}\n{snippet}"
        )
    prompt = (
        f"Query: {query}\n\n"
        f"Candidate passages from a grant archive:\n\n" + "\n\n".join(menu) + "\n\n"
        f"Return ONLY a JSON array of the candidate indices, most relevant first, "
        f"including at most {top_k}. Judge by how directly each passage helps answer "
        f"or write about the query — reward specific methods, numbers, and named "
        f"programs; drop off-topic passages entirely. Example: [3,0,7]"
    )
    try:
        import json as _json
        raw = await chat_complete(
            messages=[
                {"role": "system", "content": "You are a precise retrieval reranker. Output only a JSON array of integers."},
                {"role": "user", "content": prompt},
            ],
            agent_name="rag_reranker",
        )
        start, end = raw.find("["), raw.rfind("]")
        if start == -1 or end == -1:
            raise ValueError("no JSON array in rerank response")
        order = _json.loads(raw[start : end + 1])
        seen: set[int] = set()
        ranked: list[dict] = []
        for idx in order:
            if isinstance(idx, int) and 0 <= idx < len(candidates) and idx not in seen:
                seen.add(idx)
                ranked.append(candidates[idx])
        # Append any candidates the judge omitted, preserving hybrid order, so we
        # never return fewer than available (rerank refines order, not recall).
        for i, c in enumerate(candidates):
            if i not in seen:
                ranked.append(c)
        return ranked[:top_k]
    except Exception as exc:
        logger.warning("LLM rerank failed, keeping hybrid order", error=str(exc))
        return candidates[:top_k]


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
    archive_ids: Optional[list[str]] = None,
    rerank: bool = True,
) -> list[dict]:
    """Topic-relevant retrieval for substantive content inspiration.

    When `current_grant_id` is provided, workspace-uploaded reference documents
    indexed for that grant are always included in the candidate pool alongside
    the org-wide archive sections.

    When `archive_ids` is provided, results are scoped to those specific archive
    entries only — used for "look up this named prior proposal" lookups (see
    retrieve_from_named_archive) rather than a generic archive-wide search.
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
    if archive_ids:
        filters.append(ProposalSection.archive_id.in_(archive_ids))
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

    # Pull a wider candidate pool when the reranker is on — it needs headroom to
    # reorder, and precision comes from the rerank, not from a tight vector cutoff.
    use_reranker = rerank and rag_cfg.use_reranker
    pool = max(k * 2, rag_cfg.rerank_candidates) if use_reranker else k * 2

    # Contextual chunks first (precise passage matching); fall back to whole-section
    # embeddings for sections that haven't been chunked yet (e.g. pre-backfill) or
    # if the chunk store isn't available (e.g. before migration 050).
    matched_chunks: dict[str, tuple[str, str | None]] = {}
    candidates: list[tuple[ProposalSection, float]] = []
    if rag_cfg.use_contextual_chunks:
        try:
            candidates, matched_chunks = await _chunk_vector_candidates(
                db, query_embedding, filters, pool
            )
        except Exception as e:
            logger.warning("Chunk retrieval unavailable, using whole-section vectors", error=str(e))
            candidates, matched_chunks = [], {}
            # Reset the aborted transaction so the whole-section fallback can run.
            try:
                await db.rollback()
            except Exception:
                pass
    try:
        if not candidates:
            candidates = await _vector_candidates(db, query_embedding, filters, pool)
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

    def _to_dict(section: ProposalSection, sc: float) -> dict:
        d = _section_to_dict(section, sc)
        hit = matched_chunks.get(section.id)
        if hit:
            d["matched_chunk"] = hit[0]
            d["chunk_context"] = hit[1]
        return d

    if use_reranker and len(scored) > 1:
        pool_dicts = [_to_dict(s, sc) for s, sc in scored[: rag_cfg.rerank_candidates]]
        return await _llm_rerank(query, pool_dicts, k)

    return [_to_dict(s, sc) for s, sc in scored[:k]]


async def retrieve_from_named_archive(
    archive_name_query: str,
    content_query: str,
    db: AsyncSession,
    section_type: Optional[str] = None,
    top_k: int = 5,
    accessible_grant_ids: Optional[list[str]] = None,
) -> dict:
    """Resolve a named prior proposal (e.g. "CADLUS4TB") to its archive entry, then
    search within just that entry's sections — for explicit lookups like "give me
    the methods from CADLUS4TB relevant to this section", as opposed to a generic
    archive-wide search that has no way to target one specific past proposal.

    Returns {"matched_archives": [...titles...], "results": [...]} on success, or
    {"matched_archives": [], "results": [], "error": "..."} if no archive title
    matches archive_name_query.
    """
    archive_rows = await db.execute(
        select(GrantArchive).where(GrantArchive.title.ilike(f"%{archive_name_query}%")).limit(5)
    )
    archives = archive_rows.scalars().all()
    if not archives:
        return {
            "matched_archives": [],
            "results": [],
            "error": f"No archive entry found matching '{archive_name_query}'.",
        }

    archive_ids = [a.id for a in archives]
    results = await retrieve_content_exemplars(
        query=content_query,
        db=db,
        section_type=section_type,
        top_k=top_k,
        archive_ids=archive_ids,
        accessible_grant_ids=accessible_grant_ids,
    )
    return {
        "matched_archives": [a.title for a in archives],
        "results": results,
    }


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


# ---------------------------------------------------------------------------
# HyDE (Hypothetical Document Embedding) retrieval
# ---------------------------------------------------------------------------

_HYDE_SYSTEM = (
    "You are a grant writing expert. Write a concise, specific excerpt from a "
    "high-scoring competitive grant proposal. Use technical language, specific methods, "
    "measurable outcomes, and evidence-based claims. Write ONLY the excerpt — no preamble."
)


async def retrieve_with_hyde(
    hyde_prompt: str,
    db: AsyncSession,
    funder: Optional[str] = None,
    section_type: Optional[str] = None,
    top_k: int = 5,
    current_grant_id: Optional[str] = None,
) -> list[dict]:
    """HyDE-enhanced archive retrieval for a single skeleton section.

    Instead of embedding the raw section name or query, we:
      1. Ask an LLM to write a ~120-word hypothetical excerpt from a winning proposal
      2. Embed that hypothetical text (captures domain vocabulary better than a short query)
      3. Use it to retrieve semantically similar archive sections

    This bridges the vocabulary gap between a section concept and how archive
    documents actually express that content, significantly improving recall.

    Falls back to a keyword search if HyDE generation fails.
    """
    # Step 1: generate the hypothetical excerpt
    try:
        hyp_text = await chat_complete(
            messages=[
                {"role": "system", "content": _HYDE_SYSTEM},
                {"role": "user", "content": hyde_prompt},
            ],
            agent_name="hyde_expander",
        )
        if not hyp_text or not hyp_text.strip():
            raise ValueError("empty HyDE response")
    except Exception as exc:
        logger.warning("HyDE generation failed, falling back to prompt as query", error=str(exc))
        hyp_text = hyde_prompt  # fall back to using the prompt itself as query

    # Step 2 & 3: embed the hypothetical text and retrieve via existing infrastructure
    return await retrieve_content_exemplars(
        query=hyp_text,
        db=db,
        section_type=section_type,
        funder=funder,
        top_k=top_k,
        current_grant_id=current_grant_id,
    )


async def retrieve_entity_mentions(
    entity: str,
    db: AsyncSession,
    funder: Optional[str] = None,
    top_k: int = 5,
    current_grant_id: Optional[str] = None,
) -> list[dict]:
    """Literal text match in section body for acronyms/program names (MOOVE, DISCO)."""
    if not entity or len(entity) < 2:
        return []
    filters = [ProposalSection.ai_retrieval_allowed == True]
    if funder:
        filters.append(ProposalSection.funder.ilike(f"%{funder}%"))
    grant_filter = _grant_access_filter(None)
    if current_grant_id:
        filters.append(
            or_(
                ProposalSection.archive_id.isnot(None),
                ProposalSection.grant_id == current_grant_id,
            )
        )
    q = select(ProposalSection).where(
        and_(*filters),
        ProposalSection.section_text.ilike(f"%{entity}%"),
    ).limit(top_k * 2)
    result = await db.execute(q)
    sections = result.scalars().all()
    out = []
    for s in sections:
        out.append(_section_to_dict(s, 0.85))
        if len(out) >= top_k:
            break
    return out


async def retrieve_for_concept(
    concept: str,
    db: AsyncSession,
    funder: Optional[str] = None,
    current_grant_id: Optional[str] = None,
    top_k: int = 4,
) -> list[dict]:
    """Vector + entity retrieval merged for a named concept."""
    vector_hits = await retrieve_content_exemplars(
        query=concept,
        db=db,
        funder=funder,
        top_k=top_k,
        current_grant_id=current_grant_id,
    )
    entity_hits = await retrieve_entity_mentions(
        entity=concept,
        db=db,
        funder=funder,
        top_k=top_k,
        current_grant_id=current_grant_id,
    )
    seen_ids: set[str] = set()
    merged: list[dict] = []
    for item in entity_hits + vector_hits:
        sid = str(item.get("id", ""))
        if sid and sid in seen_ids:
            continue
        if sid:
            seen_ids.add(sid)
        merged.append(item)
        if len(merged) >= top_k:
            break
    return merged

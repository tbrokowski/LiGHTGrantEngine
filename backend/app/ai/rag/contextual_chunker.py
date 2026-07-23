"""Contextual-retrieval chunking for archived proposal sections.

Implements Anthropic's "Contextual Retrieval": before embedding, each chunk is
prefixed with a short LLM-generated context that situates it within its section
and grant. Embedding `context + chunk` (rather than the bare chunk) markedly
improves retrieval of specific facts/phrasing from long documents.

Public entry point: build_chunks_for_section(section) -> list[ChunkPayload],
each carrying the raw chunk, its context, and the exact text to embed.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

import structlog

from app.ai.client import chat_complete
from app.config import get_settings

logger = structlog.get_logger()


@dataclass
class ChunkPayload:
    chunk_index: int
    chunk_text: str
    context: str | None
    embed_input: str  # what actually gets embedded (context + chunk, or chunk)


def _split_paragraphs(text: str) -> list[str]:
    parts = re.split(r"\n\s*\n", text.strip())
    return [p.strip() for p in parts if p.strip()]


def split_into_chunks(text: str, target_words: int, overlap_words: int) -> list[str]:
    """Paragraph-aware packing into ~target_words windows with sentence overlap.

    Keeps paragraph boundaries where possible; oversized paragraphs are split on
    sentence boundaries. Consecutive chunks share ~overlap_words of tail context
    so a fact straddling a boundary is still retrievable from both sides.
    """
    text = (text or "").strip()
    if not text:
        return []
    words_total = len(text.split())
    if words_total <= target_words:
        return [text]

    # Break into sentence-ish units first so we never cut mid-sentence.
    units: list[str] = []
    for para in _split_paragraphs(text):
        if len(para.split()) <= target_words:
            units.append(para)
        else:
            units.extend(s.strip() for s in re.split(r"(?<=[.!?])\s+", para) if s.strip())

    chunks: list[str] = []
    cur: list[str] = []
    cur_words = 0
    for unit in units:
        uw = len(unit.split())
        if cur and cur_words + uw > target_words:
            chunks.append(" ".join(cur))
            # Start next chunk with an overlapping tail of the previous one.
            if overlap_words > 0:
                tail = " ".join(" ".join(cur).split()[-overlap_words:])
                cur = [tail]
                cur_words = len(tail.split())
            else:
                cur, cur_words = [], 0
        cur.append(unit)
        cur_words += uw
    if cur:
        chunks.append(" ".join(cur))
    return chunks


_CONTEXT_SYSTEM = (
    "You situate an excerpt within a grant proposal so it can be retrieved out of "
    "context later. Given the surrounding section and one chunk from it, write a "
    "single short sentence (max 30 words) naming what the chunk is about — the "
    "program/method/population/claim it concerns — using concrete nouns from the "
    "text. Output ONLY that sentence, no preamble."
)


async def _generate_context(
    section_text: str,
    chunk_text: str,
    grant_title: str | None,
    section_type: str | None,
) -> str | None:
    """One-sentence contextual prefix for a chunk. Best-effort — returns None on failure."""
    try:
        prompt = (
            f"Grant: {grant_title or 'Unknown'} | Section type: {section_type or 'other'}\n\n"
            f"Section (for context, truncated):\n{section_text[:4000]}\n\n"
            f"Chunk to situate:\n{chunk_text[:1500]}"
        )
        out = await chat_complete(
            messages=[
                {"role": "system", "content": _CONTEXT_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            agent_name="contextual_chunker",
            max_tokens=80,
        )
        out = (out or "").strip()
        return out[:400] or None
    except Exception as exc:
        logger.warning("chunk context generation failed", error=str(exc))
        return None


async def build_chunks_for_section(section) -> list[ChunkPayload]:
    """Chunk a ProposalSection and attach a generated context to each chunk.

    Bounded by rag.chunk_max_per_section to cap per-section LLM/embedding cost on
    very long sections. Context generation is skipped (chunk embedded raw) when
    rag.contextual_context_enabled is false.
    """
    rag = get_settings().rag
    raw_chunks = split_into_chunks(
        section.section_text or "",
        target_words=rag.chunk_target_words,
        overlap_words=rag.chunk_overlap_words,
    )
    raw_chunks = raw_chunks[: rag.chunk_max_per_section]
    if not raw_chunks:
        return []

    payloads: list[ChunkPayload] = []
    for i, chunk in enumerate(raw_chunks):
        context = None
        if rag.contextual_context_enabled and len(raw_chunks) > 1:
            context = await _generate_context(
                section.section_text or "",
                chunk,
                getattr(section, "grant_title", None),
                getattr(section, "section_type", None),
            )
        embed_input = f"{context}\n\n{chunk}" if context else chunk
        payloads.append(ChunkPayload(chunk_index=i, chunk_text=chunk, context=context, embed_input=embed_input))
    return payloads

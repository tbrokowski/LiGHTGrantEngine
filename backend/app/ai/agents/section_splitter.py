"""Section Splitter — LLM-based proposal sectioning for RAG ingest."""
import json
from app.ai.client import chat_complete
from app.models.section import SectionType

SYSTEM_PROMPT = """You are an expert at analyzing grant proposal documents.
Split the proposal into logical sections with accurate typing.
Respond with valid JSON only."""

SECTION_TYPES = [s.value for s in SectionType]
MAX_INPUT_CHARS = 400_000  # GPT-4o 128k context handles full proposal documents
CHUNK_SIZE = 400_000


def _prepare_text(parsed_text: str) -> tuple[str, bool]:
    """Return text for the LLM and whether it was truncated."""
    text = parsed_text.strip()
    if len(text) <= MAX_INPUT_CHARS:
        return text, False
    head = text[: MAX_INPUT_CHARS - 500]
    tail_words = text[MAX_INPUT_CHARS - 500 :].split()
    tail_summary = " ".join(tail_words[-200:]) if tail_words else ""
    truncated = head + f"\n\n[... document truncated; tail excerpt: {tail_summary} ...]"
    return truncated, True


def _is_weak_split(sections: list[dict]) -> bool:
    if not sections:
        return True
    if len(sections) == 1:
        title = (sections[0].get("title") or "").lower()
        if title in ("full document", "section 1"):
            return True
    return False


def _regex_fallback(parsed_text: str) -> list[dict]:
    """Fallback when LLM splitting fails."""
    from app.services.archive_ingestion import split_text_into_sections, _infer_section_type

    pairs = split_text_into_sections(parsed_text)
    sections = []
    for order, (title, body) in enumerate(pairs, start=1):
        sections.append({
            "title": title,
            "section_type": _infer_section_type(title),
            "text": body,
            "order": order,
            "heading_level": 1,
            "word_count": len(body.split()),
        })
    return sections


def _chunk_text(text: str, chunk_size: int = CHUNK_SIZE) -> list[str]:
    """Split long text on paragraph boundaries for chunked LLM processing."""
    if len(text) <= chunk_size:
        return [text]

    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        if end < len(text):
            split_at = text.rfind("\n\n", start, end)
            if split_at > start + chunk_size // 2:
                end = split_at + 2
            else:
                split_at = text.rfind("\n", start, end)
                if split_at > start + chunk_size // 2:
                    end = split_at + 1
        chunks.append(text[start:end].strip())
        start = end

    return [c for c in chunks if c]


def _normalize_sections(raw_sections: list, order_offset: int = 0) -> list[dict]:
    sections: list[dict] = []
    valid_types = set(SECTION_TYPES)
    for i, sec in enumerate(raw_sections):
        body = (sec.get("text") or "").strip()
        if not body:
            continue
        title = (sec.get("title") or f"Section {order_offset + i + 1}").strip()
        stype = sec.get("section_type") or "other"
        if stype not in valid_types:
            from app.services.archive_ingestion import _infer_section_type
            stype = _infer_section_type(title)
        sections.append({
            "title": title,
            "section_type": stype,
            "text": body,
            "order": sec.get("order") or (order_offset + len(sections) + 1),
            "heading_level": sec.get("heading_level") or 1,
            "word_count": sec.get("word_count") or len(body.split()),
        })
    return sections


async def _llm_split_text(text: str, funder: str = "") -> tuple[list[dict], list[str]]:
    """Run LLM section split on a single text chunk (must be <= MAX_INPUT_CHARS)."""
    warnings: list[str] = []
    user_prompt = f"""Split this grant proposal into logical sections.

FUNDER: {funder or 'Unknown'}

ALLOWED section_type values (use exactly one per section):
{json.dumps(SECTION_TYPES)}

Rules:
- Preserve section order as it appears in the document
- Each section must have substantive text (not just a heading)
- heading_level: 1 for major sections, 2 for subsections, 3 for sub-subsections
- If the document has no clear headings, infer logical breaks (intro, aims, methods, etc.)
- Do not merge unrelated sections into one blob unless the source truly has no breaks

Return JSON:
{{
  "sections": [
    {{
      "title": "Section title",
      "section_type": "methods",
      "text": "Full section body text",
      "order": 1,
      "heading_level": 1,
      "word_count": 450
    }}
  ]
}}

PROPOSAL TEXT:
{text}
"""

    response = await chat_complete(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        agent_name="section_splitter",
        json_mode=True,
    )
    data = json.loads(response)
    raw_sections = data.get("sections") or []
    return _normalize_sections(raw_sections), warnings


async def _split_long_document(parsed_text: str, funder: str) -> tuple[list[dict], list[str]]:
    """Index full proposals longer than MAX_INPUT_CHARS."""
    warnings: list[str] = []
    text = parsed_text.strip()

    regex_sections = _regex_fallback(text)
    if not _is_weak_split(regex_sections):
        warnings.append(
            "Very long document indexed using full-text heading detection (all sections preserved)."
        )
        return regex_sections, warnings

    warnings.append(
        "Very long document: using chunked LLM splitting to preserve all content."
    )
    chunks = _chunk_text(text)
    all_sections: list[dict] = []
    order = 1
    for chunk_idx, chunk in enumerate(chunks):
        try:
            chunk_sections, _ = await _llm_split_text(chunk, funder)
        except (json.JSONDecodeError, Exception):
            warnings.append(f"Chunk {chunk_idx + 1} LLM split failed; used regex on chunk.")
            pairs = _regex_fallback(chunk)
            chunk_sections = pairs

        for sec in chunk_sections:
            sec["order"] = order
            order += 1
            all_sections.append(sec)

    if not all_sections:
        warnings.append("Chunked splitting produced no sections; used full-document regex fallback.")
        return regex_sections if regex_sections else _regex_fallback(text), warnings

    if _is_weak_split(all_sections):
        warnings.append(
            "Chunked split yielded a single section; used full-document regex fallback."
        )
        return regex_sections if not _is_weak_split(regex_sections) else _regex_fallback(text), warnings

    return all_sections, warnings


async def split_proposal_into_sections(parsed_text: str, funder: str = "") -> tuple[list[dict], list[str]]:
    """
    Split proposal text into typed sections.
    Returns (sections, warnings) where each section has:
    title, section_type, text, order, heading_level, word_count
    """
    warnings: list[str] = []
    if not parsed_text or not parsed_text.strip():
        return [], ["Empty document text"]

    text_stripped = parsed_text.strip()
    if len(text_stripped) > MAX_INPUT_CHARS:
        return await _split_long_document(text_stripped, funder)

    text, truncated = _prepare_text(parsed_text)
    if truncated:
        warnings.append(
            "Document exceeded 400k characters; splitter saw truncated text. "
            "Review section boundaries manually if needed."
        )

    try:
        sections, llm_warnings = await _llm_split_text(text, funder)
        warnings.extend(llm_warnings)
    except (json.JSONDecodeError, Exception):
        warnings.append("LLM section splitting failed; used regex fallback.")
        return _regex_fallback(parsed_text), warnings

    if not sections:
        warnings.append("LLM returned no sections; used regex fallback.")
        return _regex_fallback(parsed_text), warnings

    if len(sections) == 1 and sections[0]["title"].lower() in ("full document", "section 1"):
        warnings.append(
            "Proposal was indexed as a single section. "
            "Check document formatting or re-index after improving the source file."
        )

    return sections, warnings

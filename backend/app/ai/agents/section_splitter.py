"""Section Splitter — LLM-based proposal sectioning for RAG ingest."""
import json
from app.ai.client import chat_complete
from app.models.section import SectionType

SYSTEM_PROMPT = """You are an expert at analyzing grant proposal documents.
Split the proposal into logical sections with accurate typing.
Respond with valid JSON only."""

SECTION_TYPES = [s.value for s in SectionType]
MAX_INPUT_CHARS = 30_000


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


async def split_proposal_into_sections(parsed_text: str, funder: str = "") -> tuple[list[dict], list[str]]:
    """
    Split proposal text into typed sections.
    Returns (sections, warnings) where each section has:
    title, section_type, text, order, heading_level, word_count
    """
    warnings: list[str] = []
    if not parsed_text or not parsed_text.strip():
        return [], ["Empty document text"]

    text, truncated = _prepare_text(parsed_text)
    if truncated:
        warnings.append(
            "Document exceeded 30k characters; splitter saw truncated text. "
            "Review section boundaries manually if needed."
        )

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

    try:
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
    except (json.JSONDecodeError, Exception):
        warnings.append("LLM section splitting failed; used regex fallback.")
        return _regex_fallback(parsed_text), warnings

    sections: list[dict] = []
    valid_types = set(SECTION_TYPES)
    for i, sec in enumerate(raw_sections):
        body = (sec.get("text") or "").strip()
        if not body:
            continue
        title = (sec.get("title") or f"Section {i + 1}").strip()
        stype = sec.get("section_type") or "other"
        if stype not in valid_types:
            from app.services.archive_ingestion import _infer_section_type
            stype = _infer_section_type(title)
        sections.append({
            "title": title,
            "section_type": stype,
            "text": body,
            "order": sec.get("order") or (i + 1),
            "heading_level": sec.get("heading_level") or 1,
            "word_count": sec.get("word_count") or len(body.split()),
        })

    if not sections:
        warnings.append("LLM returned no sections; used regex fallback.")
        return _regex_fallback(parsed_text), warnings

    if len(sections) == 1 and sections[0]["title"].lower() in ("full document", "section 1"):
        warnings.append(
            "Proposal was indexed as a single section. "
            "Check document formatting or re-index after improving the source file."
        )

    return sections, warnings

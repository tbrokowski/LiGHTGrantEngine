"""Section Splitter — LLM-based proposal sectioning for RAG ingest.

The model reads the proposal with every line numbered and returns only an
outline: each section's title, type, heading level and the line it starts on.
The section bodies are then cut from the original text here. Asking the model
to echo every section's full text back (as this used to) meant writing the
whole proposal out again as JSON — tens of thousands of output tokens, minutes
per document, and routinely cut off at the output limit, which broke the JSON
and dropped the run to the regex fallback. An outline is a few hundred tokens,
and the text it slices is the exact source text.
"""
import asyncio
import json
import re

from app.ai.client import chat_complete
from app.models.section import SectionType

SYSTEM_PROMPT = """You are an expert at analyzing grant proposal documents.
You outline a proposal into its logical sections, typed accurately.
Respond with valid JSON only."""

SECTION_TYPES = [s.value for s in SectionType]

# Characters of numbered text per LLM call. Longer documents are outlined in
# windows of this size, concurrently, with line numbers kept global.
WINDOW_CHARS = 120_000
# Lines longer than this are shown truncated to the model — enough to spot a
# heading, without spending context on long paragraphs it only needs to skip.
LINE_PREVIEW_CHARS = 300
# A heading line is usually short; anything longer is body text the section
# starts with, so it stays in the section body.
MAX_HEADING_CHARS = 160


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


def _numbered_windows(lines: list[str]) -> list[str]:
    """Render non-blank lines as `[n] text`, grouped into windows of ~WINDOW_CHARS."""
    windows: list[str] = []
    current: list[str] = []
    size = 0
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        if len(stripped) > LINE_PREVIEW_CHARS:
            stripped = stripped[:LINE_PREVIEW_CHARS] + " …"
        rendered = f"[{i}] {stripped}"
        if current and size + len(rendered) > WINDOW_CHARS:
            windows.append("\n".join(current))
            current, size = [], 0
        current.append(rendered)
        size += len(rendered) + 1
    if current:
        windows.append("\n".join(current))
    return windows


async def _outline_window(numbered: str, funder: str, part: str = "") -> list[dict]:
    """Ask the model for the section starts within one numbered window."""
    user_prompt = f"""Outline this grant proposal into logical sections{part}.

Every line is prefixed with its line number in [brackets]. For each section,
give the number of the line it starts on (normally its heading line). Do NOT
copy any section text — only the outline.

FUNDER: {funder or 'Unknown'}

ALLOWED section_type values (use exactly one per section):
{json.dumps(SECTION_TYPES)}

Rules:
- List sections in document order
- A section must contain substantive text, not just a heading
- heading_level: 1 for major sections, 2 for subsections, 3 for sub-subsections
- Include subsections only when they are substantial (a few paragraphs or more)
- If the text has no clear headings, infer logical breaks (intro, aims, methods, etc.)
- Front matter before the first real section (title page, table of contents) can be
  its own section of type "other"

Return JSON:
{{"sections": [{{"start_line": 12, "title": "Specific Aims", "section_type": "specific_aims", "heading_level": 1}}]}}

PROPOSAL (numbered lines):
{numbered}
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
    return data.get("sections") or []


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def _sections_from_outline(lines: list[str], outline: list[dict]) -> list[dict]:
    """Cut the source text into sections at the outline's start lines."""
    from app.services.archive_ingestion import _infer_section_type

    valid_types = set(SECTION_TYPES)
    starts: dict[int, dict] = {}
    for item in outline:
        try:
            line_no = int(item.get("start_line"))
        except (TypeError, ValueError):
            continue
        if 0 <= line_no < len(lines) and lines[line_no].strip() and line_no not in starts:
            starts[line_no] = item

    ordered = sorted(starts)
    sections: list[dict] = []
    for idx, line_no in enumerate(ordered):
        item = starts[line_no]
        # Text before the first section start belongs to the first section, so
        # nothing in the document is dropped.
        begin = 0 if idx == 0 else line_no
        end = ordered[idx + 1] if idx + 1 < len(ordered) else len(lines)
        chunk = lines[begin:end]

        title = (str(item.get("title") or "")).strip() or f"Section {idx + 1}"
        # Drop the heading line from the body when it is just the heading.
        heading_at = line_no - begin
        heading = chunk[heading_at].strip() if heading_at < len(chunk) else ""
        if heading and len(heading) <= MAX_HEADING_CHARS and (
            _norm(title) in _norm(heading) or _norm(heading) in _norm(title)
        ):
            chunk = chunk[:heading_at] + chunk[heading_at + 1:]

        body = "\n".join(chunk).strip()
        if not body:
            continue
        stype = item.get("section_type") or "other"
        if stype not in valid_types:
            stype = _infer_section_type(title)
        try:
            level = int(item.get("heading_level") or 1)
        except (TypeError, ValueError):
            level = 1
        sections.append({
            "title": title,
            "section_type": stype,
            "text": body,
            "order": len(sections) + 1,
            "heading_level": min(max(level, 1), 3),
            "word_count": len(body.split()),
        })
    return sections


# Lines longer than this are cut at sentence ends before numbering, so text
# that arrives with few line breaks (some PDFs) can still be split.
LONG_LINE_CHARS = 1500


def _source_lines(text: str) -> list[str]:
    lines: list[str] = []
    for line in text.splitlines():
        if len(line) <= LONG_LINE_CHARS:
            lines.append(line)
            continue
        piece = ""
        for sentence in re.split(r"(?<=[.!?])\s+", line):
            if piece and len(piece) + len(sentence) > 500:
                lines.append(piece)
                piece = sentence
            else:
                piece = f"{piece} {sentence}" if piece else sentence
        if piece:
            lines.append(piece)
    return lines


async def split_proposal_into_sections(parsed_text: str, funder: str = "") -> tuple[list[dict], list[str]]:
    """
    Split proposal text into typed sections.
    Returns (sections, warnings) where each section has:
    title, section_type, text, order, heading_level, word_count
    """
    warnings: list[str] = []
    if not parsed_text or not parsed_text.strip():
        return [], ["Empty document text"]

    lines = _source_lines(parsed_text.strip())
    windows = _numbered_windows(lines)

    try:
        if len(windows) == 1:
            outline = await _outline_window(windows[0], funder)
        else:
            parts = await asyncio.gather(*(
                _outline_window(w, funder, f" (part {i + 1} of {len(windows)} of a long document)")
                for i, w in enumerate(windows)
            ))
            outline = [item for part in parts for item in part]
    except Exception:
        warnings.append("LLM section splitting failed; used regex fallback.")
        return _regex_fallback(parsed_text), warnings

    sections = _sections_from_outline(lines, outline)
    if _is_weak_split(sections) and len(parsed_text) > 3000:
        regex_sections = _regex_fallback(parsed_text)
        if not _is_weak_split(regex_sections):
            warnings.append("LLM found no section breaks; used heading detection instead.")
            return regex_sections, warnings
    if not sections:
        warnings.append("LLM returned no sections; used regex fallback.")
        return _regex_fallback(parsed_text), warnings
    if len(sections) == 1:
        warnings.append(
            "Proposal was indexed as a single section. "
            "Check document formatting or re-index after improving the source file."
        )
    return sections, warnings

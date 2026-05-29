"""Google Docs API integration for grant document sync.

Uses the connected user's OAuth access token so documents are created and
edited in the user's own Google account.  Call
google_auth.get_valid_google_token() before invoking these functions to ensure
the token is not expired.

Push flow:  TipTap HTML  →  parse with html.parser  →  Docs API batchUpdate
Pull flow:  Docs API document body  →  walk structural elements  →  HTML string

Requires: google-api-python-client, google-auth
"""
from __future__ import annotations

import logging
from html.parser import HTMLParser
from typing import Any

logger = logging.getLogger(__name__)

_DOCS_SCOPES = [
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/drive",
]

# Mapping from HTML tag to Google Docs named paragraph style
_TAG_TO_STYLE: dict[str, str] = {
    "h1": "HEADING_1",
    "h2": "HEADING_2",
    "h3": "HEADING_3",
    "h4": "HEADING_4",
    "p": "NORMAL_TEXT",
    "blockquote": "NORMAL_TEXT",
    "li": "NORMAL_TEXT",
}

# Bullet presets for ordered vs unordered lists
_BULLET_PRESET_UNORDERED = "BULLET_DISC_CIRCLE_SQUARE"
_BULLET_PRESET_ORDERED = "NUMBERED_DECIMAL_ALPHA_ROMAN"


# ── Service builders ───────────────────────────────────────────────────────────

def _build_docs_service(access_token: str) -> Any:
    from google.oauth2.credentials import Credentials  # type: ignore[import]
    from googleapiclient.discovery import build  # type: ignore[import]

    creds = Credentials(token=access_token)
    return build("docs", "v1", credentials=creds, cache_discovery=False)


def _build_drive_service(access_token: str) -> Any:
    from google.oauth2.credentials import Credentials  # type: ignore[import]
    from googleapiclient.discovery import build  # type: ignore[import]

    creds = Credentials(token=access_token)
    return build("drive", "v3", credentials=creds, cache_discovery=False)


# ── HTML → Docs requests ───────────────────────────────────────────────────────

class _HtmlToParagraphs(HTMLParser):
    """Parse HTML into paragraphs, each containing a list of text runs.

    Each paragraph dict has:
        style: str           — Google Docs namedStyleType or "PAGE_BREAK"
        runs:  list[dict]    — ordered text runs with inline formatting
        list_type: str|None  — "BULLET" | "DECIMAL" | None
        list_depth: int      — 0-based nesting depth

    Each run dict has:
        text: str
        bold: bool
        italic: bool
        underline: bool
        strikethrough: bool
        link: str|None
    """

    def __init__(self) -> None:
        super().__init__()
        self.paragraphs: list[dict[str, Any]] = []

        # paragraph-level state
        self._current_style = "NORMAL_TEXT"
        self._in_block = False
        self._list_stack: list[str] = []  # stack of "ul"/"ol" as we descend

        # run-level state (flushed whenever any attribute changes)
        self._run_text = ""
        self._bold = False
        self._italic = False
        self._underline = False
        self._strikethrough = False
        self._link: str | None = None

        # runs accumulated for the current paragraph
        self._current_runs: list[dict[str, Any]] = []

    # ── helpers ────────────────────────────────────────────────────────────────

    def _current_run_attrs(self) -> dict[str, Any]:
        return {
            "bold": self._bold,
            "italic": self._italic,
            "underline": self._underline,
            "strikethrough": self._strikethrough,
            "link": self._link,
        }

    def _flush_run(self) -> None:
        """Append accumulated run text as a run dict if non-empty."""
        if self._run_text and self._in_block:
            self._current_runs.append(
                {
                    "text": self._run_text,
                    **self._current_run_attrs(),
                }
            )
        self._run_text = ""

    def _flush_paragraph(self, tag: str) -> None:
        """Close the current paragraph and append it to self.paragraphs."""
        self._flush_run()
        runs = self._current_runs
        if runs:
            list_type: str | None = None
            depth = 0
            if tag == "li" and self._list_stack:
                list_type = "DECIMAL" if self._list_stack[-1] == "ol" else "BULLET"
                depth = len(self._list_stack) - 1
            self.paragraphs.append(
                {
                    "style": self._current_style,
                    "runs": runs,
                    "list_type": list_type,
                    "list_depth": depth,
                }
            )
        self._current_runs = []
        self._current_style = "NORMAL_TEXT"
        self._in_block = False
        # reset run-level inline state
        self._bold = False
        self._italic = False
        self._underline = False
        self._strikethrough = False
        self._link = None
        self._run_text = ""

    # ── parser callbacks ───────────────────────────────────────────────────────

    def handle_starttag(self, tag: str, attrs: list) -> None:
        tag = tag.lower()
        attr_dict = dict(attrs)

        # TipTap page-break node
        if tag == "div" and attr_dict.get("data-type") == "page-break":
            self.paragraphs.append(
                {"style": "PAGE_BREAK", "runs": [], "list_type": None, "list_depth": 0}
            )
            return

        if tag in _TAG_TO_STYLE:
            self._current_style = _TAG_TO_STYLE[tag]
            self._in_block = True
            return

        if tag in ("ul", "ol"):
            self._list_stack.append(tag)
            return

        # Inline formatting — flush current run before toggling state
        if tag in ("strong", "b"):
            self._flush_run()
            self._bold = True
        elif tag in ("em", "i"):
            self._flush_run()
            self._italic = True
        elif tag == "u":
            self._flush_run()
            self._underline = True
        elif tag in ("s", "del", "strike"):
            self._flush_run()
            self._strikethrough = True
        elif tag == "a":
            self._flush_run()
            self._link = attr_dict.get("href") or None
        elif tag == "br":
            self._run_text += "\n"

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()

        if tag in _TAG_TO_STYLE:
            if self._in_block:
                self._flush_paragraph(tag)
            return

        if tag in ("ul", "ol"):
            if self._list_stack:
                self._list_stack.pop()
            return

        # Inline formatting — flush current run before toggling state off
        if tag in ("strong", "b"):
            self._flush_run()
            self._bold = False
        elif tag in ("em", "i"):
            self._flush_run()
            self._italic = False
        elif tag == "u":
            self._flush_run()
            self._underline = False
        elif tag in ("s", "del", "strike"):
            self._flush_run()
            self._strikethrough = False
        elif tag == "a":
            self._flush_run()
            self._link = None

    def handle_data(self, data: str) -> None:
        if self._in_block:
            self._run_text += data


def _html_to_paragraphs(html: str) -> list[dict[str, Any]]:
    parser = _HtmlToParagraphs()
    parser.feed(html or "")
    return parser.paragraphs


def _build_insert_requests(paragraphs: list[dict[str, Any]]) -> list[dict]:
    """Build Docs API batchUpdate requests to insert all paragraphs.

    Emits insertText + updateParagraphStyle for every paragraph, plus
    updateTextStyle per run (bold/italic/underline/strikethrough/link).
    List paragraphs collect createParagraphBullets requests appended last
    so all text is in place before bullet style is applied.
    """
    requests: list[dict] = []
    # Defer bullet requests until after all text is inserted so index ranges
    # are stable and the paragraphs already exist.
    bullet_requests: list[dict] = []
    index = 1  # Start at beginning of body

    for para in paragraphs:
        # Page-break sentinel
        if para["style"] == "PAGE_BREAK":
            requests.append(
                {
                    "insertText": {
                        "location": {"index": index},
                        "text": "\x0c",
                    }
                }
            )
            index += 1
            continue

        runs: list[dict[str, Any]] = para.get("runs", [])
        # Build full paragraph text so we can compute the end index
        para_text = "".join(r["text"] for r in runs) + "\n"

        para_start = index
        para_end = index + len(para_text)

        # Insert the full paragraph text in one request
        requests.append(
            {
                "insertText": {
                    "location": {"index": index},
                    "text": para_text,
                }
            }
        )

        # Paragraph-level style (heading / normal)
        requests.append(
            {
                "updateParagraphStyle": {
                    "range": {"startIndex": para_start, "endIndex": para_end},
                    "paragraphStyle": {"namedStyleType": para["style"]},
                    "fields": "namedStyleType",
                }
            }
        )

        # Per-run inline text styles
        run_index = index
        for run in runs:
            run_end = run_index + len(run["text"])
            has_any_style = (
                run["bold"]
                or run["italic"]
                or run["underline"]
                or run["strikethrough"]
                or run.get("link")
            )
            if has_any_style:
                text_style: dict[str, Any] = {
                    "bold": run["bold"],
                    "italic": run["italic"],
                    "underline": run["underline"],
                    "strikethrough": run["strikethrough"],
                }
                fields = "bold,italic,underline,strikethrough"
                if run.get("link"):
                    text_style["link"] = {"url": run["link"]}
                    fields += ",link"
                requests.append(
                    {
                        "updateTextStyle": {
                            "range": {"startIndex": run_index, "endIndex": run_end},
                            "textStyle": text_style,
                            "fields": fields,
                        }
                    }
                )
            run_index = run_end

        # Bullet / numbered list
        if para.get("list_type"):
            preset = (
                _BULLET_PRESET_ORDERED
                if para["list_type"] == "DECIMAL"
                else _BULLET_PRESET_UNORDERED
            )
            bullet_requests.append(
                {
                    "createParagraphBullets": {
                        "range": {"startIndex": para_start, "endIndex": para_end - 1},
                        "bulletPreset": preset,
                    }
                }
            )

        index = para_end

    # Append bullet requests after all text insertions
    requests.extend(bullet_requests)
    return requests


# ── Docs API calls ─────────────────────────────────────────────────────────────

def create_grant_doc(
    title: str,
    content_html: str,
    access_token: str,
    parent_folder_id: str | None = None,
) -> dict[str, str]:
    """Create a new Google Doc with grant content and return doc_id + doc_url.

    If parent_folder_id is provided, move the doc into that Drive folder.

    Args:
        title: Document title.
        content_html: Initial HTML content.
        access_token: Valid Google OAuth access token for the user.
        parent_folder_id: Optional Drive folder ID to place the doc in.
    """
    docs_svc = _build_docs_service(access_token)

    doc = docs_svc.documents().create(body={"title": title[:255]}).execute()
    doc_id: str = doc["documentId"]
    doc_url = f"https://docs.google.com/document/d/{doc_id}/edit"

    if parent_folder_id:
        drive_svc = _build_drive_service(access_token)
        file_meta = drive_svc.files().get(fileId=doc_id, fields="parents").execute()
        old_parents = ",".join(file_meta.get("parents", []))
        drive_svc.files().update(
            fileId=doc_id,
            addParents=parent_folder_id,
            removeParents=old_parents,
            fields="id, parents",
        ).execute()

    if content_html:
        _write_content_to_doc(docs_svc, doc_id, content_html)

    logger.info("Created Google Doc '%s': %s", title, doc_url)
    return {"doc_id": doc_id, "doc_url": doc_url}


def push_to_doc(
    doc_id: str,
    content_html: str,
    access_token: str,
) -> None:
    """Overwrite Google Doc body with content_html.

    Args:
        doc_id: Google Docs document ID.
        content_html: HTML content to write.
        access_token: Valid Google OAuth access token for the user.
    """
    docs_svc = _build_docs_service(access_token)

    doc = docs_svc.documents().get(documentId=doc_id).execute()
    body = doc.get("body", {})
    content = body.get("content", [])
    end_index = 1
    if content:
        last_elem = content[-1]
        end_index = last_elem.get("endIndex", 1)

    requests: list[dict] = []

    if end_index > 2:
        requests.append(
            {
                "deleteContentRange": {
                    "range": {"startIndex": 1, "endIndex": end_index - 1}
                }
            }
        )

    paragraphs = _html_to_paragraphs(content_html)
    requests.extend(_build_insert_requests(paragraphs))

    if requests:
        docs_svc.documents().batchUpdate(
            documentId=doc_id, body={"requests": requests}
        ).execute()

    logger.info("Pushed content to Google Doc %s", doc_id)


def _paragraph_elements_to_html(paragraph: dict, inline_objects: dict) -> str:
    """Convert a Google Docs paragraph's elements list to an HTML string."""
    inline_html = ""
    for pe in paragraph.get("elements", []):
        # Inline images
        if "inlineObjectElement" in pe:
            obj_id = pe["inlineObjectElement"].get("inlineObjectId")
            obj = inline_objects.get(obj_id or "", {})
            props = (
                obj.get("inlineObjectProperties", {})
                   .get("embeddedObject", {})
            )
            content_uri = props.get("imageProperties", {}).get("contentUri", "")
            if content_uri:
                inline_html += f'<img src="{content_uri}" style="max-width:100%;" />'
            continue

        text_run = pe.get("textRun")
        if not text_run:
            continue
        text = text_run.get("content", "")
        ts = text_run.get("textStyle", {})

        # Wrap inline styles from innermost to outermost so nesting is clean
        if ts.get("strikethrough"):
            text = f"<s>{text}</s>"
        if ts.get("underline") and not ts.get("link"):
            # Google Docs marks linked text as underlined; skip redundant <u>
            text = f"<u>{text}</u>"
        if ts.get("italic"):
            text = f"<em>{text}</em>"
        if ts.get("bold"):
            text = f"<strong>{text}</strong>"
        link_url = ts.get("link", {}).get("url", "") if isinstance(ts.get("link"), dict) else ""
        if link_url:
            text = f'<a href="{link_url}">{text}</a>'

        inline_html += text
    return inline_html.rstrip("\n")


def _table_to_html(table: dict, inline_objects: dict) -> str:
    """Convert a Google Docs table element to an HTML table string."""
    rows_html = ""
    for row in table.get("tableRows", []):
        cells_html = ""
        is_header = row.get("tableRowStyle", {}).get("minRowHeight") is None and rows_html == ""
        for cell in row.get("tableCells", []):
            cell_content = ""
            for el in cell.get("content", []):
                para = el.get("paragraph")
                if para:
                    cell_content += _paragraph_elements_to_html(para, inline_objects)
            tag = "th" if is_header else "td"
            cells_html += f"<{tag} style='border:1px solid #d1d5db;padding:4px 8px;'>{cell_content}</{tag}>"
        rows_html += f"<tr>{cells_html}</tr>"
    return f"<table style='border-collapse:collapse;width:100%;'>{rows_html}</table>"


def _get_list_glyph_type(doc_lists: dict, bullet: dict) -> str:
    """Return 'ORDERED' or 'UNORDERED' based on the list's glyph type."""
    list_id = bullet.get("listId", "")
    nesting = bullet.get("nestingLevel", 0)
    list_props = (
        doc_lists.get(list_id, {})
        .get("listProperties", {})
        .get("nestingLevels", [{}])
    )
    level = list_props[nesting] if nesting < len(list_props) else {}
    glyph_type = level.get("glyphType", "")
    # Ordered lists use DECIMAL, ALPHA, ROMAN, etc.; unordered use GLYPH_TYPE_UNSPECIFIED or no glyphType
    if glyph_type and glyph_type not in ("GLYPH_TYPE_UNSPECIFIED",):
        return "ORDERED"
    # Ordered presets also use glyphSymbol sometimes; fall back to bulletAlignment check
    glyph_symbol = level.get("glyphSymbol", "")
    if glyph_symbol in ("", "\u25cf", "\u25cb", "\u25aa"):
        return "UNORDERED"
    return "ORDERED"


def pull_from_doc(
    doc_id: str,
    access_token: str,
) -> str:
    """Read Google Doc and return HTML representation.

    Args:
        doc_id: Google Docs document ID.
        access_token: Valid Google OAuth access token for the user.
    """
    docs_svc = _build_docs_service(access_token)
    doc = docs_svc.documents().get(documentId=doc_id).execute()
    body = doc.get("body", {})
    content = body.get("content", [])
    inline_objects = doc.get("inlineObjects", {})
    doc_lists = doc.get("lists", {})

    html_parts: list[str] = []

    # Track open list context: (list_id, nesting_level, "ol"|"ul")
    # We open/close list tags as list membership changes.
    _open_list_id: str | None = None
    _open_list_type: str | None = None  # "ol" or "ul"
    _open_nesting: int = 0

    def _close_open_list() -> None:
        nonlocal _open_list_id, _open_list_type, _open_nesting
        if _open_list_id is not None:
            html_parts.append(f"</{_open_list_type}>")
            _open_list_id = None
            _open_list_type = None
            _open_nesting = 0

    for element in content:
        # Tables — close any open list first
        if "table" in element:
            _close_open_list()
            html_parts.append(_table_to_html(element["table"], inline_objects))
            continue

        paragraph = element.get("paragraph")
        if not paragraph:
            continue

        bullet = paragraph.get("bullet")
        inline_html = _paragraph_elements_to_html(paragraph, inline_objects)

        if bullet:
            list_id = bullet.get("listId", "")
            nesting = bullet.get("nestingLevel", 0)
            glyph_kind = _get_list_glyph_type(doc_lists, bullet)
            list_tag = "ol" if glyph_kind == "ORDERED" else "ul"

            # Open or switch list context when list_id or type changes
            if _open_list_id != list_id or _open_list_type != list_tag:
                _close_open_list()
                html_parts.append(f"<{list_tag}>")
                _open_list_id = list_id
                _open_list_type = list_tag
                _open_nesting = nesting

            html_parts.append(f"<li>{inline_html}</li>")
        else:
            # Non-list paragraph — close any open list
            _close_open_list()

            style = paragraph.get("paragraphStyle", {}).get("namedStyleType", "NORMAL_TEXT")
            tag = _style_to_tag(style)
            if inline_html:
                html_parts.append(f"<{tag}>{inline_html}</{tag}>")

    # Close any list still open at end of document
    _close_open_list()

    return "\n".join(html_parts)


def read_document_as_text(
    doc_id: str,
    access_token: str,
) -> str:
    """Read a Google Doc and return its content as plain text.

    Used by the AI context manager to include linked Google Doc content
    in the grant writing assistant's system prompt.

    Args:
        doc_id: Google Docs document ID.
        access_token: Valid Google OAuth access token for the user.
    """
    docs_svc = _build_docs_service(access_token)
    doc = docs_svc.documents().get(documentId=doc_id).execute()
    body = doc.get("body", {})
    content = body.get("content", [])

    text_parts: list[str] = []
    for element in content:
        paragraph = element.get("paragraph")
        if not paragraph:
            continue
        inline_text = ""
        for pe in paragraph.get("elements", []):
            text_run = pe.get("textRun")
            if text_run:
                inline_text += text_run.get("content", "")
        stripped = inline_text.rstrip("\n")
        if stripped:
            text_parts.append(stripped)

    return "\n".join(text_parts)


def _write_content_to_doc(docs_svc: Any, doc_id: str, content_html: str) -> None:
    paragraphs = _html_to_paragraphs(content_html)
    requests = _build_insert_requests(paragraphs)
    if requests:
        docs_svc.documents().batchUpdate(
            documentId=doc_id, body={"requests": requests}
        ).execute()


def insert_image_after_heading(
    doc_id: str,
    image_url: str,
    access_token: str,
    heading_text: str = "Introduction",
    width_pt: float = 432.0,
) -> None:
    """
    Insert an inline image into a Google Doc after the first paragraph whose
    text contains `heading_text` (case-insensitive). Inserts at position 1 (very
    top of document) if the heading is not found, so the figure always appears.

    Args:
        doc_id      : Google Docs document ID.
        image_url   : A publicly accessible image URL (e.g. presigned R2 URL or OpenAI temp URL).
                      The Docs API requires a publicly reachable URL to fetch the image.
        access_token: Valid Google OAuth token.
        heading_text: Section heading to insert after (e.g. "Introduction").
        width_pt    : Width of the inserted image in points (1 inch = 72 pt). 432 pt = 6 inches.
    """
    docs_svc = _build_docs_service(access_token)

    doc = docs_svc.documents().get(documentId=doc_id).execute()
    body_content = doc.get("body", {}).get("content", [])

    # Find the index just after the target heading paragraph
    insert_index = 1  # fallback: insert at very top
    heading_lower = heading_text.lower()
    for elem in body_content:
        para = elem.get("paragraph")
        if not para:
            continue
        text = "".join(
            (e.get("textRun") or {}).get("content", "")
            for e in para.get("elements", [])
        ).strip().lower()
        if heading_lower in text:
            insert_index = elem.get("endIndex", insert_index)
            break

    requests = [
        {
            "insertInlineImage": {
                "location": {"index": insert_index - 1},
                "uri": image_url,
                "objectSize": {
                    "width": {"magnitude": width_pt, "unit": "PT"},
                    "height": {"magnitude": width_pt * 0.75, "unit": "PT"},
                },
            }
        }
    ]

    docs_svc.documents().batchUpdate(
        documentId=doc_id, body={"requests": requests}
    ).execute()

    logger.info("Inserted overview figure into Google Doc %s after '%s'", doc_id, heading_text)


def _style_to_tag(style: str) -> str:
    mapping = {
        "HEADING_1": "h1",
        "HEADING_2": "h2",
        "HEADING_3": "h3",
        "HEADING_4": "h4",
        "NORMAL_TEXT": "p",
    }
    return mapping.get(style, "p")

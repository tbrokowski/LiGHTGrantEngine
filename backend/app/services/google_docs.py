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
    """Parse HTML into a list of (style, text, bold, italic) paragraph tuples."""

    def __init__(self) -> None:
        super().__init__()
        self.paragraphs: list[dict[str, Any]] = []
        self._current_style = "NORMAL_TEXT"
        self._current_text = ""
        self._bold = False
        self._italic = False
        self._in_block = False
        self._list_depth = 0

    def handle_starttag(self, tag: str, attrs: list) -> None:
        tag = tag.lower()
        attr_dict = dict(attrs)
        # TipTap page-break node → emit a sentinel that becomes \x0C on push
        if tag == "div" and attr_dict.get("data-type") == "page-break":
            self.paragraphs.append(
                {"style": "PAGE_BREAK", "text": "\x0c", "bold": False, "italic": False}
            )
            return
        if tag in _TAG_TO_STYLE:
            self._current_style = _TAG_TO_STYLE[tag]
            self._current_text = ""
            self._in_block = True
        elif tag in ("ul", "ol"):
            self._list_depth += 1
        elif tag == "strong" or tag == "b":
            self._bold = True
        elif tag == "em" or tag == "i":
            self._italic = True
        elif tag == "br":
            self._current_text += "\n"

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in _TAG_TO_STYLE and self._in_block:
            text = self._current_text.strip()
            if text:
                self.paragraphs.append(
                    {
                        "style": self._current_style,
                        "text": text,
                        "bold": self._bold and tag not in _TAG_TO_STYLE,
                        "italic": self._italic and tag not in _TAG_TO_STYLE,
                    }
                )
            self._current_text = ""
            self._current_style = "NORMAL_TEXT"
            self._in_block = False
            self._bold = False
            self._italic = False
        elif tag in ("ul", "ol"):
            self._list_depth = max(0, self._list_depth - 1)
        elif tag in ("strong", "b"):
            self._bold = False
        elif tag in ("em", "i"):
            self._italic = False

    def handle_data(self, data: str) -> None:
        if self._in_block:
            self._current_text += data


def _html_to_paragraphs(html: str) -> list[dict[str, Any]]:
    parser = _HtmlToParagraphs()
    parser.feed(html or "")
    return parser.paragraphs


def _build_insert_requests(paragraphs: list[dict[str, Any]]) -> list[dict]:
    """Build Docs API batchUpdate requests to insert all paragraphs."""
    requests: list[dict] = []
    index = 1  # Start at beginning of body

    for para in paragraphs:
        # Page-break sentinel: insert form-feed character (\x0C).
        # Google Docs interprets \x0C as a page break.
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

        text = para["text"] + "\n"
        requests.append(
            {
                "insertText": {
                    "location": {"index": index},
                    "text": text,
                }
            }
        )
        end_index = index + len(text)
        requests.append(
            {
                "updateParagraphStyle": {
                    "range": {"startIndex": index, "endIndex": end_index},
                    "paragraphStyle": {"namedStyleType": para["style"]},
                    "fields": "namedStyleType",
                }
            }
        )
        index = end_index

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
        if ts.get("bold"):
            text = f"<strong>{text}</strong>"
        if ts.get("italic"):
            text = f"<em>{text}</em>"
        if ts.get("underline"):
            text = f"<u>{text}</u>"
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

    html_parts: list[str] = []

    for element in content:
        # Tables
        if "table" in element:
            html_parts.append(_table_to_html(element["table"], inline_objects))
            continue

        paragraph = element.get("paragraph")
        if not paragraph:
            continue

        style = paragraph.get("paragraphStyle", {}).get("namedStyleType", "NORMAL_TEXT")
        tag = _style_to_tag(style)

        inline_html = _paragraph_elements_to_html(paragraph, inline_objects)
        if inline_html:
            html_parts.append(f"<{tag}>{inline_html}</{tag}>")

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


def _style_to_tag(style: str) -> str:
    mapping = {
        "HEADING_1": "h1",
        "HEADING_2": "h2",
        "HEADING_3": "h3",
        "HEADING_4": "h4",
        "NORMAL_TEXT": "p",
    }
    return mapping.get(style, "p")

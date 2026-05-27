"""Google Docs API integration for grant document sync.

Uses the same service-account credentials as google_drive.py.
Requires: google-api-python-client, google-auth

Push flow:  TipTap HTML  →  parse with html.parser  →  Docs API batchUpdate
Pull flow:  Docs API document body  →  walk structural elements  →  HTML string
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


# ── Service builder ────────────────────────────────────────────────────────────

def _build_docs_service(service_account_file: str) -> Any:
    from google.oauth2 import service_account  # type: ignore[import]
    from googleapiclient.discovery import build  # type: ignore[import]

    creds = service_account.Credentials.from_service_account_file(
        service_account_file, scopes=_DOCS_SCOPES
    )
    return build("docs", "v1", credentials=creds, cache_discovery=False)


def _build_drive_service(service_account_file: str) -> Any:
    from google.oauth2 import service_account  # type: ignore[import]
    from googleapiclient.discovery import build  # type: ignore[import]

    creds = service_account.Credentials.from_service_account_file(
        service_account_file, scopes=_DOCS_SCOPES
    )
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
    # Insert from end so indexes don't shift; we'll build in reverse
    # Instead, we insert at index 1 (after the implicit first para) and build forward
    # using insertText then updateParagraphStyle per paragraph.
    index = 1  # Start at beginning of body

    for para in paragraphs:
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
    service_account_file: str,
    parent_folder_id: str | None = None,
) -> dict[str, str]:
    """Create a new Google Doc with grant content and return doc_id + doc_url.

    If parent_folder_id is provided, move the doc into that Drive folder.
    """
    docs_svc = _build_docs_service(service_account_file)

    doc = docs_svc.documents().create(body={"title": title[:255]}).execute()
    doc_id: str = doc["documentId"]
    doc_url = f"https://docs.google.com/document/d/{doc_id}/edit"

    if parent_folder_id:
        drive_svc = _build_drive_service(service_account_file)
        # Move into the grant's Drive folder
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
    service_account_file: str,
) -> None:
    """Overwrite Google Doc body with content_html."""
    docs_svc = _build_docs_service(service_account_file)

    # Fetch current doc to get body end index
    doc = docs_svc.documents().get(documentId=doc_id).execute()
    body = doc.get("body", {})
    content = body.get("content", [])
    end_index = 1
    if content:
        last_elem = content[-1]
        end_index = last_elem.get("endIndex", 1)

    requests: list[dict] = []

    # Delete existing body content (keep at least 1 char)
    if end_index > 2:
        requests.append(
            {
                "deleteContentRange": {
                    "range": {"startIndex": 1, "endIndex": end_index - 1}
                }
            }
        )

    # Insert new content
    paragraphs = _html_to_paragraphs(content_html)
    requests.extend(_build_insert_requests(paragraphs))

    if requests:
        docs_svc.documents().batchUpdate(
            documentId=doc_id, body={"requests": requests}
        ).execute()

    logger.info("Pushed content to Google Doc %s", doc_id)


def pull_from_doc(
    doc_id: str,
    service_account_file: str,
) -> str:
    """Read Google Doc and return HTML representation."""
    docs_svc = _build_docs_service(service_account_file)
    doc = docs_svc.documents().get(documentId=doc_id).execute()
    body = doc.get("body", {})
    content = body.get("content", [])

    html_parts: list[str] = []

    for element in content:
        paragraph = element.get("paragraph")
        if not paragraph:
            continue

        style = paragraph.get("paragraphStyle", {}).get("namedStyleType", "NORMAL_TEXT")
        tag = _style_to_tag(style)

        inline_text = ""
        for pe in paragraph.get("elements", []):
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
            inline_text += text

        inline_text = inline_text.rstrip("\n")
        if inline_text:
            html_parts.append(f"<{tag}>{inline_text}</{tag}>")

    return "\n".join(html_parts)


def read_document_as_text(
    doc_id: str,
    service_account_file: str,
) -> str:
    """Read a Google Doc and return its content as plain text.

    Used by the AI context manager to include linked Google Doc content
    in the grant writing assistant's system prompt.
    """
    docs_svc = _build_docs_service(service_account_file)
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

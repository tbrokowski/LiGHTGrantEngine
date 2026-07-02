"""Google Docs API integration for grant document sync.

Uses the connected user's OAuth access token so documents are created and
edited in the user's own Google account.  Call
google_auth.get_valid_google_token() before invoking these functions to ensure
the token is not expired.

Push flow:  TipTap HTML  →  Drive API files.update (text/html media)  →  Google converts natively
Pull flow:  Drive API files.export (text/html)  →  extract body  →  TipTap HTML

Using the Drive API for push/pull preserves all formatting (tables, images,
headings, lists, bold/italic) because Google handles the HTML↔Docs conversion
internally — no manual parsing or batchUpdate required.

Requires: google-api-python-client, google-auth
"""
from __future__ import annotations

import io
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

_DOCS_SCOPES = [
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/drive",
]


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
        # Use the Drive API HTML-upload path (same as push_to_doc) rather than
        # manual batchUpdate paragraph insertion — the manual path flattens
        # <table> elements to plain text with no insertTable request, so tables
        # never survive doc creation. Drive's native HTML→Docs conversion
        # preserves tables, images, and all inline formatting.
        push_to_doc(doc_id, content_html, access_token)

    logger.info("Created Google Doc '%s': %s", title, doc_url)
    return {"doc_id": doc_id, "doc_url": doc_url}


def push_to_doc(
    doc_id: str,
    content_html: str,
    access_token: str,
) -> None:
    """Overwrite Google Doc body with content_html via Drive API.

    Uploads HTML as a media body so Google converts it natively, preserving
    tables, images, headings, lists, and all inline formatting.

    Args:
        doc_id: Google Docs document ID.
        content_html: HTML content to write.
        access_token: Valid Google OAuth access token for the user.
    """
    from googleapiclient.http import MediaIoBaseUpload  # type: ignore[import]

    drive_svc = _build_drive_service(access_token)

    # Wrap in a minimal HTML document so the Drive importer gets proper charset
    full_html = (
        '<!DOCTYPE html><html><head><meta charset="utf-8"></head>'
        f'<body>{content_html}</body></html>'
    )
    html_bytes = full_html.encode("utf-8")
    media = MediaIoBaseUpload(
        io.BytesIO(html_bytes),
        mimetype="text/html",
        resumable=False,
    )
    drive_svc.files().update(fileId=doc_id, media_body=media).execute()

    logger.info("Pushed content to Google Doc %s via Drive API", doc_id)


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


def _extract_body_for_tiptap(full_html: str) -> str:
    """Extract and lightly clean body content from Google Docs exported HTML.

    Google's export HTML wraps content in <html><head>...</head><body>...</body>.
    We pull out the body, strip Google-internal IDs and empty spans, and return
    clean HTML ready for TipTap's setContent().
    """
    body_match = re.search(r"<body[^>]*>(.*?)</body>", full_html, re.I | re.S)
    body = body_match.group(1) if body_match else full_html

    # Strip Google's internal tracking IDs
    body = re.sub(r'\s+id="docs-internal-[^"]*"', "", body)

    # Remove empty spans (Google wraps single characters in spans for styling)
    body = re.sub(r"<span[^>]*>\s*</span>", "", body)

    return body.strip()


def pull_from_doc(
    doc_id: str,
    access_token: str,
) -> str:
    """Read Google Doc and return HTML for TipTap via Drive API export.

    Uses files.export(mimeType='text/html') which returns perfect-fidelity HTML
    including tables, inline images (as lh3.googleusercontent.com URLs that
    render in a browser without auth), headings, lists, and all formatting.

    Args:
        doc_id: Google Docs document ID.
        access_token: Valid Google OAuth access token for the user.
    """
    drive_svc = _build_drive_service(access_token)
    content = drive_svc.files().export(fileId=doc_id, mimeType="text/html").execute()
    html = content.decode("utf-8") if isinstance(content, bytes) else content
    return _extract_body_for_tiptap(html)


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

"""Import a file into the grant editor as TipTap-compatible HTML.

Supports .docx (headings, bold/italic/underline, bullet and numbered lists,
tables), .html, and plain text / Markdown (headings and paragraphs only).
"""
from __future__ import annotations

import html as _html
import io
import re

from bs4 import BeautifulSoup

IMPORTABLE_EXTENSIONS = {"docx", "html", "htm", "txt", "md"}


def _run_html(run) -> str:
    text = _html.escape(run.text or "")
    if not text:
        return ""
    if run.bold:
        text = f"<strong>{text}</strong>"
    if run.italic:
        text = f"<em>{text}</em>"
    if run.underline:
        text = f"<u>{text}</u>"
    return text


def _list_kind(paragraph) -> str | None:
    """'ul' / 'ol' for list paragraphs (by numbering properties or style name)."""
    style = (paragraph.style.name or "").lower() if paragraph.style is not None else ""
    if "list number" in style:
        return "ol"
    if "list" in style or "bullet" in style:
        return "ul"
    ppr = paragraph._p.pPr
    if ppr is not None and ppr.numPr is not None:
        return "ul"
    return None


def docx_to_html(data: bytes) -> str:
    from docx import Document as DocxDocument
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    doc = DocxDocument(io.BytesIO(data))
    out: list[str] = []
    open_list: str | None = None

    def close_list():
        nonlocal open_list
        if open_list:
            out.append(f"</{open_list}>")
            open_list = None

    for block in doc.element.body.iterchildren():
        tag = block.tag.rsplit("}", 1)[-1]
        if tag == "tbl":
            close_list()
            table = Table(block, doc)
            rows = []
            for row in table.rows:
                cells = "".join(f"<td><p>{_html.escape(c.text)}</p></td>" for c in row.cells)
                rows.append(f"<tr>{cells}</tr>")
            out.append(f"<table><tbody>{''.join(rows)}</tbody></table>")
            continue
        if tag != "p":
            continue
        para = Paragraph(block, doc)
        inner = "".join(_run_html(r) for r in para.runs)
        style = (para.style.name or "") if para.style is not None else ""
        heading = re.match(r"Heading (\d)", style)
        kind = _list_kind(para)
        if kind:
            if open_list != kind:
                close_list()
                out.append(f"<{kind}>")
                open_list = kind
            out.append(f"<li><p>{inner}</p></li>")
            continue
        close_list()
        if style == "Title":
            out.append(f"<h1>{inner}</h1>")
        elif heading:
            out.append(f"<h{min(int(heading.group(1)), 4)}>{inner}</h{min(int(heading.group(1)), 4)}>")
        else:
            out.append(f"<p>{inner}</p>")
    close_list()
    return "".join(out)


def text_to_html(text: str) -> str:
    out: list[str] = []
    for block in re.split(r"\n\s*\n", text.replace("\r\n", "\n")):
        block = block.strip()
        if not block:
            continue
        m = re.match(r"^(#{1,4})\s+(.*)$", block)
        if m and "\n" not in block:
            level = len(m.group(1))
            out.append(f"<h{level}>{_html.escape(m.group(2))}</h{level}>")
        else:
            out.append("<p>" + "<br>".join(_html.escape(line) for line in block.split("\n")) + "</p>")
    return "".join(out)


def html_body(raw: str) -> str:
    soup = BeautifulSoup(raw, "html.parser")
    for t in soup(["script", "style", "head", "title", "meta", "link"]):
        t.decompose()
    body = soup.body or soup
    return "".join(str(c) for c in body.contents)


def file_to_html(filename: str, data: bytes) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext == "docx":
        return docx_to_html(data)
    text = data.decode("utf-8", errors="replace")
    if ext in ("html", "htm"):
        return html_body(text)
    return text_to_html(text)

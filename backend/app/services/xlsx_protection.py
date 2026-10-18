"""Remove sheet and workbook protection from an Excel workbook (.xlsx / .xlsm).

Funder templates (e.g. the Horizon Europe lump-sum budget table) password-
protect every sheet and lock the workbook structure, which leaves most cells
read-only in the browser editor. Protection in OOXML is not encryption: it is a
`<sheetProtection>` element in each sheet and `<workbookProtection>` in
workbook.xml. Removing those elements unlocks the file; the content of every
other part of the package — styles, formulas, the VBA project — is unchanged.
"""
from __future__ import annotations

import io
import re
import zipfile

_SHEET_PROTECTION = re.compile(
    rb"<(?:\w+:)?sheetProtection\b[^>]*?(?:/>|>.*?</(?:\w+:)?sheetProtection>)", re.S
)
_WORKBOOK_PROTECTION = re.compile(
    rb"<(?:\w+:)?(?:workbookProtection|fileSharing)\b[^>]*?(?:/>|>.*?</(?:\w+:)?(?:workbookProtection|fileSharing)>)",
    re.S,
)


def _is_sheet_part(name: str) -> bool:
    return (
        (name.startswith("xl/worksheets/") or name.startswith("xl/chartsheets/"))
        and name.endswith(".xml")
        and "/_rels/" not in name
    )


def strip_protection(data: bytes) -> tuple[bytes, int]:
    """Return (workbook bytes, number of protections removed). When nothing is
    protected the original bytes come back unchanged."""
    src = zipfile.ZipFile(io.BytesIO(data))
    changed: dict[str, bytes] = {}
    removed = 0
    for info in src.infolist():
        if _is_sheet_part(info.filename):
            pattern = _SHEET_PROTECTION
        elif info.filename == "xl/workbook.xml":
            pattern = _WORKBOOK_PROTECTION
        else:
            continue
        xml = src.read(info)
        new, n = pattern.subn(b"", xml)
        if n:
            changed[info.filename] = new
            removed += n
    if not removed:
        return data, 0

    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as dst:
        for info in src.infolist():
            if info.filename in changed:
                dst.writestr(info, changed[info.filename], compress_type=info.compress_type)
            else:
                # Same content; zipfile may compress it slightly differently.
                with src.open(info) as fh:
                    dst.writestr(info, fh.read(), compress_type=info.compress_type)
    return out.getvalue(), removed

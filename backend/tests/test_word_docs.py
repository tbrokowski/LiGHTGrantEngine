"""Unit tests for Word documents: which copy is ahead, file checks, storage keys."""
import io
import json
import zipfile
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.models.document import Document
from app.routers.grant_word_docs import _set_storage_key, _sync_state, is_docx, validate_docx

SYNCED = datetime(2026, 11, 1, 12, 0, tzinfo=timezone.utc)


def _doc(**kw) -> Document:
    base = dict(id="d1", grant_id="g1", file_name="Narrative.docx", file_format="docx",
                edit_version=3, google_synced_at=SYNCED, google_synced_version=3)
    return Document(**{**base, **kw})


def _zip(*names: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name in names:
            zf.writestr(name, "<x/>")
    return buf.getvalue()


def test_nothing_changed_is_synced():
    assert _sync_state(_doc(), SYNCED) == "synced"


def test_google_timestamp_within_slack_is_not_an_edit():
    assert _sync_state(_doc(), SYNCED + timedelta(seconds=3)) == "synced"


def test_app_saved_since_sync():
    assert _sync_state(_doc(edit_version=4), SYNCED) == "app_newer"


def test_google_edited_since_sync():
    assert _sync_state(_doc(), SYNCED + timedelta(minutes=5)) == "google_newer"


def test_both_changed_is_a_conflict():
    assert _sync_state(_doc(edit_version=4), SYNCED + timedelta(minutes=5)) == "conflict"


def test_naive_synced_at_is_treated_as_utc():
    assert _sync_state(_doc(google_synced_at=SYNCED.replace(tzinfo=None)), SYNCED) == "synced"


def test_is_docx_by_format_or_name():
    assert is_docx(_doc())
    assert is_docx(_doc(file_format=None, file_name="Letter.DOCX"))
    assert not is_docx(_doc(file_format="pdf", file_name="Call.pdf"))
    assert not is_docx(_doc(file_format=None, file_name="Old.doc"))


def test_validate_docx_accepts_word_package():
    validate_docx(_zip("[Content_Types].xml", "word/document.xml"))


@pytest.mark.parametrize("data", [b"not a zip", _zip("xl/workbook.xml")])
def test_validate_docx_rejects_other_files(data):
    with pytest.raises(HTTPException) as exc:
        validate_docx(data)
    assert exc.value.status_code == 400


def test_set_storage_key_plain_and_json_notes():
    plain = _doc(notes="grants/g1/d1/Narrative.docx")
    _set_storage_key(plain, "grants/g1/documents/d1/v4/Narrative.docx")
    assert plain.notes == "grants/g1/documents/d1/v4/Narrative.docx"

    meta = _doc(notes=json.dumps({"r2_key": "old", "source_url": "https://example.org/x"}))
    _set_storage_key(meta, "new")
    assert json.loads(meta.notes) == {"r2_key": "new", "source_url": "https://example.org/x"}

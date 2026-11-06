"""Grant Word documents — .docx files edited in place in OnlyOffice, with a
Google Docs copy for people who'd rather work there.

Why OnlyOffice: it edits OOXML natively, so headings, numbered and nested
lists, tables, fonts, spacing, section layout, headers/footers and images look
the same as in Word and survive saving. The stored .docx is the file itself —
never converted to the app's rich-text HTML. A Word document is a `Document`
row on the grant (a Saved file, or a tab imported into the grant editor);
every save from the editor is a new `DocumentVersion`.

Google Docs: "Open in Google Docs" uploads the .docx to the user's Drive as a
Google Doc and keeps the link on the document. The app's .docx stays the
source of truth; the two editors can't share one live session, so they hand
off: opening the Google copy first brings it up to date with the app's file,
and opening the document in the app first brings in edits made in Google Docs.
When both changed since the last sync the user picks which to keep; the other
stays in the app's version history (and Google's own revision history).

Two routers:
  router         /grants/{grant_id}/word-docs/{doc_id}/…  — app users (grant access)
  server_router  /word-docs/{doc_id}/file|callback        — the Document Server only,
                 authenticated by a signed link token plus OnlyOffice's JWT
"""
from __future__ import annotations

import asyncio
import io
import json
import re
import zipfile
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional
from urllib.parse import quote

import redis.asyncio as aioredis
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import _check_grant_access, get_redis, grant_access
from app.database import get_db
from app.models.active_grant import ActiveGrant
from app.models.document import Document, DocumentVersion
from app.models.institution_membership import InstitutionMembership
from app.models.user import User
from app.routers.auth import get_current_user
from app.services import google_word, onlyoffice, storage

log = structlog.get_logger()

router = APIRouter(dependencies=[Depends(grant_access())])
server_router = APIRouter()
_editor = [Depends(grant_access(require_editor=True))]

MAX_BYTES = 50 * 1024 * 1024
DOCX_TYPE = google_word.DOCX_TYPE
_LINK_PURPOSE = "oo-word-doc"
# Google's modifiedTime can trail our own write by a moment.
_SYNC_SLACK = timedelta(seconds=5)

SyncState = Literal["none", "synced", "app_newer", "google_newer", "conflict", "unavailable"]


# ── Schemas ───────────────────────────────────────────────────────────────────

class GoogleCopyOut(BaseModel):
    url: str
    owner_name: Optional[str] = None
    synced_at: Optional[datetime] = None
    state: SyncState = "synced"
    remote_modified_at: Optional[datetime] = None
    remote_modified_by: Optional[str] = None
    # Why the state is "unavailable" (owner's Google account disconnected…).
    problem: Optional[str] = None


class WordDocOut(BaseModel):
    id: str
    grant_id: str
    file_name: str
    version: int
    size_bytes: int = 0
    can_edit: bool
    edited_at: Optional[datetime] = None
    last_edited_by_name: Optional[str] = None
    google: Optional[GoogleCopyOut] = None
    google_connected: bool


class VersionOut(BaseModel):
    version: int
    size_bytes: int
    source: str
    created_by_name: Optional[str] = None
    created_at: datetime


class GoogleOpenIn(BaseModel):
    # When both copies changed: "app" overwrites the Google Doc, "google"
    # brings the Google Doc's version into the app.
    resolve: Optional[Literal["app", "google"]] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def is_docx(doc: Document) -> bool:
    ext = (doc.file_format or "").lower()
    if not ext and doc.file_name and "." in doc.file_name:
        ext = doc.file_name.rsplit(".", 1)[-1].lower()
    return ext == "docx"


def validate_docx(data: bytes) -> None:
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Document is larger than 50 MB.")
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            names = set(zf.namelist())
    except zipfile.BadZipFile:
        raise HTTPException(400, "That file isn't a valid Word document (.docx).")
    if "word/document.xml" not in names:
        raise HTTPException(400, "That file isn't a valid Word document (.docx).")


def _safe_name(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._ -]+", "_", name).strip() or "document.docx"


def _version_key(doc: Document, version: int) -> str:
    return f"grants/{doc.grant_id}/documents/{doc.id}/v{version}/{_safe_name(doc.file_name or 'document.docx')}"


def _set_storage_key(doc: Document, key: str) -> None:
    """doc.notes holds the R2 key, either plain or inside JSON metadata."""
    if doc.notes and doc.notes.startswith("{"):
        try:
            meta = json.loads(doc.notes)
            meta["r2_key"] = key
            doc.notes = json.dumps(meta)
            return
        except (json.JSONDecodeError, TypeError):
            pass
    doc.notes = key


def _attachment(data: bytes, file_name: str) -> Response:
    return Response(
        content=data,
        media_type=DOCX_TYPE,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(file_name)}"},
    )


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    return dt.replace(tzinfo=timezone.utc) if dt and dt.tzinfo is None else dt


async def get_word_doc(db: AsyncSession, grant_id: str, doc_id: str) -> Document:
    doc = (await db.execute(
        select(Document).where(Document.id == doc_id, Document.grant_id == grant_id)
    )).scalar_one_or_none()
    if not doc or not is_docx(doc):
        raise HTTPException(404, "Word document not found")
    return doc


async def _can_edit(grant_id: str, user: User, db: AsyncSession, redis: aioredis.Redis) -> bool:
    try:
        await _check_grant_access(grant_id, user, db, redis, require_editor=True)
        return True
    except HTTPException:
        return False


async def _read_current(doc: Document) -> bytes:
    key = storage.resolve_storage_key(doc.notes)
    if not key:
        raise HTTPException(404, "This document's file is missing.")
    try:
        return await asyncio.to_thread(storage.download_file, key)
    except FileNotFoundError:
        raise HTTPException(404, "This document's file is missing.") from None


async def ensure_editable(db: AsyncSession, doc: Document) -> None:
    """First open: give the document a session key and record the uploaded
    file as version 1."""
    changed = False
    if not doc.oo_doc_key:
        doc.oo_doc_key = onlyoffice.new_doc_key(doc.id)
        changed = True
    has_versions = (await db.execute(
        select(DocumentVersion.id).where(DocumentVersion.document_id == doc.id).limit(1)
    )).first()
    key = storage.resolve_storage_key(doc.notes)
    if not has_versions and key:
        db.add(DocumentVersion(
            document_id=doc.id, version=doc.edit_version or 1, storage_key=key,
            source="upload", created_by=doc.uploaded_by_id,
        ))
        changed = True
    if changed:
        await db.commit()
        await db.refresh(doc)


async def store_version(db: AsyncSession, doc: Document, data: bytes, user_id: Optional[str], source: str) -> int:
    """Save `data` as the document's next version (the caller commits)."""
    version = (doc.edit_version or 1) + 1
    key = _version_key(doc, version)
    await asyncio.to_thread(storage.upload_file, key, data, DOCX_TYPE)
    db.add(DocumentVersion(
        document_id=doc.id, version=version, storage_key=key,
        size_bytes=len(data), source=source, created_by=user_id,
    ))
    doc.edit_version = version
    _set_storage_key(doc, key)
    doc.edited_at = datetime.now(timezone.utc)
    doc.last_edited_by_id = user_id or doc.last_edited_by_id
    return version


def _reparse(doc_id: str) -> None:
    """Keep parsed_text (AI context, search) in step with the edited file."""
    try:
        from app.workers.celery_app import celery_app
        celery_app.send_task("app.workers.embedding_tasks.parse_and_embed_document", args=[doc_id])
    except Exception as exc:  # broker down — the next save tries again
        log.warning("word_doc_reparse_queue_failed", doc_id=doc_id, error=str(exc))


async def save_live_session(db: AsyncSession, doc: Document) -> None:
    """If someone has the document open in the app with unsaved changes, have
    the Document Server save them now and wait (≤10s) for that version."""
    if not (onlyoffice.ready() and doc.oo_doc_key and await onlyoffice.request_forcesave(doc.oo_doc_key)):
        return
    start = doc.edit_version
    for _ in range(20):
        await asyncio.sleep(0.5)
        await db.refresh(doc)
        if doc.edit_version != start:
            return


async def _user_names(db: AsyncSession, ids: set[Optional[str]]) -> dict[str, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = (await db.execute(select(User.id, User.name).where(User.id.in_(ids)))).all()
    return {r.id: r.name for r in rows}


# ── Google copy ───────────────────────────────────────────────────────────────

async def _google_token(user: User, db: AsyncSession) -> str:
    from app.services.google_auth import get_valid_google_token

    if not user.google_access_token or not user.google_refresh_token:
        raise HTTPException(403, "Connect your Google account first (Settings → Integrations).")
    try:
        return await get_valid_google_token(user, db)
    except Exception:
        raise HTTPException(403, "Your Google connection has expired. Reconnect it in Settings → Integrations.")


async def _owner_in_grant_org(owner: User, grant_id: str, db: AsyncSession) -> bool:
    """Whether the copy's owner still belongs to the grant's organization (any
    of their orgs, not just the active one — switching orgs shouldn't break
    the team's sync)."""
    grant = await db.get(ActiveGrant, grant_id)
    if not grant:
        return False
    if not grant.institution_id:
        return grant.created_by_id == owner.id
    return (await db.execute(select(InstitutionMembership.id).where(
        InstitutionMembership.user_id == owner.id,
        InstitutionMembership.institution_id == grant.institution_id,
    ))).first() is not None


async def _owner_token(doc: Document, db: AsyncSession) -> str:
    """The Google copy lives in its creator's Drive, and drive.file only lets
    the app reach it with that person's token. Grant content is never synced
    into the Drive of someone who has left the grant's organization."""
    owner = await db.get(User, doc.google_owner_id) if doc.google_owner_id else None
    if not owner or not await _owner_in_grant_org(owner, doc.grant_id, db):
        raise HTTPException(409, "The Google Docs copy is in the Drive of someone who's no longer in this organization. "
                                 "Unlink it and make a new copy.")
    try:
        return await _google_token(owner, db)
    except HTTPException:
        raise HTTPException(
            409, f"The Google Docs copy is in {owner.name}'s Drive, and their Google account isn't connected any more. "
                 "Ask them to reconnect it, or unlink the copy and make a new one.",
        )


def _drive_folder_id(grant: Optional[ActiveGrant]) -> Optional[str]:
    url = grant.drive_folder_url if grant else None
    if url and "folders/" in url:
        return url.split("folders/")[-1].split("?")[0].split("/")[0]
    return None


def _clear_google(doc: Document) -> None:
    doc.google_file_id = doc.google_file_url = doc.google_owner_id = None
    doc.google_synced_at = doc.google_synced_version = None


async def _remote(doc: Document, token: str) -> dict:
    return await asyncio.to_thread(google_word.remote_state, token, doc.google_file_id)


def _sync_state(doc: Document, remote_modified: Optional[datetime]) -> SyncState:
    synced_at = _aware(doc.google_synced_at)
    google_changed = bool(remote_modified and (not synced_at or remote_modified > synced_at + _SYNC_SLACK))
    app_changed = (doc.edit_version or 1) > (doc.google_synced_version or 0)
    if google_changed and app_changed:
        return "conflict"
    if google_changed:
        return "google_newer"
    if app_changed:
        return "app_newer"
    return "synced"


async def _push_to_google(db: AsyncSession, doc: Document, token: str) -> None:
    data = await _read_current(doc)
    modified = await asyncio.to_thread(google_word.replace_contents, token, doc.google_file_id, data)
    doc.google_synced_at = google_word.parse_time(modified)
    doc.google_synced_version = doc.edit_version


async def _pull_from_google(db: AsyncSession, doc: Document, token: str, user_id: Optional[str]) -> None:
    """Bring the Google Doc's contents in as a new version and start a fresh
    editing session for it; anyone still in the old session is disconnected."""
    remote = await _remote(doc, token)
    data = await asyncio.to_thread(google_word.export_docx, token, doc.google_file_id)
    validate_docx(data)
    await store_version(db, doc, data, user_id, "google")
    old_key, live = doc.oo_doc_key, list(doc.oo_session_users or [])
    doc.oo_doc_key = onlyoffice.new_doc_key(doc.id)
    doc.oo_session_users = []
    doc.google_synced_at = remote["modified_at"]
    doc.google_synced_version = doc.edit_version
    await db.commit()
    if old_key and live and onlyoffice.ready():
        await onlyoffice.command({"c": "drop", "key": old_key, "users": live})
    _reparse(doc.id)


async def _google_out(db: AsyncSession, doc: Document, check_remote: bool = True) -> Optional[GoogleCopyOut]:
    if not doc.google_file_id:
        return None
    names = await _user_names(db, {doc.google_owner_id})
    out = GoogleCopyOut(
        url=doc.google_file_url or f"https://docs.google.com/document/d/{doc.google_file_id}/edit",
        owner_name=names.get(doc.google_owner_id or ""),
        synced_at=doc.google_synced_at,
        state=_sync_state(doc, None),
    )
    if not check_remote:
        return out
    try:
        remote = await _remote(doc, await _owner_token(doc, db))
    except HTTPException as exc:
        out.state, out.problem = "unavailable", exc.detail
        return out
    except google_word.GoogleFileGone:
        out.state, out.problem = "unavailable", "The Google Docs copy was deleted. Open in Google Docs again to make a new one."
        return out
    except Exception as exc:
        log.warning("word_doc_google_status_failed", doc_id=doc.id, error=str(exc))
        out.state, out.problem = "unavailable", "Couldn't reach Google Drive."
        return out
    out.state = _sync_state(doc, remote["modified_at"])
    out.remote_modified_at, out.remote_modified_by = remote["modified_at"], remote["modified_by"]
    return out


async def _share_with(db: AsyncSession, doc: Document, token: str, user: User, can_edit: bool) -> Optional[str]:
    """Give a grant member access to the Google copy (no Google email). Returns
    a note when Google refused."""
    if user.id == doc.google_owner_id:
        return None
    email = user.email
    if user.google_access_token and user.google_refresh_token:
        try:
            email = await asyncio.to_thread(google_word.account_email, await _google_token(user, db)) or email
        except HTTPException:
            pass
    try:
        await asyncio.to_thread(google_word.share, token, doc.google_file_id, email, "writer" if can_edit else "commenter")
        return None
    except Exception as exc:
        log.info("word_doc_google_share_failed", doc_id=doc.id, error=str(exc))
        return f"Google wouldn't share the copy with {email}. Ask its owner to share it with your Google account."


# ── App routes ────────────────────────────────────────────────────────────────

@router.get("/{grant_id}/word-docs/{doc_id}", response_model=WordDocOut)
async def word_doc_status(
    grant_id: str,
    doc_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis),
):
    """The document's version, who last edited it, and how its Google Docs
    copy compares (checked live against Drive)."""
    doc = await get_word_doc(db, grant_id, doc_id)
    names = await _user_names(db, {doc.last_edited_by_id})
    return WordDocOut(
        id=doc.id, grant_id=grant_id, file_name=doc.file_name or "document.docx",
        version=doc.edit_version or 1,
        can_edit=await _can_edit(grant_id, current_user, db, redis),
        edited_at=doc.edited_at, last_edited_by_name=names.get(doc.last_edited_by_id or ""),
        google=await _google_out(db, doc),
        google_connected=bool(current_user.google_access_token and current_user.google_refresh_token),
    )


@router.get("/{grant_id}/word-docs/{doc_id}/editor")
async def editor_config(
    grant_id: str,
    doc_id: str,
    fit_width: bool = False,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis),
):
    """Signed OnlyOffice config for opening this document in the browser.
    If it was edited in Google Docs since the last sync, and not here, and
    nobody has it open in the app, those edits are brought in first.
    `fit_width` opens it zoomed to the panel's width (split view)."""
    if not onlyoffice.ready():
        raise HTTPException(503, "The document editor isn't configured (set ONLYOFFICE_URL and ONLYOFFICE_JWT_SECRET).")
    doc = await get_word_doc(db, grant_id, doc_id)
    await ensure_editable(db, doc)
    can_edit = await _can_edit(grant_id, current_user, db, redis)

    pulled = False
    if can_edit and doc.google_file_id and not doc.oo_session_users:
        try:
            token = await _owner_token(doc, db)
            remote = await _remote(doc, token)
            if _sync_state(doc, remote["modified_at"]) == "google_newer":
                await _pull_from_google(db, doc, token, current_user.id)
                pulled = True
        except Exception as exc:  # Google unreachable → open the app's copy as is
            log.info("word_doc_google_autopull_skipped", doc_id=doc.id, error=str(getattr(exc, "detail", exc)))

    link = onlyoffice.link_token(doc.id, _LINK_PURPOSE)
    base = f"{onlyoffice.backend_base()}/api/v1/word-docs/{doc.id}"
    config = {
        "documentType": "word",
        "document": {
            "fileType": "docx",
            "key": doc.oo_doc_key,
            "title": doc.file_name or "document.docx",
            "url": f"{base}/file?token={link}",
            "permissions": {"edit": can_edit, "comment": can_edit, "review": can_edit, "download": True, "print": True},
        },
        "editorConfig": {
            "mode": "edit" if can_edit else "view",
            "callbackUrl": f"{base}/callback?token={link}",
            "lang": "en",
            "user": {"id": current_user.id, "name": current_user.name},
            "customization": {
                "forcesave": True,      # the Save button writes a version immediately
                "autosave": True,
                "compactHeader": True,
                "macros": False,
                "plugins": False,
                "goback": False,
                **({"zoom": -2} if fit_width else {}),  # -2 = fit page width
            },
        },
    }
    config["token"] = onlyoffice.sign(config)
    return {
        "document_server_url": onlyoffice.public_url(), "config": config,
        "can_edit": can_edit, "pulled_from_google": pulled,
    }


@router.get("/{grant_id}/word-docs/{doc_id}/download")
async def download_word_doc(grant_id: str, doc_id: str, db: AsyncSession = Depends(get_db)):
    """The current .docx. If people are editing it right now, their changes
    are saved first so the download is current."""
    doc = await get_word_doc(db, grant_id, doc_id)
    await save_live_session(db, doc)
    return _attachment(await _read_current(doc), doc.file_name or "document.docx")


@router.get("/{grant_id}/word-docs/{doc_id}/versions", response_model=list[VersionOut])
async def list_versions(grant_id: str, doc_id: str, db: AsyncSession = Depends(get_db)):
    await get_word_doc(db, grant_id, doc_id)
    versions = (await db.execute(
        select(DocumentVersion)
        .where(DocumentVersion.document_id == doc_id)
        .order_by(DocumentVersion.version.desc())
    )).scalars().all()
    names = await _user_names(db, {v.created_by for v in versions})
    return [
        VersionOut(version=v.version, size_bytes=v.size_bytes or 0, source=v.source or "editor",
                   created_by_name=names.get(v.created_by or ""), created_at=v.created_at)
        for v in versions
    ]


@router.get("/{grant_id}/word-docs/{doc_id}/versions/{version}/download")
async def download_version(grant_id: str, doc_id: str, version: int, db: AsyncSession = Depends(get_db)):
    doc = await get_word_doc(db, grant_id, doc_id)
    v = (await db.execute(
        select(DocumentVersion).where(DocumentVersion.document_id == doc_id, DocumentVersion.version == version)
    )).scalar_one_or_none()
    if not v:
        raise HTTPException(404, "Version not found")
    data = await asyncio.to_thread(storage.download_file, v.storage_key)
    stem = (doc.file_name or "document.docx").rsplit(".", 1)[0]
    return _attachment(data, f"{stem} (v{version}).docx")


@router.post("/{grant_id}/word-docs/{doc_id}/google", response_model=GoogleCopyOut)
async def open_in_google_docs(
    grant_id: str,
    doc_id: str,
    body: Optional[GoogleOpenIn] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis),
):
    """Get the Google Docs link, making the copy (in the current user's Drive,
    inside the grant's Drive folder when it has one) or bringing it up to date
    with the app's file first. Shares the copy with the person asking.
    409 with {"conflict": true} when both copies changed since the last sync."""
    doc = await get_word_doc(db, grant_id, doc_id)
    can_edit = await _can_edit(grant_id, current_user, db, redis)
    await save_live_session(db, doc)
    resolve = body.resolve if body else None

    token: Optional[str] = None
    remote: Optional[dict] = None
    if doc.google_file_id:
        token = await _owner_token(doc, db)
        try:
            remote = await _remote(doc, token)
        except google_word.GoogleFileGone:
            _clear_google(doc)
            await db.commit()
    if not doc.google_file_id:
        if not can_edit:
            raise HTTPException(403, "There's no Google Docs copy yet. Ask an editor on this grant to open it in Google Docs first.")
        token = await _google_token(current_user, db)
        data = await _read_current(doc)
        grant = await db.get(ActiveGrant, grant_id)
        stem = (doc.file_name or "Document").rsplit(".", 1)[0]
        try:
            created = await asyncio.to_thread(google_word.create_copy, token, stem, data, _drive_folder_id(grant))
        except Exception as exc:
            log.warning("word_doc_google_create_failed", doc_id=doc.id, error=str(exc))
            raise HTTPException(502, "Google Drive didn't accept the document. Try again in a moment.") from exc
        doc.google_file_id = created["id"]
        doc.google_file_url = created.get("webViewLink") or f"https://docs.google.com/document/d/{created['id']}/edit"
        doc.google_owner_id = current_user.id
        doc.google_synced_at = google_word.parse_time(created.get("modifiedTime"))
        doc.google_synced_version = doc.edit_version or 1
        await db.commit()
        log.info("word_doc_google_created", doc_id=doc.id, grant_id=grant_id)
        return await _google_out(db, doc, check_remote=False)

    state = _sync_state(doc, remote["modified_at"])
    if resolve and not can_edit:
        raise HTTPException(403, "Only editors on this grant can choose which version to keep.")
    if state == "conflict" and resolve is None:
        raise HTTPException(409, {
            "conflict": True,
            "message": "This document was changed both here and in Google Docs since they were last in step.",
            "remote_modified_at": remote["modified_at"].isoformat() if remote["modified_at"] else None,
            "remote_modified_by": remote["modified_by"],
        })
    try:
        if state == "conflict" and resolve == "google":
            await _pull_from_google(db, doc, token, current_user.id)
        elif state == "app_newer" or (state == "conflict" and resolve == "app"):
            await _push_to_google(db, doc, token)
            await db.commit()
    except google_word.GoogleFileGone:
        _clear_google(doc)
        await db.commit()
        raise HTTPException(410, "The Google Docs copy was deleted. Open in Google Docs again to make a new one.")

    note = await _share_with(db, doc, token, current_user, can_edit)
    out = await _google_out(db, doc)
    if out and note:
        out.problem = note
    return out


@router.post("/{grant_id}/word-docs/{doc_id}/google/pull", response_model=GoogleCopyOut, dependencies=_editor)
async def pull_from_google_docs(
    grant_id: str,
    doc_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Replace the app's file with the Google Docs version. The app's current
    file (with any unsaved edits, saved first) stays in version history."""
    doc = await get_word_doc(db, grant_id, doc_id)
    if not doc.google_file_id:
        raise HTTPException(404, "This document has no Google Docs copy.")
    await save_live_session(db, doc)
    token = await _owner_token(doc, db)
    try:
        await _pull_from_google(db, doc, token, current_user.id)
    except google_word.GoogleFileGone:
        _clear_google(doc)
        await db.commit()
        raise HTTPException(410, "The Google Docs copy was deleted.")
    return await _google_out(db, doc, check_remote=False)


@router.delete("/{grant_id}/word-docs/{doc_id}/google", status_code=204, dependencies=_editor)
async def unlink_google_docs(grant_id: str, doc_id: str, db: AsyncSession = Depends(get_db)):
    """Forget the Google Docs copy. The file itself stays in its owner's Drive."""
    doc = await get_word_doc(db, grant_id, doc_id)
    _clear_google(doc)
    await db.commit()


# ── Document Server routes ────────────────────────────────────────────────────

@server_router.get("/{doc_id}/file")
async def serve_file(doc_id: str, token: str = Query(...), db: AsyncSession = Depends(get_db)):
    """The Document Server fetches the current .docx from here."""
    onlyoffice.check_link_token(token, doc_id, _LINK_PURPOSE)
    doc = await db.get(Document, doc_id)
    if not doc or not is_docx(doc):
        raise HTTPException(404, "Document not found")
    return _attachment(await _read_current(doc), doc.file_name or "document.docx")


@server_router.post("/{doc_id}/callback")
async def document_server_callback(
    doc_id: str,
    request: Request,
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """OnlyOffice status callback. 1 = who has it open changed; 2 = everyone
    closed it and it has changes (save, start a fresh session key); 4 = closed
    with no changes; 6 = force save while editing continues (save, keep the
    key). The Document Server expects {"error": 0} on success."""
    onlyoffice.check_link_token(token, doc_id, _LINK_PURPOSE)
    payload = onlyoffice.verify_callback(request, await request.json())
    status = payload.get("status")

    doc = (await db.execute(select(Document).where(Document.id == doc_id).with_for_update())).scalar_one_or_none()
    if not doc:
        return {"error": 0}  # deleted while open — drop the save
    if payload.get("key") != doc.oo_doc_key:
        log.warning("onlyoffice_stale_callback", doc_id=doc_id, key=payload.get("key"), status=status)
        return {"error": 0}

    if status == 1:
        doc.oo_session_users = list(payload.get("users") or [])
        await db.commit()
        return {"error": 0}
    if status not in (2, 6):
        if status in (3, 4):  # session over (3 = it couldn't save)
            doc.oo_session_users = []
            await db.commit()
        return {"error": 0}

    if (payload.get("filetype") or "docx").lower() != "docx":
        log.error("onlyoffice_format_mismatch", expected="docx", got=payload.get("filetype"))
        return {"error": 1}
    try:
        data = await onlyoffice.fetch_saved_file(payload["url"])
        validate_docx(data)
    except Exception as exc:
        log.error("onlyoffice_save_fetch_failed", doc_id=doc_id, error=str(exc))
        return {"error": 1}

    users = payload.get("users") or []
    editor_id = users[0] if users else None
    if editor_id and not await db.get(User, editor_id):
        editor_id = None
    version = await store_version(db, doc, data, editor_id, "editor")
    if status == 2:
        doc.oo_doc_key = onlyoffice.new_doc_key(doc.id)
        doc.oo_session_users = []
    await db.commit()
    log.info("onlyoffice_saved", doc_id=doc_id, version=version, status=status)
    if status == 2:
        _reparse(doc.id)
    return {"error": 0}

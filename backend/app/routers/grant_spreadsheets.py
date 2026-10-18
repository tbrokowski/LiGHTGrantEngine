"""Grant spreadsheets — Excel workbooks (.xlsx / .xlsm) co-edited in OnlyOffice.

Why OnlyOffice: it edits OOXML natively, so cell styles, merged cells,
conditional formatting, data validation, charts, named ranges, formulas and —
for .xlsm — the VBA project all survive a round trip. Every workbook is stored
in object storage as the original file; nothing is converted into an
intermediate format. Collaborators open the same `doc_key` and edit together in
real time; the Document Server posts the saved file back to `/callback`.

Two routers:
  router         /grants/{grant_id}/spreadsheets/…  — app users (grant access)
  server_router  /spreadsheets/{id}/file|callback   — the Document Server only,
                 authenticated by a signed link token plus OnlyOffice's JWT
"""
from __future__ import annotations

import asyncio
import io
import re
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import quote, urlsplit, urlunsplit

import httpx
import structlog
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import _check_grant_access, get_redis, grant_access
from app.config import get_settings
from app.database import get_db
from app.models.grant_spreadsheet import GrantSpreadsheet, GrantSpreadsheetVersion
from app.models.user import User
from app.routers.auth import get_current_user
from app.services import storage

log = structlog.get_logger()
settings = get_settings()

router = APIRouter(dependencies=[Depends(grant_access())])
server_router = APIRouter()

MAX_BYTES = 50 * 1024 * 1024
CONTENT_TYPES = {
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
}
_LINK_PURPOSE = "oo-spreadsheet"


# ── Schemas ───────────────────────────────────────────────────────────────────

class SpreadsheetOut(BaseModel):
    id: str
    grant_id: str
    file_name: str
    file_ext: str
    size_bytes: int
    version: int
    uploaded_by: Optional[str] = None
    uploaded_by_name: Optional[str] = None
    last_edited_by: Optional[str] = None
    last_edited_by_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class VersionOut(BaseModel):
    version: int
    size_bytes: int
    created_by_name: Optional[str] = None
    created_at: datetime


# ── Helpers ───────────────────────────────────────────────────────────────────

def _onlyoffice_ready() -> bool:
    return bool(settings.onlyoffice_url and settings.onlyoffice_jwt_secret)


def _new_doc_key(spreadsheet_id: str) -> str:
    # OnlyOffice keys: ≤128 chars of [0-9A-Za-z.=_-]
    return f"{spreadsheet_id[:8]}-{uuid.uuid4().hex}"


def _safe_name(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._ -]+", "_", name).strip() or "workbook"


def _storage_key(sheet: GrantSpreadsheet, version: int) -> str:
    return f"grants/{sheet.grant_id}/spreadsheets/{sheet.id}/v{version}/{_safe_name(sheet.file_name)}"


def _validate_workbook(data: bytes, ext: str) -> None:
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Workbook is larger than 50 MB.")
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            names = set(zf.namelist())
    except zipfile.BadZipFile:
        raise HTTPException(400, "That file isn't a valid Excel workbook.")
    if "xl/workbook.xml" not in names:
        raise HTTPException(400, "That file isn't a valid Excel workbook.")
    if ext == "xlsx" and "xl/vbaProject.bin" in names:
        raise HTTPException(400, "This workbook contains macros — save it as .xlsm and upload again.")


def _attachment(data: bytes, file_name: str, ext: str) -> Response:
    return Response(
        content=data,
        media_type=CONTENT_TYPES.get(ext, "application/octet-stream"),
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(file_name)}"},
    )


async def _get_sheet(db: AsyncSession, grant_id: str, spreadsheet_id: str) -> GrantSpreadsheet:
    sheet = (await db.execute(
        select(GrantSpreadsheet).where(
            GrantSpreadsheet.id == spreadsheet_id, GrantSpreadsheet.grant_id == grant_id,
        )
    )).scalar_one_or_none()
    if not sheet:
        raise HTTPException(404, "Workbook not found")
    return sheet


async def _user_names(db: AsyncSession, ids: set[str | None]) -> dict[str, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = (await db.execute(select(User.id, User.name).where(User.id.in_(ids)))).all()
    return {r.id: r.name for r in rows}


async def _to_out(db: AsyncSession, sheets: list[GrantSpreadsheet]) -> list[SpreadsheetOut]:
    names = await _user_names(db, {s.uploaded_by for s in sheets} | {s.last_edited_by for s in sheets})
    return [
        SpreadsheetOut(
            id=s.id, grant_id=s.grant_id, file_name=s.file_name, file_ext=s.file_ext,
            size_bytes=s.size_bytes or 0, version=s.version,
            uploaded_by=s.uploaded_by, uploaded_by_name=names.get(s.uploaded_by or ""),
            last_edited_by=s.last_edited_by, last_edited_by_name=names.get(s.last_edited_by or ""),
            created_at=s.created_at, updated_at=s.updated_at,
        )
        for s in sheets
    ]


def _link_token(spreadsheet_id: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=24)
    return jwt.encode(
        {"sid": spreadsheet_id, "purpose": _LINK_PURPOSE, "exp": exp},
        settings.secret_key, algorithm=settings.algorithm,
    )


def _check_link_token(token: str, spreadsheet_id: str) -> None:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError:
        raise HTTPException(403, "Invalid link")
    if payload.get("purpose") != _LINK_PURPOSE or payload.get("sid") != spreadsheet_id:
        raise HTTPException(403, "Invalid link")


def _backend_base() -> str:
    return (settings.onlyoffice_backend_url or settings.api_url).rstrip("/")


def _internal_docserver() -> str:
    return (settings.onlyoffice_internal_url or settings.onlyoffice_url or "").rstrip("/")


def _docserver_fetch_url(url: str) -> str:
    """Point a Document Server file URL at an address this backend can reach,
    and refuse URLs on any other host (no fetching arbitrary hosts)."""
    allowed = {urlsplit(u).netloc for u in (settings.onlyoffice_url, settings.onlyoffice_internal_url) if u}
    parts = urlsplit(url)
    if parts.netloc not in allowed:
        raise HTTPException(400, "Unexpected file host")
    internal = urlsplit(_internal_docserver())
    return urlunsplit((internal.scheme, internal.netloc, parts.path, parts.query, ""))


async def _request_forcesave(doc_key: str) -> bool:
    """Ask the Document Server to save the live session now. Returns True when
    a save was started (a status-6 callback will follow), False when there was
    nothing to save or no session is open."""
    body = {"c": "forcesave", "key": doc_key}
    body["token"] = jwt.encode(body, settings.onlyoffice_jwt_secret, algorithm="HS256")
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            res = await client.post(f"{_internal_docserver()}/coauthoring/CommandService.ashx", json=body)
        return res.json().get("error") == 0
    except Exception as exc:  # Document Server down → serve the last saved file
        log.warning("onlyoffice_forcesave_failed", error=str(exc))
        return False


# ── App routes ────────────────────────────────────────────────────────────────

@router.get("/{grant_id}/spreadsheets", response_model=list[SpreadsheetOut])
async def list_spreadsheets(grant_id: str, db: AsyncSession = Depends(get_db)):
    sheets = (await db.execute(
        select(GrantSpreadsheet)
        .where(GrantSpreadsheet.grant_id == grant_id)
        .order_by(GrantSpreadsheet.created_at)
    )).scalars().all()
    return await _to_out(db, list(sheets))


@router.post("/{grant_id}/spreadsheets", response_model=SpreadsheetOut,
             dependencies=[Depends(grant_access(require_editor=True))])
async def upload_spreadsheet(
    grant_id: str,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    file_name = (file.filename or "workbook.xlsx").strip()
    ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
    if ext not in CONTENT_TYPES:
        raise HTTPException(400, "Upload an Excel workbook (.xlsx or .xlsm).")
    data = await file.read()
    _validate_workbook(data, ext)

    sheet = GrantSpreadsheet(
        id=str(uuid.uuid4()), grant_id=grant_id, file_name=file_name, file_ext=ext,
        size_bytes=len(data), version=1, uploaded_by=current_user.id,
        last_edited_by=current_user.id, storage_key="",
    )
    sheet.doc_key = _new_doc_key(sheet.id)
    sheet.storage_key = _storage_key(sheet, 1)
    await asyncio.to_thread(storage.upload_file, sheet.storage_key, data, CONTENT_TYPES[ext])

    db.add(sheet)
    db.add(GrantSpreadsheetVersion(
        spreadsheet_id=sheet.id, version=1, storage_key=sheet.storage_key,
        size_bytes=len(data), created_by=current_user.id,
    ))
    await db.commit()
    await db.refresh(sheet)
    return (await _to_out(db, [sheet]))[0]


@router.get("/{grant_id}/spreadsheets/{spreadsheet_id}/editor")
async def editor_config(
    grant_id: str,
    spreadsheet_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Signed OnlyOffice config for opening this workbook in the browser."""
    if not _onlyoffice_ready():
        raise HTTPException(503, "The spreadsheet editor isn't configured (set ONLYOFFICE_URL and ONLYOFFICE_JWT_SECRET).")
    sheet = await _get_sheet(db, grant_id, spreadsheet_id)

    try:
        await _check_grant_access(grant_id, current_user, db, await get_redis(), require_editor=True)
        can_edit = True
    except HTTPException:
        can_edit = False

    link = _link_token(sheet.id)
    base = f"{_backend_base()}/api/v1/spreadsheets/{sheet.id}"
    config = {
        "documentType": "cell",
        "document": {
            "fileType": sheet.file_ext,
            "key": sheet.doc_key,
            "title": sheet.file_name,
            "url": f"{base}/file?token={link}",
            "permissions": {"edit": can_edit, "comment": can_edit, "download": True, "print": True},
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
                "macros": False,        # never run macros in the browser; VBA is still preserved
                "plugins": False,
                "goback": False,
            },
        },
    }
    config["token"] = jwt.encode(config, settings.onlyoffice_jwt_secret, algorithm="HS256")
    return {"document_server_url": settings.onlyoffice_url.rstrip("/"), "config": config, "can_edit": can_edit}


@router.get("/{grant_id}/spreadsheets/{spreadsheet_id}/download")
async def download_spreadsheet(grant_id: str, spreadsheet_id: str, db: AsyncSession = Depends(get_db)):
    """Download the workbook in its original format. If people are editing it
    right now, their changes are saved first so the export is current."""
    sheet = await _get_sheet(db, grant_id, spreadsheet_id)
    if _onlyoffice_ready() and await _request_forcesave(sheet.doc_key):
        start_version = sheet.version
        for _ in range(20):  # wait up to ~10s for the status-6 callback
            await asyncio.sleep(0.5)
            await db.refresh(sheet)
            if sheet.version != start_version:
                break
    data = await asyncio.to_thread(storage.download_file, sheet.storage_key)
    return _attachment(data, sheet.file_name, sheet.file_ext)


@router.get("/{grant_id}/spreadsheets/{spreadsheet_id}/versions", response_model=list[VersionOut])
async def list_versions(grant_id: str, spreadsheet_id: str, db: AsyncSession = Depends(get_db)):
    await _get_sheet(db, grant_id, spreadsheet_id)
    versions = (await db.execute(
        select(GrantSpreadsheetVersion)
        .where(GrantSpreadsheetVersion.spreadsheet_id == spreadsheet_id)
        .order_by(GrantSpreadsheetVersion.version.desc())
    )).scalars().all()
    names = await _user_names(db, {v.created_by for v in versions})
    return [
        VersionOut(version=v.version, size_bytes=v.size_bytes or 0,
                   created_by_name=names.get(v.created_by or ""), created_at=v.created_at)
        for v in versions
    ]


@router.get("/{grant_id}/spreadsheets/{spreadsheet_id}/versions/{version}/download")
async def download_version(grant_id: str, spreadsheet_id: str, version: int, db: AsyncSession = Depends(get_db)):
    sheet = await _get_sheet(db, grant_id, spreadsheet_id)
    v = (await db.execute(
        select(GrantSpreadsheetVersion).where(
            GrantSpreadsheetVersion.spreadsheet_id == spreadsheet_id,
            GrantSpreadsheetVersion.version == version,
        )
    )).scalar_one_or_none()
    if not v:
        raise HTTPException(404, "Version not found")
    data = await asyncio.to_thread(storage.download_file, v.storage_key)
    stem, _, ext = sheet.file_name.rpartition(".")
    return _attachment(data, f"{stem or sheet.file_name} (v{version}).{sheet.file_ext}", sheet.file_ext)


@router.delete("/{grant_id}/spreadsheets/{spreadsheet_id}", status_code=204,
               dependencies=[Depends(grant_access(require_editor=True))])
async def delete_spreadsheet(grant_id: str, spreadsheet_id: str, db: AsyncSession = Depends(get_db)):
    sheet = await _get_sheet(db, grant_id, spreadsheet_id)
    keys = (await db.execute(
        select(GrantSpreadsheetVersion.storage_key)
        .where(GrantSpreadsheetVersion.spreadsheet_id == spreadsheet_id)
    )).scalars().all()
    await db.delete(sheet)
    await db.commit()
    for key in set(keys) | {sheet.storage_key}:
        await asyncio.to_thread(storage.delete_file, key)


# ── Document Server routes ────────────────────────────────────────────────────

@server_router.get("/{spreadsheet_id}/file")
async def serve_file(spreadsheet_id: str, token: str = Query(...), db: AsyncSession = Depends(get_db)):
    """The Document Server fetches the current workbook from here."""
    _check_link_token(token, spreadsheet_id)
    sheet = await db.get(GrantSpreadsheet, spreadsheet_id)
    if not sheet:
        raise HTTPException(404, "Workbook not found")
    data = await asyncio.to_thread(storage.download_file, sheet.storage_key)
    return _attachment(data, sheet.file_name, sheet.file_ext)


def _verify_callback(request: Request, body: dict) -> dict:
    """Return the callback payload as signed by the Document Server."""
    secret = settings.onlyoffice_jwt_secret
    if not secret:
        raise HTTPException(503, "OnlyOffice is not configured")
    try:
        if body.get("token"):
            return jwt.decode(body["token"], secret, algorithms=["HS256"])
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            return jwt.decode(auth[7:], secret, algorithms=["HS256"]).get("payload") or {}
    except JWTError:
        pass
    raise HTTPException(403, "Invalid Document Server signature")


@server_router.post("/{spreadsheet_id}/callback")
async def document_server_callback(
    spreadsheet_id: str,
    request: Request,
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """OnlyOffice status callback. Status 2 = everyone closed the workbook and
    it has changes (save, start a fresh session key); 6 = force save while
    editing continues (save, keep the key). Anything else needs no action.
    The Document Server expects {"error": 0} on success."""
    _check_link_token(token, spreadsheet_id)
    payload = _verify_callback(request, await request.json())
    status = payload.get("status")
    if status not in (2, 6):
        return {"error": 0}

    sheet = (await db.execute(
        select(GrantSpreadsheet).where(GrantSpreadsheet.id == spreadsheet_id).with_for_update()
    )).scalar_one_or_none()
    if not sheet:
        return {"error": 0}  # deleted while open — drop the save
    if payload.get("key") != sheet.doc_key:
        log.warning("onlyoffice_stale_callback", spreadsheet_id=spreadsheet_id, key=payload.get("key"))
        return {"error": 0}

    returned_type = (payload.get("filetype") or sheet.file_ext).lower()
    if returned_type != sheet.file_ext:
        # Happens only if the server's assemblyFormatAsOrigin is off; storing it
        # under the original extension would corrupt the file.
        log.error("onlyoffice_format_mismatch", expected=sheet.file_ext, got=returned_type)
        return {"error": 1}

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            res = await client.get(_docserver_fetch_url(payload["url"]))
            res.raise_for_status()
            data = res.content
        _validate_workbook(data, sheet.file_ext)
    except Exception as exc:
        log.error("onlyoffice_save_fetch_failed", spreadsheet_id=spreadsheet_id, error=str(exc))
        return {"error": 1}

    users = payload.get("users") or []
    editor_id = users[0] if users else None
    if editor_id and not await db.get(User, editor_id):
        editor_id = None

    version = sheet.version + 1
    key = _storage_key(sheet, version)
    await asyncio.to_thread(storage.upload_file, key, data, CONTENT_TYPES[sheet.file_ext])
    db.add(GrantSpreadsheetVersion(
        spreadsheet_id=sheet.id, version=version, storage_key=key,
        size_bytes=len(data), created_by=editor_id,
    ))
    sheet.version = version
    sheet.storage_key = key
    sheet.size_bytes = len(data)
    sheet.last_edited_by = editor_id or sheet.last_edited_by
    if status == 2:
        sheet.doc_key = _new_doc_key(sheet.id)
    await db.commit()
    log.info("onlyoffice_saved", spreadsheet_id=spreadsheet_id, version=version, status=status)
    return {"error": 0}

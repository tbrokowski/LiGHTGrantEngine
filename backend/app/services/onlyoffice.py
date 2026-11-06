"""Shared plumbing for the OnlyOffice Document Server.

Budget workbooks (grant_spreadsheets) and Word documents (grant_word_docs) are
both edited in the Document Server. The browser loads the editor from
`onlyoffice_url`; the Document Server fetches the file from, and posts saves
back to, this backend. Those server-to-server requests carry a signed link
token (scoped to one file and one purpose) and OnlyOffice's own JWT.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit, urlunsplit

import httpx
import structlog
from fastapi import HTTPException, Request
from jose import JWTError, jwt

from app.config import get_settings

log = structlog.get_logger()
settings = get_settings()


def ready() -> bool:
    return bool(settings.onlyoffice_url and settings.onlyoffice_jwt_secret)


def public_url() -> str:
    return (settings.onlyoffice_url or "").rstrip("/")


def new_doc_key(file_id: str) -> str:
    # OnlyOffice keys: ≤128 chars of [0-9A-Za-z.=_-]
    return f"{file_id[:8]}-{uuid.uuid4().hex}"


def sign(payload: dict) -> str:
    return jwt.encode(payload, settings.onlyoffice_jwt_secret, algorithm="HS256")


def link_token(file_id: str, purpose: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=24)
    return jwt.encode(
        {"sid": file_id, "purpose": purpose, "exp": exp},
        settings.secret_key, algorithm=settings.algorithm,
    )


def check_link_token(token: str, file_id: str, purpose: str) -> None:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError:
        raise HTTPException(403, "Invalid link")
    if payload.get("purpose") != purpose or payload.get("sid") != file_id:
        raise HTTPException(403, "Invalid link")


def backend_base() -> str:
    """How the Document Server reaches this backend."""
    return (settings.onlyoffice_backend_url or settings.api_url).rstrip("/")


def internal_docserver() -> str:
    """How this backend reaches the Document Server."""
    return (settings.onlyoffice_internal_url or settings.onlyoffice_url or "").rstrip("/")


def docserver_fetch_url(url: str) -> str:
    """Point a Document Server file URL at an address this backend can reach,
    and refuse URLs on any other host (no fetching arbitrary hosts)."""
    allowed = {urlsplit(u).netloc for u in (settings.onlyoffice_url, settings.onlyoffice_internal_url) if u}
    parts = urlsplit(url)
    if parts.netloc not in allowed:
        raise HTTPException(400, "Unexpected file host")
    internal = urlsplit(internal_docserver())
    return urlunsplit((internal.scheme, internal.netloc, parts.path, parts.query, ""))


async def command(body: dict) -> dict | None:
    """Send a CommandService request (forcesave, drop, info…). None when the
    Document Server can't be reached."""
    body = {**body, "token": sign(body)}
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            res = await client.post(f"{internal_docserver()}/coauthoring/CommandService.ashx", json=body)
        return res.json()
    except Exception as exc:
        log.warning("onlyoffice_command_failed", command=body.get("c"), error=str(exc))
        return None


async def request_forcesave(doc_key: str) -> bool:
    """Ask the Document Server to save the live session now. Returns True when
    a save was started (a status-6 callback will follow), False when there was
    nothing to save or no session is open."""
    res = await command({"c": "forcesave", "key": doc_key})
    return bool(res) and res.get("error") == 0


def verify_callback(request: Request, body: dict) -> dict:
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


async def fetch_saved_file(url: str) -> bytes:
    """Download the file the Document Server assembled for a save callback."""
    async with httpx.AsyncClient(timeout=60) as client:
        res = await client.get(docserver_fetch_url(url))
        res.raise_for_status()
        return res.content

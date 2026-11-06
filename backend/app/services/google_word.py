"""Google Docs copies of a grant's Word documents.

A .docx is uploaded to the user's Drive with conversion to a Google Doc, and
exported back to .docx when it was edited there. Everything goes through the
Drive API with the `drive.file` scope the app already asks for: the app can
read and write the files it created, nothing else in the user's Drive.

These calls block; run them with asyncio.to_thread.
"""
from __future__ import annotations

import io
from datetime import datetime
from typing import Any

import httpx

DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
GOOGLE_DOC_TYPE = "application/vnd.google-apps.document"


class GoogleFileGone(Exception):
    """The Google copy was deleted, trashed or is no longer reachable."""


def _drive(access_token: str) -> Any:
    from google.oauth2.credentials import Credentials  # type: ignore[import]
    from googleapiclient.discovery import build  # type: ignore[import]

    return build("drive", "v3", credentials=Credentials(token=access_token), cache_discovery=False)


def _media(data: bytes) -> Any:
    from googleapiclient.http import MediaIoBaseUpload  # type: ignore[import]

    return MediaIoBaseUpload(io.BytesIO(data), mimetype=DOCX_TYPE, resumable=False)


def _gone(exc: Exception) -> bool:
    status = getattr(getattr(exc, "resp", None), "status", None)
    return status in (403, 404)


def parse_time(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def create_copy(access_token: str, name: str, data: bytes, parent_folder_id: str | None) -> dict:
    """Upload a .docx as a new Google Doc. Returns id, webViewLink, modifiedTime."""
    from googleapiclient.errors import HttpError  # type: ignore[import]

    drive = _drive(access_token)
    body: dict[str, Any] = {"name": name[:255], "mimeType": GOOGLE_DOC_TYPE}
    fields = "id,webViewLink,modifiedTime"
    if parent_folder_id:
        try:
            return drive.files().create(
                body={**body, "parents": [parent_folder_id]}, media_body=_media(data), fields=fields,
            ).execute()
        except HttpError as exc:
            if not _gone(exc):
                raise
            # A linked folder the app didn't create is out of reach for drive.file.
    return drive.files().create(body=body, media_body=_media(data), fields=fields).execute()


def replace_contents(access_token: str, file_id: str, data: bytes) -> str:
    """Replace the Google Doc's contents with a .docx. Returns the new modifiedTime."""
    from googleapiclient.errors import HttpError  # type: ignore[import]

    try:
        res = _drive(access_token).files().update(
            fileId=file_id, media_body=_media(data), fields="modifiedTime",
        ).execute()
    except HttpError as exc:
        if _gone(exc):
            raise GoogleFileGone() from exc
        raise
    return res["modifiedTime"]


def remote_state(access_token: str, file_id: str) -> dict:
    """modifiedTime and who last edited the Google Doc."""
    from googleapiclient.errors import HttpError  # type: ignore[import]

    try:
        meta = _drive(access_token).files().get(
            fileId=file_id, fields="modifiedTime,trashed,lastModifyingUser(displayName,emailAddress)",
        ).execute()
    except HttpError as exc:
        if _gone(exc):
            raise GoogleFileGone() from exc
        raise
    if meta.get("trashed"):
        raise GoogleFileGone()
    user = meta.get("lastModifyingUser") or {}
    return {
        "modified_at": parse_time(meta.get("modifiedTime")),
        "modified_by": user.get("displayName") or user.get("emailAddress"),
    }


def export_docx(access_token: str, file_id: str) -> bytes:
    """The Google Doc as a .docx (Drive caps exports at 10 MB)."""
    from googleapiclient.errors import HttpError  # type: ignore[import]
    from googleapiclient.http import MediaIoBaseDownload  # type: ignore[import]

    buf = io.BytesIO()
    try:
        request = _drive(access_token).files().export_media(fileId=file_id, mimeType=DOCX_TYPE)
        downloader = MediaIoBaseDownload(buf, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
    except HttpError as exc:
        if _gone(exc):
            raise GoogleFileGone() from exc
        raise
    return buf.getvalue()


def share(access_token: str, file_id: str, email: str, role: str) -> None:
    """Give one person access (role: writer | commenter | reader), without
    Google's notification email. Raises if Google refuses (e.g. the address
    has no Google account)."""
    _drive(access_token).permissions().create(
        fileId=file_id,
        body={"type": "user", "role": role, "emailAddress": email},
        sendNotificationEmail=False,
        fields="id",
    ).execute()


def account_email(access_token: str) -> str | None:
    """The Google account's email address (the OAuth grant includes `email`)."""
    try:
        res = httpx.get(
            "https://openidconnect.googleapis.com/v1/userinfo",
            headers={"Authorization": f"Bearer {access_token}"}, timeout=10,
        )
        res.raise_for_status()
        return res.json().get("email")
    except Exception:
        return None

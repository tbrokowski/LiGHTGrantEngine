"""Google Drive integration — auto-folder creation for grant workspaces.

Uses the connected user's OAuth access token so folders are created in the
user's own Google Drive.  Call google_auth.get_valid_google_token() before
invoking these functions to ensure the token is not expired.

Requires: google-api-python-client, google-auth  (see requirements.txt)
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

SUBFOLDER_NAMES = [
    "Budget",
    "Sections",
    "Partner Materials",
    "Final Submission",
    "Call Documents",
    "Correspondence",
]

_FOLDER_MIME = "application/vnd.google-apps.folder"
_DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"]


def _build_service(access_token: str) -> Any:
    from google.oauth2.credentials import Credentials  # type: ignore[import]
    from googleapiclient.discovery import build  # type: ignore[import]

    creds = Credentials(token=access_token)
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def _create_folder(service: Any, name: str, parent_id: str | None) -> str:
    body: dict[str, Any] = {"name": name[:255], "mimeType": _FOLDER_MIME}
    if parent_id:
        body["parents"] = [parent_id]
    result = service.files().create(body=body, fields="id").execute()
    return result["id"]


def create_grant_folder_tree(
    grant_title: str,
    access_token: str,
    parent_folder_id: str | None = None,
) -> dict[str, str]:
    """Create a structured grant folder in the user's Google Drive.

    Folder layout::

        /[Grant Title]/
            Budget/
            Sections/
            Partner Materials/
            Final Submission/
            Call Documents/
            Correspondence/

    Args:
        grant_title: Name for the root folder.
        access_token: Valid Google OAuth access token for the user.
        parent_folder_id: Optional Drive folder ID to create inside. If None,
            the folder is created in the user's Drive root.

    Returns:
        dict with ``root_folder_id`` and ``root_folder_url``.
    """
    service = _build_service(access_token)
    root_id = _create_folder(service, grant_title, parent_folder_id)

    for subfolder in SUBFOLDER_NAMES:
        _create_folder(service, subfolder, root_id)

    root_url = f"https://drive.google.com/drive/folders/{root_id}"
    logger.info("Created Drive folder tree for '%s': %s", grant_title, root_url)
    return {"root_folder_id": root_id, "root_folder_url": root_url}

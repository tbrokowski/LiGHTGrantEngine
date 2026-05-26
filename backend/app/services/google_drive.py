"""Google Drive integration — auto-folder creation for grant workspaces.

Uses a service-account JSON key (set google_drive.service_account_file in
config.yaml) so no user OAuth flow is required.  Share the parent folder
with the service account's email address before use.

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


def _build_service(service_account_file: str) -> Any:
    from google.oauth2 import service_account  # type: ignore[import]
    from googleapiclient.discovery import build  # type: ignore[import]

    creds = service_account.Credentials.from_service_account_file(
        service_account_file,
        scopes=["https://www.googleapis.com/auth/drive"],
    )
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def _create_folder(service: Any, name: str, parent_id: str) -> str:
    body = {"name": name[:255], "mimeType": _FOLDER_MIME, "parents": [parent_id]}
    result = service.files().create(body=body, fields="id").execute()
    return result["id"]


def create_grant_folder_tree(
    grant_title: str,
    service_account_file: str,
    parent_folder_id: str,
) -> dict[str, str]:
    """Create a structured grant folder in Google Drive.

    Folder layout::

        /[Grant Title]/
            Budget/
            Sections/
            Partner Materials/
            Final Submission/
            Call Documents/
            Correspondence/

    Returns:
        dict with ``root_folder_id`` and ``root_folder_url``.
    """
    service = _build_service(service_account_file)
    root_id = _create_folder(service, grant_title, parent_folder_id)

    for subfolder in SUBFOLDER_NAMES:
        _create_folder(service, subfolder, root_id)

    root_url = f"https://drive.google.com/drive/folders/{root_id}"
    logger.info("Created Drive folder tree for '%s': %s", grant_title, root_url)
    return {"root_folder_id": root_id, "root_folder_url": root_url}

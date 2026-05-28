"""
Google Drive Comments API integration.

Uses Drive v3 Comments API to list, create, and resolve comments on a Google Doc.
The caller must supply a valid access token (use _get_user_google_token from the router).
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def _build_drive_service(access_token: str) -> Any:
    from google.oauth2.credentials import Credentials  # type: ignore[import]
    from googleapiclient.discovery import build  # type: ignore[import]

    creds = Credentials(token=access_token)
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def list_doc_comments(doc_id: str, access_token: str) -> list[dict]:
    """
    Return all unresolved (and recently resolved) comments on the given Google Doc.
    Each comment is a dict with: id, content, anchor, resolved, created_time,
    modified_time, author (displayName, emailAddress), replies.
    """
    svc = _build_drive_service(access_token)
    results = []
    page_token = None
    while True:
        params: dict[str, Any] = {
            "fileId": doc_id,
            "fields": (
                "comments(id,content,anchor,resolved,createdTime,modifiedTime,"
                "author(displayName,emailAddress),replies(id,content,author(displayName,emailAddress),"
                "createdTime,deleted)),"
                "nextPageToken"
            ),
            "includeDeleted": False,
            "pageSize": 100,
        }
        if page_token:
            params["pageToken"] = page_token

        resp = svc.comments().list(**params).execute()
        results.extend(resp.get("comments", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break

    return results


def create_doc_comment(doc_id: str, content: str, anchor_text: str | None, access_token: str) -> dict:
    """
    Create a new comment on a Google Doc.
    anchor_text is the quoted text the comment is attached to (optional).
    Returns the created comment dict.
    """
    svc = _build_drive_service(access_token)
    body: dict[str, Any] = {"content": content}
    if anchor_text:
        # Drive API anchor format for document text selection
        body["anchor"] = anchor_text

    return svc.comments().create(
        fileId=doc_id,
        fields="id,content,anchor,resolved,createdTime,author(displayName,emailAddress)",
        body=body,
    ).execute()


def reply_to_doc_comment(doc_id: str, comment_id: str, content: str, access_token: str) -> dict:
    """Add a reply to an existing Google Doc comment."""
    svc = _build_drive_service(access_token)
    return svc.replies().create(
        fileId=doc_id,
        commentId=comment_id,
        fields="id,content,createdTime,author(displayName,emailAddress)",
        body={"content": content},
    ).execute()


def resolve_doc_comment(doc_id: str, comment_id: str, access_token: str) -> dict:
    """Mark a Google Doc comment as resolved."""
    svc = _build_drive_service(access_token)
    return svc.comments().update(
        fileId=doc_id,
        commentId=comment_id,
        fields="id,resolved",
        body={"resolved": True},
    ).execute()

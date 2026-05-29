"""
Cloudflare R2 object storage service (S3-compatible).

All file uploads in the application go through this module instead of
writing to local disk. Files are stored in R2 and served via time-limited
presigned URLs so the bucket stays private.

Key layout in the bucket:
  grants/{grant_id}/{filename}
  opportunities/{opportunity_id}/{filename}
  archive/{archive_id}/{filename}
  general/{filename}
"""
from __future__ import annotations

import io
from functools import lru_cache
from typing import Optional

import boto3
from botocore.exceptions import ClientError

from app.config import get_settings


@lru_cache(maxsize=1)
def _get_client():
    s = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=f"https://{s.r2_account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=s.r2_access_key_id,
        aws_secret_access_key=s.r2_secret_access_key,
        region_name="auto",
    )


def _client():
    """Return cached S3 client, or raise clearly if R2 is not configured."""
    s = get_settings()
    if not s.r2_account_id or not s.r2_access_key_id or not s.r2_secret_access_key:
        raise RuntimeError(
            "R2 storage is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, "
            "and R2_SECRET_ACCESS_KEY in your environment."
        )
    return _get_client()


def resolve_storage_key(notes: str | None) -> str | None:
    """Return R2 object key from doc.notes (plain key or JSON metadata)."""
    if not notes:
        return None
    if notes.startswith("{"):
        try:
            import json
            meta = json.loads(notes)
            return meta.get("r2_key")
        except (json.JSONDecodeError, TypeError):
            return None
    return notes


def upload_file(
    key: str,
    data: bytes,
    content_type: str = "application/octet-stream",
) -> str:
    """Upload bytes to R2 and return the storage key.

    The key is stored in Document.notes so it can be used later to generate
    presigned URLs. Example key: 'grants/abc-123/call_document.pdf'
    """
    s = get_settings()
    _client().put_object(
        Bucket=s.r2_bucket_name,
        Key=key,
        Body=data,
        ContentType=content_type,
    )
    return key


def get_presigned_url(key: str, expires_in: int = 3600, filename: str | None = None) -> str:
    """Generate a time-limited presigned GET URL for a stored object.

    Default expiry is 1 hour. Use shorter values for sensitive archive docs.
    Setting filename forces ResponseContentDisposition to inline so browsers
    render the file in-place instead of triggering a download.
    """
    s = get_settings()
    disposition = f'inline; filename="{filename}"' if filename else "inline"
    params: dict = {
        "Bucket": s.r2_bucket_name,
        "Key": key,
        "ResponseContentDisposition": disposition,
    }
    return _client().generate_presigned_url(
        "get_object",
        Params=params,
        ExpiresIn=expires_in,
    )


def download_file(key: str) -> bytes:
    """Download file bytes from R2. Used by Celery workers for parsing."""
    s = get_settings()
    try:
        response = _client().get_object(Bucket=s.r2_bucket_name, Key=key)
        return response["Body"].read()
    except ClientError as e:
        if e.response["Error"]["Code"] == "NoSuchKey":
            raise FileNotFoundError(f"R2 object not found: {key}") from e
        raise


def delete_file(key: str) -> None:
    """Delete a file from R2. Called when a Document record is deleted."""
    s = get_settings()
    try:
        _client().delete_object(Bucket=s.r2_bucket_name, Key=key)
    except ClientError:
        pass  # Treat missing objects as already deleted


def object_exists(key: str) -> bool:
    """Check whether an object exists in R2 without downloading it."""
    s = get_settings()
    try:
        _client().head_object(Bucket=s.r2_bucket_name, Key=key)
        return True
    except ClientError:
        return False


def build_key(
    filename: str,
    grant_id: Optional[str] = None,
    opportunity_id: Optional[str] = None,
    archive_id: Optional[str] = None,
    doc_id: Optional[str] = None,
) -> str:
    """Build a consistent R2 object key from entity context.

    Format: {prefix}/{entity_id}/{doc_id}/{filename}
    Using doc_id as a subfolder prevents filename collisions across uploads.
    """
    if grant_id:
        prefix = f"grants/{grant_id}"
    elif opportunity_id:
        prefix = f"opportunities/{opportunity_id}"
    elif archive_id:
        prefix = f"archive/{archive_id}"
    else:
        prefix = "general"

    if doc_id:
        return f"{prefix}/{doc_id}/{filename}"
    return f"{prefix}/{filename}"

"""Grant editor comments — CRUD + Google Docs two-way sync."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.active_grant import ActiveGrant
from app.models.comment import Comment
from app.models.user import User
from app.routers.auth import get_current_user

router = APIRouter()


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class CommentOut(BaseModel):
    id: str
    entity_type: str
    entity_id: str
    author_id: str
    text: str
    anchor_text: Optional[str] = None
    parent_id: Optional[str] = None
    resolved: bool
    google_doc_comment_id: Optional[str] = None
    document_id: str = "draft"
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CommentCreate(BaseModel):
    text: str
    anchor_text: Optional[str] = None
    parent_id: Optional[str] = None
    document_id: str = "draft"


class CommentUpdate(BaseModel):
    text: Optional[str] = None
    resolved: Optional[bool] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_grant(grant_id: str, db: AsyncSession) -> ActiveGrant:
    result = await db.execute(select(ActiveGrant).where(ActiveGrant.id == grant_id))
    grant = result.scalar_one_or_none()
    if grant := result.scalar_one_or_none():
        return grant
    raise HTTPException(404, "Grant not found")


async def _get_user_google_token(user: User, db: AsyncSession) -> str:
    """Return a valid Google OAuth token for the user, or raise 403."""
    from app.services.google_auth import get_valid_google_token

    if not user.google_access_token or not user.google_refresh_token:
        raise HTTPException(403, "Google account not connected")
    try:
        return await get_valid_google_token(user, db)
    except Exception as exc:
        raise HTTPException(403, f"Google token error: {exc}") from exc


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/{grant_id}/comments", response_model=list[CommentOut])
async def list_comments(
    grant_id: str,
    document_id: str = Query(default="draft"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List grant-editor comments for a specific document within a grant."""
    result = await db.execute(
        select(Comment)
        .where(
            Comment.entity_type == "grant",
            Comment.entity_id == grant_id,
            Comment.document_id == document_id,
        )
        .order_by(Comment.created_at)
    )
    return result.scalars().all()


@router.post("/{grant_id}/comments", response_model=CommentOut)
async def create_comment(
    grant_id: str,
    body: CommentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new comment (optionally anchored to selected text)."""
    grant = await _get_grant(grant_id, db)

    comment = Comment(
        id=str(uuid.uuid4()),
        entity_type="grant",
        entity_id=grant_id,
        author_id=current_user.id,
        text=body.text,
        anchor_text=body.anchor_text,
        parent_id=body.parent_id,
        resolved=False,
        document_id=body.document_id,
    )

    # Optionally mirror to Google Doc if one is linked and this is the draft document
    if grant.google_doc_id and body.document_id == "draft":
        try:
            access_token = await _get_user_google_token(current_user, db)
            from app.services.google_comments import create_doc_comment
            doc_comment = create_doc_comment(
                doc_id=grant.google_doc_id,
                content=body.text,
                anchor_text=body.anchor_text,
                access_token=access_token,
            )
            comment.google_doc_comment_id = doc_comment.get("id")
        except Exception:
            import logging
            logging.getLogger(__name__).warning(
                "Could not mirror comment to Google Doc (grant=%s)", grant_id, exc_info=True
            )

    db.add(comment)
    await db.commit()
    await db.refresh(comment)
    return comment


@router.patch("/{grant_id}/comments/{comment_id}", response_model=CommentOut)
async def update_comment(
    grant_id: str,
    comment_id: str,
    body: CommentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Edit or resolve a comment."""
    result = await db.execute(select(Comment).where(Comment.id == comment_id))
    comment = result.scalar_one_or_none()
    if not comment or comment.entity_id != grant_id:
        raise HTTPException(404, "Comment not found")

    if body.text is not None:
        comment.text = body.text
    if body.resolved is not None:
        comment.resolved = body.resolved

    # Mirror resolve to Google Doc
    if body.resolved and comment.google_doc_comment_id:
        import contextlib
        grant = await _get_grant(grant_id, db)
        if grant.google_doc_id:
            with contextlib.suppress(Exception):
                access_token = await _get_user_google_token(current_user, db)
                from app.services.google_comments import resolve_doc_comment
                resolve_doc_comment(
                    doc_id=grant.google_doc_id,
                    comment_id=comment.google_doc_comment_id,
                    access_token=access_token,
                )

    await db.commit()
    await db.refresh(comment)
    return comment


@router.delete("/{grant_id}/comments/{comment_id}")
async def delete_comment(
    grant_id: str,
    comment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a comment."""
    result = await db.execute(select(Comment).where(Comment.id == comment_id))
    comment = result.scalar_one_or_none()
    if not comment or comment.entity_id != grant_id:
        raise HTTPException(404, "Comment not found")
    await db.delete(comment)
    await db.commit()
    return {"ok": True}


class SyncResult(BaseModel):
    comments: list[CommentOut]
    sync_error: Optional[str] = None
    drive_scope_error: bool = False


@router.post("/{grant_id}/comments/sync", response_model=SyncResult)
async def sync_comments(
    grant_id: str,
    document_id: str = Query(default="draft"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Pull comments from the linked Google Doc, upsert locally, and return the
    merged list for the given document.  Only the "draft" document syncs with
    Google Docs; other documents return local comments only.
    """
    import logging
    log = logging.getLogger(__name__)

    grant = await _get_grant(grant_id, db)

    base_filter = (
        Comment.entity_type == "grant",
        Comment.entity_id == grant_id,
        Comment.document_id == document_id,
    )

    async def _local_comments() -> list[Comment]:
        res = await db.execute(select(Comment).where(*base_filter).order_by(Comment.created_at))
        return list(res.scalars().all())

    if not grant.google_doc_id or document_id != "draft":
        return SyncResult(comments=await _local_comments())

    try:
        access_token = await _get_user_google_token(current_user, db)
        from app.services.google_comments import list_doc_comments
        remote_comments = list_doc_comments(grant.google_doc_id, access_token)
    except HTTPException as exc:
        # Token/scope error — surface it to the frontend
        log.warning("Google token error syncing comments (grant=%s): %s", grant_id, exc.detail)
        is_scope = "scope" in str(exc.detail).lower() or "permission" in str(exc.detail).lower()
        return SyncResult(
            comments=await _local_comments(),
            sync_error=str(exc.detail),
            drive_scope_error=is_scope,
        )
    except Exception as exc:
        log.warning("Failed to sync Google Doc comments (grant=%s): %s", grant_id, exc, exc_info=True)
        err = str(exc)
        is_scope = any(k in err.lower() for k in ("403", "permission", "scope", "forbidden", "insufficient"))
        return SyncResult(
            comments=await _local_comments(),
            sync_error=err,
            drive_scope_error=is_scope,
        )

    for rc in remote_comments:
        gdoc_id = rc.get("id")
        if not gdoc_id:
            continue

        existing = await db.execute(
            select(Comment).where(Comment.google_doc_comment_id == gdoc_id)
        )

        if local := existing.scalar_one_or_none():
            if rc.get("resolved") and not local.resolved:
                local.resolved = True
        else:
            author_name = (rc.get("author") or {}).get("displayName", "Google Doc")
            new_comment = Comment(
                id=str(uuid.uuid4()),
                entity_type="grant",
                entity_id=grant_id,
                author_id=current_user.id,
                text=f"[{author_name}]: {rc.get('content', '')}",
                anchor_text=rc.get("anchor"),
                resolved=rc.get("resolved", False),
                google_doc_comment_id=gdoc_id,
                document_id="draft",
            )
            db.add(new_comment)

    await db.commit()

    return SyncResult(comments=await _local_comments())

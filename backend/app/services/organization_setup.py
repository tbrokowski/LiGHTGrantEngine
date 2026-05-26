"""Helpers for creating organizations and assigning membership roles."""
from __future__ import annotations

from typing import Optional

from app.models.user import UserRole


def personal_workspace_name(display_name: str) -> str:
    trimmed = display_name.strip()
    suffix = "'s Workspace"
    if trimmed.lower().endswith(suffix.lower()):
        return trimmed
    return f"{trimmed}{suffix}"


def invited_member_role(role: Optional[str]) -> str:
    """Map an invite token role to a non-admin org membership role."""
    allowed = {UserRole.VIEWER, UserRole.CONTRIBUTOR, UserRole.REVIEWER}
    if role in allowed:
        return role
    return UserRole.CONTRIBUTOR


def queue_org_scaffold(institution_id: str, admin_user_id: str) -> None:
    try:
        from app.workers.celery_app import celery_app

        celery_app.send_task(
            "app.workers.org_tasks.scaffold_new_organization",
            args=[institution_id, admin_user_id],
        )
    except Exception:
        pass

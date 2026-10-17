"""Emails + account linking for sharing things with people by address.

Two kinds of share go out by email: a guest invite to a grant (GrantMember)
and an archived grant shared with someone (ArchiveShare). Recipients who
don't have an account yet get a sign-up link; when they register, every
pending invite addressed to their email is linked to the new account.
"""
from html import escape
from urllib.parse import urlencode

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.services.email import send_email


def app_url() -> str:
    return (get_settings().base_url or "http://localhost:3000").rstrip("/")


def _signup_url(email: str, next_path: str) -> str:
    return f"{app_url()}/register?" + urlencode({"email": email, "invite": "1", "next": next_path})


def _login_url(next_path: str) -> str:
    return f"{app_url()}/login?" + urlencode({"next": next_path})


def _shell(body: str) -> str:
    return f"""
    <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#1a1a1a;max-width:520px">
      {body}
      <p style="color:#888;font-size:12px;margin-top:28px">LiGHT Grant Engine</p>
    </div>
    """


def _button(url: str, label: str) -> str:
    return (
        f'<p style="margin:22px 0"><a href="{escape(url)}" '
        'style="background:#1a1a1a;color:#fff;text-decoration:none;padding:10px 18px;'
        f'border-radius:6px;display:inline-block">{escape(label)}</a></p>'
        f'<p style="color:#888;font-size:12px">Or paste this link: {escape(url)}</p>'
    )


async def send_grant_invite_email(
    *, to: str, inviter_name: str, grant_title: str, grant_id: str, has_account: bool,
) -> None:
    next_path = f"/grants/{grant_id}"
    who, title = escape(inviter_name or "A colleague"), escape(grant_title)
    if has_account:
        url, label = _login_url(next_path), "Open the grant"
        steps = "Sign in and you'll find it on your Grants page under <strong>External</strong>."
    else:
        url, label = _signup_url(to, next_path), "Create your account"
        steps = (
            "Create a free account with this email address (you can set up your own "
            "organization while signing up). The grant will then appear on your Grants "
            "page under <strong>External</strong>."
        )
    await send_email(
        to=to,
        subject=f"{inviter_name or 'A colleague'} invited you to collaborate on “{grant_title}”",
        html=_shell(
            f"<p>{who} invited you to collaborate on the grant <strong>{title}</strong> "
            f"on LiGHT Grant Engine.</p><p>{steps}</p>{_button(url, label)}"
        ),
        text=f"{inviter_name} invited you to collaborate on {grant_title}. {url}",
    )


async def send_archive_share_email(
    *, to: str, sharer_name: str, archive_title: str, archive_id: str,
    has_account: bool, note: str | None = None,
) -> None:
    next_path = f"/archive/{archive_id}"
    who, title = escape(sharer_name or "A colleague"), escape(archive_title)
    if has_account:
        url, label = _login_url(next_path), "View the grant"
    else:
        url, label = _signup_url(to, next_path), "Create your account to view it"
    note_html = (
        f'<blockquote style="border-left:3px solid #ddd;margin:14px 0;padding:4px 12px;color:#444">'
        f"{escape(note)}</blockquote>" if note else ""
    )
    await send_email(
        to=to,
        subject=f"{sharer_name or 'A colleague'} shared “{archive_title}” with you",
        html=_shell(
            f"<p>{who} shared the archived grant <strong>{title}</strong> with you "
            f"on LiGHT Grant Engine.</p>{note_html}{_button(url, label)}"
        ),
        text=f"{sharer_name} shared {archive_title} with you. {url}",
    )


async def link_pending_invites(db: AsyncSession, user) -> None:
    """Attach invites sent to this email before the account existed."""
    from app.models.archive_share import ArchiveShare
    from app.models.grant_member import GrantMember, GrantMemberStatus

    email = (user.email or "").strip().lower()
    if not email:
        return
    for gm in (await db.execute(
        select(GrantMember).where(func.lower(GrantMember.email) == email, GrantMember.user_id.is_(None))
    )).scalars().all():
        gm.user_id = user.id
        gm.status = GrantMemberStatus.ACCEPTED
    for share in (await db.execute(
        select(ArchiveShare).where(func.lower(ArchiveShare.email) == email, ArchiveShare.user_id.is_(None))
    )).scalars().all():
        share.user_id = user.id

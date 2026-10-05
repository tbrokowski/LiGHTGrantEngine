"""Deleting your own account: a soft delete that scrubs personal data.

The `users` row stays (about 55 foreign keys point at it — grant comments,
activity, ledgers), so shared org history still reads sensibly as "Deleted
user". Everything that identifies the person is cleared, and the email is
replaced so the same address can sign up again as a brand-new account.
"""
from __future__ import annotations

from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.email_verification import EmailVerification
from app.models.feedback import Feedback
from app.models.grant_member import GrantMember
from app.models.institution_membership import InstitutionMembership
from app.models.org_join_request import OrgJoinRequest, JoinRequestStatus
from app.models.password_reset import PasswordResetToken
from app.models.user import User, InstitutionRole
from app.models.user_api_key import UserApiKey
from app.services.membership import list_memberships, member_count

DELETED_NAME = "Deleted user"


def deleted_email(user_id: str) -> str:
    return f"deleted+{user_id}@deleted.invalid"


def scrub_user_fields(user: User) -> None:
    """Clear everything on the user row that identifies or authenticates them."""
    user.name = DELETED_NAME
    user.email = deleted_email(user.id)
    user.hashed_password = None
    user.is_active = False
    user.token_version = (user.token_version or 0) + 1
    user.team = None
    user.notification_preferences = {}
    user.grant_preferences = {}
    user.email_verified = False
    user.email_verification_token = None
    user.google_access_token = None
    user.google_refresh_token = None
    user.google_token_expiry = None
    user.institution_id = None
    user.institution_role = InstitutionRole.MEMBER
    user.module_permissions = {}


async def delete_account(db: AsyncSession, user: User) -> None:
    """Soft-delete `user`. The caller has already checked they aren't the last
    admin of an org with other members, and commits afterwards."""
    # Personal workspaces nobody else uses: drop the name and profile.
    for m, inst in await list_memberships(db, user):
        if inst.is_personal and await member_count(db, inst.id) <= 1:
            inst.name = "Deleted workspace"
            inst.grant_profile = {}
            inst.access_code = None
            inst.access_code_expires_at = None

    await db.execute(delete(InstitutionMembership).where(InstitutionMembership.user_id == user.id))
    await db.execute(delete(UserApiKey).where(UserApiKey.user_id == user.id))
    await db.execute(delete(PasswordResetToken).where(PasswordResetToken.user_id == user.id))
    await db.execute(delete(EmailVerification).where(EmailVerification.user_id == user.id))
    await db.execute(delete(OrgJoinRequest).where(
        OrgJoinRequest.user_id == user.id, OrgJoinRequest.status == JoinRequestStatus.PENDING
    ))
    await db.execute(
        update(OrgJoinRequest).where(OrgJoinRequest.user_id == user.id)
        .values(email=deleted_email(user.id), name=DELETED_NAME)
    )
    await db.execute(
        update(GrantMember).where(GrantMember.user_id == user.id).values(email=deleted_email(user.id))
    )
    await db.execute(
        update(Feedback).where(Feedback.user_id == user.id)
        .values(user_email=None, user_name=DELETED_NAME)
    )

    scrub_user_fields(user)
    await db.flush()

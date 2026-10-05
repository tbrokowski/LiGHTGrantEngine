"""Unit tests for org memberships, access-code roles and account scrubbing."""
import pytest
from fastapi import HTTPException

from app.models.institution_membership import InstitutionMembership
from app.models.user import User
from app.routers.auth import validate_new_password
from app.services.account_deletion import DELETED_NAME, deleted_email, scrub_user_fields
from app.services.membership import activate, is_admin_membership, mirror_if_active
from app.services.organization_setup import invited_member_role


def _user(**kw) -> User:
    base = dict(id="u1", name="Ada", email="ada@example.org", role="grant_lead",
                institution_id="org-a", institution_role="admin", module_permissions={}, token_version=0)
    return User(**{**base, **kw})


def _membership(**kw) -> InstitutionMembership:
    base = dict(user_id="u1", institution_id="org-b", institution_role="member", role="viewer",
                module_permissions={"can_view_grants": True})
    return InstitutionMembership(**{**base, **kw})


def test_activate_copies_membership_onto_user():
    user = _user()
    activate(user, _membership())
    assert user.institution_id == "org-b"
    assert user.institution_role == "member"
    assert user.role == "viewer"
    assert user.module_permissions == {"can_view_grants": True}


def test_mirror_only_touches_the_active_org():
    user = _user()
    mirror_if_active(user, _membership(institution_id="org-b"))
    assert (user.institution_id, user.role) == ("org-a", "grant_lead")
    mirror_if_active(user, _membership(institution_id="org-a", role="reviewer"))
    assert user.role == "reviewer"


def test_admin_membership():
    assert is_admin_membership(_membership(institution_role="admin"))
    assert is_admin_membership(_membership(role="admin"))
    assert not is_admin_membership(_membership())


def test_access_code_role_never_grants_admin():
    assert invited_member_role("viewer") == "viewer"
    assert invited_member_role("grant_lead") == "grant_lead"
    assert invited_member_role("admin") == "contributor"
    assert invited_member_role(None) == "contributor"


def test_password_minimum():
    validate_new_password("long enough")
    with pytest.raises(HTTPException):
        validate_new_password("short")


def test_scrub_frees_the_email_and_ends_sessions():
    user = _user(hashed_password="x", google_refresh_token="t", team="Lab", grant_preferences={"k": 1})
    scrub_user_fields(user)
    assert user.email == deleted_email("u1") != "ada@example.org"
    assert user.name == DELETED_NAME
    assert user.hashed_password is None
    assert user.google_refresh_token is None
    assert user.is_active is False
    assert user.token_version == 1
    assert user.institution_id is None
    assert user.grant_preferences == {} and user.team is None

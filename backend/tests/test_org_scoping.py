"""Archive entries and partners are visible only to their own organization,
plus archive entries shared with the viewer."""
import asyncio

import pytest
from fastapi import HTTPException
from sqlalchemy.dialects import postgresql

from app.models.archive import GrantArchive
from app.models.user import User
from app.routers.archive import _get_archive_for, _in_active_org
from app.routers.partners import partner_org_filter


def _user(**kw) -> User:
    base = dict(id="u1", name="Ada", email="ada@example.org", role="viewer",
                institution_id="org-a", institution_role="member",
                module_permissions={"can_view_archive": True})
    return User(**{**base, **kw})


def _sql(clause) -> str:
    return str(clause.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


class _Result:
    def __init__(self, rows):
        self.rows = rows

    def scalar_one_or_none(self):
        return self.rows[0] if self.rows else None

    def scalars(self):
        return self

    def all(self):
        return self.rows


class _FakeDb:
    """Answers the two queries _get_archive_for makes: the entry, then the
    viewer's shared archive ids."""

    def __init__(self, archive, shared_ids=()):
        self.answers = [[archive] if archive else [], list(shared_ids)]

    async def execute(self, _stmt):
        return _Result(self.answers.pop(0))


def _fetch(archive, user, shared_ids=(), **kw):
    return asyncio.run(_get_archive_for(_FakeDb(archive, shared_ids), "a1", user, **kw))


def test_filters_match_active_org_only():
    assert "institution_id = 'org-a'" in _sql(_in_active_org(_user()))
    assert "institution_id = 'org-a'" in _sql(partner_org_filter(_user()))


def test_no_active_org_matches_nothing():
    # Must not become "institution_id IS NULL", which would expose unowned rows.
    assert _sql(_in_active_org(_user(institution_id=None))) == "false"
    assert _sql(partner_org_filter(_user(institution_id=None))) == "false"


def test_own_org_entry_is_visible():
    entry = GrantArchive(id="a1", title="T", institution_id="org-a")
    assert _fetch(entry, _user(), allow_shared=True) is entry
    assert _fetch(entry, _user()) is entry


def test_other_org_entry_is_hidden():
    entry = GrantArchive(id="a1", title="T", institution_id="org-b")
    with pytest.raises(HTTPException) as e:
        _fetch(entry, _user(), allow_shared=True)
    assert e.value.status_code == 404


def test_shared_entry_from_other_org_is_viewable_but_not_editable():
    entry = GrantArchive(id="a1", title="T", institution_id="org-b")
    assert _fetch(entry, _user(), shared_ids=["a1"], allow_shared=True) is entry
    with pytest.raises(HTTPException):
        _fetch(entry, _user(), shared_ids=["a1"])


def test_own_org_entry_needs_archive_permission_to_view():
    entry = GrantArchive(id="a1", title="T", institution_id="org-a")
    no_perm = _user(module_permissions={"can_view_archive": False})
    with pytest.raises(HTTPException):
        _fetch(entry, no_perm, allow_shared=True)
    assert _fetch(entry, no_perm, shared_ids=["a1"], allow_shared=True) is entry


# ── AI retrieval and document downloads ──────────────────────────────────────

from types import SimpleNamespace

from app.models.document import Document
from app.services import tenancy


class _CapturingDb:
    def __init__(self, rows=()):
        self.statements = []
        self.rows = list(rows)

    async def execute(self, stmt):
        self.statements.append(stmt)
        return _Rows(self.rows)


class _Rows(list):
    def all(self):
        return list(self)

    def scalars(self):
        return self

    def scalar_one_or_none(self):
        return self[0] if self else None

    def first(self):
        return self[0] if self else None

    def __iter__(self):
        return iter(list.__iter__(self))


def test_tenancy_filters_fail_closed_when_unset():
    assert tenancy.get_active_org() is None
    assert _sql(tenancy.section_org_filter()) == "false"
    assert _sql(tenancy.archive_org_filter()) == "false"
    assert _sql(tenancy.language_block_org_filter()) == "false"


def test_tenancy_filters_follow_active_org():
    with tenancy.active_org("org-a"):
        assert "'org-a'" in _sql(tenancy.section_org_filter())
        assert "grant_archives.institution_id = 'org-a'" in _sql(tenancy.archive_org_filter())
        assert "'org-a'" in _sql(tenancy.language_block_org_filter())
    assert tenancy.get_active_org() is None


def test_task_org_from_explicit_argument():
    task = SimpleNamespace(run=lambda institution_id=None: None)
    assert tenancy._task_org(task, (), {"institution_id": "org-a"}) == "org-a"
    assert tenancy._task_org(task, (), {}) is None


def test_retriever_queries_are_org_scoped():
    from app.ai.rag import retriever

    db = _CapturingDb()
    with tenancy.active_org("org-a"):
        asyncio.run(retriever._vector_candidates(db, [0.0, 1.0], [], 5))
        asyncio.run(retriever._keyword_fallback("health systems", db, [], 5))
        asyncio.run(retriever.retrieve_document_structure(db))
        asyncio.run(retriever.retrieve_archive_style_fingerprints(db))
    for stmt in db.statements:
        assert "'org-a'" in _sql(stmt)


def test_admin_of_another_org_cannot_open_grant_files(monkeypatch):
    from app.routers import documents

    async def no_membership(*_a, **_k):
        return []
    monkeypatch.setattr(documents, "get_user_grant_ids", no_membership)
    admin = _user(institution_role="admin")
    other_org_grant = _CapturingDb(rows=["org-b"])
    assert not asyncio.run(documents._grant_accessible("g1", other_org_grant, admin, None))
    own_org_grant = _CapturingDb(rows=["org-a"])
    assert asyncio.run(documents._grant_accessible("g1", own_org_grant, admin, None))


def test_archive_file_follows_archive_visibility(monkeypatch):
    from app.routers import documents

    doc = Document(id="d1", file_name="p.pdf", archive_id="a1", grant_id="g-other-org")
    visible = {"a1": False}

    async def archive_visible(archive_id, *_a):
        return visible[archive_id]

    async def no_grant(*_a):
        return False
    monkeypatch.setattr(documents, "_archive_visible", archive_visible)
    monkeypatch.setattr(documents, "_grant_accessible", no_grant)

    # Shared with them: the file opens even though it was copied from a grant.
    visible["a1"] = True
    assert asyncio.run(documents._get_document_for_user("d1", _CapturingDb([doc]), _user(), None)) is doc
    # Not visible: refused.
    visible["a1"] = False
    with pytest.raises(HTTPException):
        asyncio.run(documents._get_document_for_user("d1", _CapturingDb([doc]), _user(), None))


def test_unattached_upload_from_another_org_is_hidden(monkeypatch):
    from app.routers import documents

    doc = Document(id="d1", file_name="x.pdf", uploaded_by_id="someone-else")
    with pytest.raises(HTTPException) as e:
        # Membership lookup finds nothing for the uploader in org-a.
        asyncio.run(documents._get_document_for_user("d1", _SeqDb([[doc], []]), _user(), None))
    assert e.value.status_code == 404


class _SeqDb:
    def __init__(self, answers):
        self.answers = list(answers)

    async def execute(self, _stmt):
        return _Rows(self.answers.pop(0))


# ── Admin bypasses only cover the admin's own organization ───────────────────

from app.auth.permissions import _check_grant_access, is_admin_of
from app.models.active_grant import ActiveGrant


def test_is_admin_of_requires_matching_org():
    admin = _user(institution_role="admin")
    assert is_admin_of(admin, "org-a")
    assert not is_admin_of(admin, "org-b")
    assert not is_admin_of(admin, None)
    assert not is_admin_of(_user(), "org-a")
    assert not is_admin_of(_user(institution_role="admin", institution_id=None), None)


def _grant_check(grant, user, monkeypatch, require_editor=False):
    from app.auth import permissions

    async def no_membership(*_a, **_k):
        return []
    monkeypatch.setattr(permissions, "get_user_grant_ids", no_membership)
    return asyncio.run(_check_grant_access("g1", user, _SeqDb([[grant]]), None, require_editor))


def test_admin_reaches_own_org_grant(monkeypatch):
    grant = ActiveGrant(id="g1", title="G", institution_id="org-a", is_personal=False)
    assert _grant_check(grant, _user(institution_role="admin"), monkeypatch) is None


def test_admin_of_other_org_is_refused_grant(monkeypatch):
    grant = ActiveGrant(id="g1", title="G", institution_id="org-b", is_personal=False)
    with pytest.raises(HTTPException) as e:
        _grant_check(grant, _user(institution_role="admin"), monkeypatch)
    assert e.value.status_code == 403


def test_ops_manager_of_other_org_is_refused_grant(monkeypatch):
    grant = ActiveGrant(id="g1", title="G", institution_id="org-b", is_personal=False)
    with pytest.raises(HTTPException):
        _grant_check(grant, _user(role="operations_manager"), monkeypatch)


# ── Super-admins manage shared data; org roles never confer it ───────────────

from app.auth.permissions import is_super_admin, require_super_admin
from app.routers.admin import _require_admin


def test_org_admin_role_is_not_super_admin():
    org_admin = _user(role="admin", institution_role="admin")
    assert not is_super_admin(org_admin)
    with pytest.raises(HTTPException) as e:
        asyncio.run(require_super_admin()(current_user=org_admin))
    assert e.value.status_code == 403
    with pytest.raises(HTTPException):
        _require_admin(org_admin)


def test_super_admin_passes():
    boss = _user(is_super_admin=True, institution_role="member", role="viewer")
    assert asyncio.run(require_super_admin()(current_user=boss)) is boss
    _require_admin(boss)


def test_super_admin_cannot_revoke_self():
    from app.routers.users import SuperAdminUpdate, set_super_admin

    boss = _user(is_super_admin=True)
    with pytest.raises(HTTPException) as e:
        asyncio.run(set_super_admin(
            SuperAdminUpdate(email=boss.email, is_super_admin=False), _SeqDb([[boss]]), boss, None,
        ))
    assert e.value.status_code == 400

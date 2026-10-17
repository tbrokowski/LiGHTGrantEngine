"""Which organization's archive the current request or task may read.

The AI layer (RAG retrieval, drafting tools) is called from many places, deep
below the request. Rather than thread an institution id through every call,
the active organization is set once:

- per request, by `get_current_user` (the user's active organization);
- per Celery task, by the `task_prerun` hook below (the organization of the
  task's `grant_id`, or an explicit `institution_id` argument).

Unset means "no organization", and the filters here then match nothing — a
caller that forgets to scope gets no archive results, never another org's.
"""
from contextlib import contextmanager
from contextvars import ContextVar, Token
from typing import Iterator, Optional

from sqlalchemy import false, or_, select

_active_org: ContextVar[Optional[str]] = ContextVar("active_org", default=None)


def set_active_org(institution_id: Optional[str]) -> Token:
    return _active_org.set(institution_id)


def reset_active_org(token: Token) -> None:
    _active_org.reset(token)


def get_active_org() -> Optional[str]:
    return _active_org.get()


@contextmanager
def active_org(institution_id: Optional[str]) -> Iterator[None]:
    token = set_active_org(institution_id)
    try:
        yield
    finally:
        reset_active_org(token)


# ── SQL filters ───────────────────────────────────────────────────────────────

def archive_org_filter(institution_id: Optional[str] = None):
    """GrantArchive rows of the active organization."""
    from app.models.archive import GrantArchive
    org = institution_id or get_active_org()
    if not org:
        return false()
    return GrantArchive.institution_id == org


def _org_archive_ids(org: str):
    from app.models.archive import GrantArchive
    return select(GrantArchive.id).where(GrantArchive.institution_id == org)


def _org_grant_ids(org: str):
    from app.models.active_grant import ActiveGrant
    return select(ActiveGrant.id).where(ActiveGrant.institution_id == org)


def section_org_filter(institution_id: Optional[str] = None):
    """ProposalSection rows of the active organization: sections of its archive
    entries, and reference-doc sections of its grants."""
    from app.models.section import ProposalSection
    org = institution_id or get_active_org()
    if not org:
        return false()
    return or_(
        ProposalSection.archive_id.in_(_org_archive_ids(org)),
        ProposalSection.grant_id.in_(_org_grant_ids(org)),
    )


def language_block_org_filter(institution_id: Optional[str] = None):
    """ReusableLanguageBlock rows of the active organization: blocks taken from
    its archive, or owned by one of its members."""
    from app.models.institution_membership import InstitutionMembership
    from app.models.language import ReusableLanguageBlock
    org = institution_id or get_active_org()
    if not org:
        return false()
    members = select(InstitutionMembership.user_id).where(InstitutionMembership.institution_id == org)
    return or_(
        ReusableLanguageBlock.archive_id.in_(_org_archive_ids(org)),
        ReusableLanguageBlock.owner_id.in_(members),
    )


# ── Celery ────────────────────────────────────────────────────────────────────

def _task_org(task, args, kwargs) -> Optional[str]:
    import inspect
    try:
        bound = inspect.signature(task.run).bind_partial(*args, **kwargs).arguments
    except TypeError:
        bound = dict(kwargs)
    if bound.get("institution_id"):
        return bound["institution_id"]
    grant_id = bound.get("grant_id")
    if not grant_id:
        return None
    from sqlalchemy.orm import Session
    from app.db_sync import get_sync_engine
    from app.models.active_grant import ActiveGrant
    with Session(get_sync_engine()) as db:
        return db.execute(
            select(ActiveGrant.institution_id).where(ActiveGrant.id == grant_id)
        ).scalar_one_or_none()


def connect_celery_signals() -> None:
    """Scope every task to its grant's organization, and clear it afterwards
    so the next task on this worker never inherits it."""
    from celery.signals import task_postrun, task_prerun

    tokens: dict[str, Token] = {}

    @task_prerun.connect(weak=False, dispatch_uid="tenancy_prerun")
    def _prerun(task_id=None, task=None, args=(), kwargs=None, **_):
        try:
            org = _task_org(task, args or (), kwargs or {})
        except Exception:
            org = None
        tokens[task_id] = set_active_org(org)

    @task_postrun.connect(weak=False, dispatch_uid="tenancy_postrun")
    def _postrun(task_id=None, **_):
        token = tokens.pop(task_id, None)
        if token is not None:
            try:
                reset_active_org(token)
            except ValueError:
                set_active_org(None)

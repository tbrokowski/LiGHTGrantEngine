"""Unit tests for the Funders tab: tiers, the org feature switch, starter list."""
import pytest
from pydantic import ValidationError

from app.models.institution import Institution
from app.routers.funders import BulkTierIn, FunderCreate, TierIn
from app.services.funders import (
    FUNDER_TIERS, SEEDED_FLAG, STARTER_FUNDERS, STARTER_ORGS, enabled_features, has_feature,
    match_key, needs_seed, tier_rank, valid_tier,
)


def _inst(features):
    return Institution(id="i1", name="LiGHT", features=features)


def test_tiers_run_from_blue_whales_to_unsorted():
    assert FUNDER_TIERS == ("blue_whale", "sperm_whale", "whale_pod", "dolphin", "shark", "unsorted")
    assert tier_rank("dolphin") < tier_rank("shark") < tier_rank("unsorted") < tier_rank("nonsense")


def test_tier_validation():
    assert valid_tier("sperm_whale") and not valid_tier("minnow") and not valid_tier(None)
    # The old ten-tier keys were folded into five (migration 079).
    for old in ("whale_calf", "matriarch", "humpback_whale", "orca", "pilot_fish"):
        assert not valid_tier(old)
    assert TierIn(tier=None).tier is None  # null takes someone off the tab
    with pytest.raises(ValidationError):
        TierIn(tier="minnow")
    with pytest.raises(ValidationError):
        BulkTierIn(ids=["a"], tier="minnow")
    with pytest.raises(ValidationError):
        FunderCreate(name="X", tier="minnow")
    assert FunderCreate(name="X").tier == "unsorted"


def test_feature_switch():
    assert has_feature(_inst({"funders": True}))
    assert not has_feature(_inst({"funders": False}))
    assert not has_feature(_inst({}))
    assert not has_feature(None)
    # The seeded marker isn't a feature the UI should see.
    assert enabled_features(_inst({"funders": True, SEEDED_FLAG: True})) == ["funders"]
    assert enabled_features(None) == []


def test_seed_runs_once_and_only_where_switched_on():
    assert needs_seed(_inst({"funders": True}))
    assert not needs_seed(_inst({"funders": True, SEEDED_FLAG: True}))
    assert not needs_seed(_inst({}))


def test_match_key_uses_linkedin_path_then_name():
    a = match_key("Karin Jestin", "https://ch.linkedin.com/in/karin-jestin-26b09b1/?locale=en")
    b = match_key("karin  jestin", "https://www.linkedin.com/in/karin-jestin-26b09b1")
    assert a == b == ("/in/karin-jestin-26b09b1", "karin jestin")
    assert match_key("Chuck Slaughter", None) == ("", "chuck slaughter")


def test_starter_list_is_consistent():
    org_names = {o.name for o in STARTER_ORGS}
    for f in STARTER_FUNDERS:
        assert valid_tier(f.tier), f.name
        assert f.organization is None or f.organization in org_names, f.name
    tiers = {f.name: f.tier for f in STARTER_FUNDERS}
    # Only tiers the team named in Slack are set; the rest wait in "To sort".
    assert tiers["Karin Jestin"] == "dolphin"
    assert tiers["Chuck Slaughter"] == "shark"
    assert tiers["Sabrina Grassi"] == tiers["Janine Händel"] == "unsorted"


def test_outreach_feed_is_routed():
    from app.routers.funders import router
    paths = {r.path for r in router.routes}
    assert "/outreach" in paths and "/follow-ups" in paths


def test_thread_validation():
    from app.routers.funder_threads import PostIn, ThreadCreate, ThreadPatch

    with pytest.raises(ValidationError):
        ThreadCreate(title="   ")
    with pytest.raises(ValidationError):
        ThreadCreate(title="x" * 301)
    t = ThreadCreate(title="  Swiss foundations push  ", content="   ")
    assert t.title == "Swiss foundations push"
    assert t.content is None  # a blank opening message means none
    assert ThreadCreate(title="T", content=" hi ").content == "hi"
    with pytest.raises(ValidationError):
        PostIn(content="  ")
    with pytest.raises(ValidationError):
        ThreadPatch(status="archived")
    assert ThreadPatch(status="closed").title is None


def test_thread_routes_are_mounted():
    from app.main import app

    paths = {getattr(r, "path", "") for r in app.routes}
    for p in (
        "/api/v1/funders/threads/",
        "/api/v1/funders/threads/{thread_id}",
        "/api/v1/funders/threads/{thread_id}/posts",
        "/api/v1/funders/threads/{thread_id}/posts/{post_id}",
        "/api/v1/funders/threads/{thread_id}/funders",
        "/api/v1/funders/threads/{thread_id}/funders/{partner_id}",
    ):
        assert p in paths, p

"""Grant profile schemas for org and personal filtering."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


DEFAULT_AUTO_QUEUE_THRESHOLD = 40


@dataclass
class PriorityFunderGroup:
    """A named group of funders an org wants to prioritize/filter by."""
    name: str = ""
    funders: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PriorityFunderGroup:
        return cls(
            name=str(data.get("name") or ""),
            funders=[str(f) for f in (data.get("funders") or []) if f],
        )

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.name, "funders": self.funders}


@dataclass
class GrantProfile:
    institution_name: str = ""
    keywords: list[str] = field(default_factory=list)
    geographies: list[str] = field(default_factory=list)
    projects: str = ""
    excluded_keywords: list[str] = field(default_factory=list)
    auto_queue_threshold: int = DEFAULT_AUTO_QUEUE_THRESHOLD
    priority_funders: list[PriorityFunderGroup] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> GrantProfile:
        if not data:
            return cls()
        return cls(
            institution_name=str(data.get("institution_name") or ""),
            keywords=list(data.get("keywords") or []),
            geographies=list(data.get("geographies") or []),
            projects=str(data.get("projects") or ""),
            excluded_keywords=list(data.get("excluded_keywords") or []),
            auto_queue_threshold=int(data.get("auto_queue_threshold") or DEFAULT_AUTO_QUEUE_THRESHOLD),
            priority_funders=[
                PriorityFunderGroup.from_dict(g) for g in (data.get("priority_funders") or []) if isinstance(g, dict)
            ],
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "institution_name": self.institution_name,
            "keywords": self.keywords,
            "geographies": self.geographies,
            "projects": self.projects,
            "excluded_keywords": self.excluded_keywords,
            "auto_queue_threshold": self.auto_queue_threshold,
            "priority_funders": [g.to_dict() for g in self.priority_funders],
        }


@dataclass
class UserGrantPreferences:
    keywords: list[str] = field(default_factory=list)
    excluded_keywords: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> UserGrantPreferences:
        if not data:
            return cls()
        return cls(
            keywords=list(data.get("keywords") or []),
            excluded_keywords=list(data.get("excluded_keywords") or []),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "keywords": self.keywords,
            "excluded_keywords": self.excluded_keywords,
        }


def merge_keywords(org: GrantProfile, personal: UserGrantPreferences) -> tuple[list[str], list[str]]:
    """Combine org + personal keywords for display filtering."""
    keywords = list(dict.fromkeys([k.lower() for k in org.keywords + personal.keywords if k]))
    excluded = list(dict.fromkeys([k.lower() for k in org.excluded_keywords + personal.excluded_keywords if k]))
    return keywords, excluded


def opportunity_matches_keywords(opp, keywords: list[str], excluded: list[str]) -> bool:
    """Lightweight text filter for personal/org keyword preferences."""
    if excluded:
        haystack = _opp_text(opp)
        if any(kw in haystack for kw in excluded):
            return False
    if not keywords:
        return True
    haystack = _opp_text(opp)
    return any(kw in haystack for kw in keywords)


def _opp_text(opp) -> str:
    parts = [
        getattr(opp, "title", "") or "",
        getattr(opp, "description", "") or "",
        getattr(opp, "funder", "") or "",
        getattr(opp, "fit_rationale", "") or "",
        " ".join(getattr(opp, "thematic_areas", None) or []),
        " ".join(getattr(opp, "keywords", None) or []),
    ]
    return " ".join(parts).lower()

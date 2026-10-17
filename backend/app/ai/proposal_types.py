"""Proposal-type style preference for the one-page grant editor.

The user picks what they are writing — a concept note, an expression of
interest (EOI), or a Horizon-style full proposal. The choice is stored on
`grant.style_profile["proposal_type"]` and steers two things in the draft
pipeline:

  1. Which archive examples RAG retrieval prefers: sections whose source
     document has a matching `document_type` (archive uploads are typed as
     concept_note / full_proposal / ...). If the archive has nothing of that
     type, retrieval falls back to the unfiltered archive.
  2. A format brief prepended to the call requirements, so the planner and
     section writers size and structure the document for that type.
"""
from __future__ import annotations

PROPOSAL_TYPES: dict[str, dict] = {
    "concept_note": {
        "label": "Concept note",
        "document_types": ["concept_note"],
        "brief": (
            "PROPOSAL FORMAT: CONCEPT NOTE. A short, persuasive document of roughly "
            "2-4 pages (about 1,000-2,000 words) unless the call states otherwise. "
            "Use 4-6 compact sections (e.g. problem and need, proposed approach, "
            "expected outcomes and impact, team and partners, indicative budget). "
            "Favour crisp paragraphs and short bullet lists over long sub-sections; "
            "no work-package tables or detailed Gantt plans."
        ),
    },
    "eoi": {
        "label": "Expression of interest",
        "document_types": ["concept_note"],
        "brief": (
            "PROPOSAL FORMAT: EXPRESSION OF INTEREST (EOI). A brief first-stage "
            "submission of roughly 1-3 pages (about 600-1,500 words) unless the call "
            "states otherwise. Answer the call's EOI questions directly, in its order, "
            "with short focused sections: the idea, why it fits the call, the team's "
            "track record, and the intended impact. Keep it high-level — no detailed "
            "methodology, work packages or budget tables."
        ),
    },
    "horizon": {
        "label": "Horizon-style full proposal",
        "document_types": ["full_proposal"],
        "brief": (
            "PROPOSAL FORMAT: HORIZON-STYLE FULL PROPOSAL. A full research and "
            "innovation proposal structured like Horizon Europe Part B unless the call "
            "states otherwise: 1. Excellence (objectives, ambition, methodology), "
            "2. Impact (pathways to impact, dissemination, exploitation and "
            "communication), 3. Quality and efficiency of implementation (work plan, "
            "work packages, deliverables, milestones, risks, consortium). Use numbered "
            "sub-sections and nested bullet lists where they aid scanning."
        ),
    },
}


def get_proposal_type(style_profile: dict | None) -> str | None:
    """The grant's chosen proposal type, or None when not set / unknown."""
    value = (style_profile or {}).get("proposal_type")
    return value if value in PROPOSAL_TYPES else None


def archive_document_types(proposal_type: str | None) -> list[str] | None:
    """Archive document types RAG should prefer for this proposal type."""
    if not proposal_type:
        return None
    return PROPOSAL_TYPES[proposal_type]["document_types"]


def format_brief(proposal_type: str | None) -> str:
    """Prompt text describing the target format, or '' when no type is set."""
    if not proposal_type:
        return ""
    return PROPOSAL_TYPES[proposal_type]["brief"]

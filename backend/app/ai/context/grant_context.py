"""Structured document parsing and context assembly for grant writing agents."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from html import unescape
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.rag.retriever import retrieve_content_exemplars, retrieve_reusable_language
from app.models.active_grant import ActiveGrant
from app.models.grant_writing import GrantWritingConversation


@dataclass
class DocumentSection:
    title: str
    html: str
    plain_text: str
    word_count: int
    section_type: str = "other"
    order: int = 0


DEFAULT_INTRO_ARC = [
    {"beat": "broad_statement", "label": "Broad opening statement (global significance)", "guidance": ""},
    {"beat": "context", "label": "Context (setting, stakeholders, geography)", "guidance": ""},
    {"beat": "problem", "label": "Problem (evidence-backed gap)", "guidance": ""},
    {"beat": "solution", "label": "Proposed solution (your approach)", "guidance": ""},
    {"beat": "limitations", "label": "Potential limitations / counterarguments", "guidance": ""},
    {"beat": "resolution", "label": "Resolution (why this team, why now, why this works)", "guidance": ""},
]


def strip_html(html: str) -> str:
    text = re.sub(r"<[^>]+>", " ", html or "")
    text = unescape(re.sub(r"\s+", " ", text)).strip()
    return text


def parse_document_sections(html: str, skeleton: dict | None = None) -> list[DocumentSection]:
    """Split unified editor HTML on H2 headings."""
    if not html:
        return []

    skeleton_sections = (skeleton or {}).get("sections") or []
    type_by_title = {s.get("name", "").lower(): s.get("type", "other") for s in skeleton_sections}

    parts = re.split(r"(<h2[^>]*>.*?</h2>)", html, flags=re.IGNORECASE | re.DOTALL)
    sections: list[DocumentSection] = []
    order = 0

    if parts and not re.match(r"<h2", parts[0], re.IGNORECASE):
        preamble = parts[0].strip()
        if preamble:
            plain = strip_html(preamble)
            sections.append(DocumentSection(
                title="Preamble",
                html=preamble,
                plain_text=plain,
                word_count=len(plain.split()) if plain else 0,
                order=order,
            ))
            order += 1

    i = 0
    while i < len(parts):
        chunk = parts[i]
        if re.match(r"<h2", chunk, re.IGNORECASE):
            title = strip_html(chunk)
            body = parts[i + 1] if i + 1 < len(parts) else ""
            plain = strip_html(body)
            sections.append(DocumentSection(
                title=title,
                html=f"{chunk}{body}",
                plain_text=plain,
                word_count=len(plain.split()) if plain else 0,
                section_type=type_by_title.get(title.lower(), "other"),
                order=order,
            ))
            order += 1
            i += 2
        else:
            i += 1

    return sections


def skeleton_to_html(skeleton: dict) -> str:
    """Convert proposal skeleton to editor HTML with H2 headings."""
    sections = skeleton.get("sections") or []
    if not sections:
        return ""
    parts = []
    for sec in sections:
        name = sec.get("name") or sec.get("title") or "Section"
        parts.append(f"<h2>{name}</h2>\n<p></p>")
    return "\n".join(parts)


def insert_section_content(html: str, section_title: str, content_html: str) -> str:
    """Replace body content under a matching H2 section."""
    sections = parse_document_sections(html)
    if not sections:
        return f"<h2>{section_title}</h2>\n{content_html}"

    rebuilt: list[str] = []
    replaced = False
    for sec in sections:
        if sec.title.lower() == section_title.lower():
            rebuilt.append(f"<h2>{sec.title}</h2>\n{content_html}")
            replaced = True
        else:
            rebuilt.append(sec.html)
    if not replaced:
        rebuilt.append(f"<h2>{section_title}</h2>\n{content_html}")
    return "\n".join(rebuilt)


def summarize_sections(sections: list[DocumentSection], max_chars: int = 500) -> str:
    lines = []
    for sec in sections:
        snippet = sec.plain_text[:max_chars]
        lines.append(f"### {sec.title} ({sec.word_count} words)\n{snippet}")
    return "\n\n".join(lines)


@dataclass
class GrantContext:
    layers: dict[str, str] = field(default_factory=dict)
    rag_sections: list[dict] = field(default_factory=list)
    rag_language: list[dict] = field(default_factory=list)
    citations: list[dict] = field(default_factory=list)
    document_sections: list[DocumentSection] = field(default_factory=list)
    active_section: DocumentSection | None = None


class GrantContextManager:
    """Assemble token-budgeted context for grant writing agents."""

    PERSONA = (
        "You are an expert scientific grant writer for the LiGHT group at EPFL (Global Health AI research). "
        "Write in a clear, compelling academic style matching institutional archive exemplars. "
        "Use [CUSTOMIZE: reason] for text needing tailoring and [VERIFY: item] for uncertain claims."
    )

    def __init__(self, max_chars: int = 96000):
        self.max_chars = max_chars

    async def build(
        self,
        grant: ActiveGrant,
        db: AsyncSession,
        *,
        active_section_title: str | None = None,
        document_html: str | None = None,
        user_query: str | None = None,
        include_rag: bool = True,
        conversation: GrantWritingConversation | None = None,
        user: object | None = None,
    ) -> GrantContext:
        ctx = GrantContext()
        html = document_html or grant.editor_document or ""
        ctx.document_sections = parse_document_sections(html, grant.proposal_skeleton)

        # Include linked Google Doc content so the AI can read the live proposal.
        # Requires the user to have connected their Google account.
        if grant.google_doc_id and user is not None:
            try:
                from app.services.google_auth import get_valid_google_token
                from app.services.google_docs import read_document_as_text
                import asyncio
                access_token = await get_valid_google_token(user, db)  # type: ignore[arg-type]
                gdoc_text = await asyncio.get_event_loop().run_in_executor(
                    None, read_document_as_text, grant.google_doc_id, access_token
                )
                if gdoc_text:
                    ctx.layers["google_doc"] = (
                        f"LINKED GOOGLE DOC (live content — {len(gdoc_text.split())} words):\n"
                        + gdoc_text[:24000]
                    )
            except Exception:
                pass  # Google not connected or token invalid — continue without it

        if active_section_title:
            for sec in ctx.document_sections:
                if sec.title.lower() == active_section_title.lower():
                    ctx.active_section = sec
                    break
        elif ctx.document_sections:
            ctx.active_section = ctx.document_sections[0]

        ctx.layers["persona"] = self.PERSONA
        if grant.call_analysis:
            ctx.layers["call_analysis"] = json.dumps(grant.call_analysis, indent=2)[:16000]
        if grant.grant_idea:
            ctx.layers["grant_idea"] = grant.grant_idea[:8000]
        if grant.proposal_skeleton:
            ctx.layers["skeleton"] = json.dumps(grant.proposal_skeleton, indent=2)[:12000]
        if grant.style_profile:
            ctx.layers["style_profile"] = json.dumps(grant.style_profile, indent=2)[:6000]
        if grant.call_requirements:
            ctx.layers["call_requirements"] = grant.call_requirements[:8000]

        if ctx.active_section:
            ctx.layers["active_section"] = (
                f"SECTION: {ctx.active_section.title}\n"
                f"TYPE: {ctx.active_section.section_type}\n"
                f"CONTENT:\n{ctx.active_section.plain_text[:24000]}"
            )

        idx = next((i for i, s in enumerate(ctx.document_sections) if ctx.active_section and s.title == ctx.active_section.title), -1)
        adjacent = []
        if idx > 0:
            adjacent.append(f"PREVIOUS — {ctx.document_sections[idx - 1].title}: {ctx.document_sections[idx - 1].plain_text[:2400]}")
        if idx >= 0 and idx < len(ctx.document_sections) - 1:
            adjacent.append(f"NEXT — {ctx.document_sections[idx + 1].title}: {ctx.document_sections[idx + 1].plain_text[:2400]}")
        if adjacent:
            ctx.layers["adjacent_sections"] = "\n".join(adjacent)

        if conversation and conversation.summary:
            ctx.layers["conversation_summary"] = conversation.summary[:4000]

        if include_rag and user_query:
            query = f"{user_query} {grant.title} {grant.funder or ''}"
            section_type = ctx.active_section.section_type if ctx.active_section else None
            ctx.rag_sections = await retrieve_content_exemplars(
                query=query,
                db=db,
                section_type=section_type,
                funder=grant.funder,
                top_k=4,
            )
            ctx.rag_language = await retrieve_reusable_language(
                query=query,
                db=db,
                section_type=section_type,
                top_k=3,
            )
            if ctx.rag_sections:
                blocks = [
                    "These are excerpts from this institution's OWN past proposals. "
                    "Where an excerpt is marked [VERBATIM REUSE OK] and fits the point "
                    "you're making, borrow its actual sentences and phrasing — reuse the "
                    "language directly, adapting only names, numbers, and specifics to this "
                    "proposal. This is the institution's established voice; match it. "
                    "Excerpts marked [PARAPHRASE ONLY] must be reworded, not copied."
                ]
                for s in ctx.rag_sections:
                    perm = s.get("reuse_permission")
                    tag = "[VERBATIM REUSE OK]" if perm == "direct_reuse_allowed" else "[PARAPHRASE ONLY]"
                    blocks.append(
                        f"{tag} [{s.get('section_type', '?')} — {s.get('grant_title', '?')}, "
                        f"{s.get('funder', '?')}, {s.get('outcome', '?')}]\n{s.get('full_text', '')[:4000]}"
                    )
                ctx.layers["archive_sections"] = "\n\n".join(blocks)
            if ctx.rag_language:
                blocks = []
                for b in ctx.rag_language:
                    note = " [PARAPHRASE ONLY]" if b.get("paraphrase_only") else ""
                    blocks.append(f"{b.get('title', '?')}{note}:\n{b.get('full_text', '')[:2000]}")
                ctx.layers["reusable_language"] = "\n\n".join(blocks)

        return ctx

    def to_system_prompt(self, ctx: GrantContext) -> str:
        order = [
            "persona", "call_analysis", "call_requirements", "grant_idea",
            "skeleton", "style_profile", "google_doc", "active_section", "adjacent_sections",
            "archive_sections", "reusable_language", "citations", "conversation_summary",
        ]
        parts = []
        total = 0
        for key in order:
            val = ctx.layers.get(key)
            if not val:
                continue
            block = f"\n\n--- {key.upper().replace('_', ' ')} ---\n{val}"
            if total + len(block) > self.max_chars:
                remaining = self.max_chars - total
                if remaining > 200:
                    parts.append(block[:remaining])
                break
            parts.append(block)
            total += len(block)
        return "".join(parts).strip()

    def context_chip_labels(self, ctx: GrantContext) -> list[str]:
        chips = []
        if ctx.layers.get("call_analysis") or ctx.layers.get("call_requirements"):
            chips.append("Call req")
        if ctx.layers.get("google_doc"):
            chips.append("Google Doc")
        if ctx.active_section:
            chips.append(ctx.active_section.title)
        if ctx.rag_sections:
            chips.append(f"{len(ctx.rag_sections)} archive refs")
        if ctx.citations:
            chips.append(f"{len(ctx.citations)} citations")
        if ctx.layers.get("style_profile"):
            chips.append("Style profile")
        return chips

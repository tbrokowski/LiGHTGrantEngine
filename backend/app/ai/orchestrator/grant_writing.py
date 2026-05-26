"""Grant writing orchestrator — coordinates multi-agent writing pipeline."""
from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.agents.call_analyzer import analyze_call as analyze_call_agent
from app.ai.agents.compliance_checker import check_compliance
from app.ai.agents.grant_reviewer import review_proposal
from app.ai.agents.intro_architect import draft_introduction
from app.ai.agents.proposal_architect import generate_proposal_outline
from app.ai.agents.section_drafter import draft_section
from app.ai.agents.style_profiler import build_style_profile
from app.ai.agents.style_reviewer import review_style
from app.ai.agents.citation_agent import find_citations_for_claims
from app.ai.context.grant_context import (
    GrantContextManager,
    insert_section_content,
    parse_document_sections,
    skeleton_to_html,
    summarize_sections,
)
from app.ai.rag.retriever import (
    retrieve_archive_style_fingerprints,
    retrieve_content_exemplars,
    retrieve_document_structure,
    retrieve_reusable_language,
    retrieve_style_exemplars,
)
from app.models.active_grant import ActiveGrant
from app.models.document import Document
from app.services.citation_lookup import search_citations


INTRO_KEYWORDS = ("intro", "background", "problem", "executive", "rationale")


class GrantWritingOrchestrator:
    def __init__(self):
        self.context_mgr = GrantContextManager()

    async def analyze_call_document(
        self,
        grant: ActiveGrant,
        call_text: str,
        db: AsyncSession,
        call_url: str = "",
    ) -> dict:
        result = await analyze_call_agent(
            call_text=call_text,
            call_url=call_url or grant.call_url or "",
            funder=grant.funder or "",
        )
        grant.call_analysis = result
        grant.call_requirements = self._format_call_requirements(result)
        await db.commit()
        return result

    async def build_style_profile(self, grant: ActiveGrant, db: AsyncSession) -> dict:
        fingerprints = await retrieve_archive_style_fingerprints(db, grant.funder, top_k=2)

        style_sections: list[dict] = []
        seen_ids: set[str] = set()
        for stype in ("background", "methods", "impact_statement", "abstract", "specific_aims"):
            for sec in await retrieve_style_exemplars(db, section_type=stype, funder=grant.funder, top_k=2):
                if sec["id"] not in seen_ids:
                    seen_ids.add(sec["id"])
                    style_sections.append(sec)

        profile = await build_style_profile(
            grant_title=grant.title,
            funder=grant.funder or "",
            grant_idea=grant.grant_idea or "",
            retrieved_sections=style_sections[:8],
        )

        if fingerprints:
            profile["archive_style_sources"] = [
                {"grant_title": f["grant_title"], "funder": f["funder"], "outcome": f["outcome"]}
                for f in fingerprints
            ]
            best_fp = (fingerprints[0].get("style_fingerprint") or {})
            for key in ("voice_summary", "opening_patterns", "terminology", "tone", "hedging_style"):
                if best_fp.get(key) and not profile.get(key):
                    profile[key] = best_fp[key]

        grant.style_profile = profile
        await db.commit()
        return profile

    async def generate_skeleton(self, grant: ActiveGrant, db: AsyncSession) -> dict:
        if not grant.style_profile:
            await self.build_style_profile(grant, db)

        structure_templates = await retrieve_document_structure(db, grant.funder, top_k=3)
        content_similar = await retrieve_content_exemplars(
            query=f"{grant.title} {grant.grant_idea or ''}",
            db=db,
            funder=grant.funder,
            top_k=8,
        )
        skeleton = await generate_proposal_outline(
            opportunity_title=grant.title,
            call_analysis=grant.call_analysis or {},
            similar_grants=content_similar,
            structure_templates=structure_templates,
            grant_idea=grant.grant_idea or "",
            style_profile=grant.style_profile or {},
            external_deadline=str(grant.external_deadline) if grant.external_deadline else "",
            internal_deadline=str(grant.internal_deadline) if grant.internal_deadline else "",
        )
        grant.proposal_skeleton = skeleton
        grant.writing_phase = "skeleton"
        await db.commit()
        return skeleton

    async def generate_draft_stream(
        self,
        grant: ActiveGrant,
        db: AsyncSession,
    ) -> AsyncIterator[str]:
        """SSE stream: draft sections one at a time."""
        skeleton = grant.proposal_skeleton or {}
        sections = skeleton.get("sections") or []
        if not sections:
            yield _sse({"error": "No skeleton sections found. Generate skeleton first."})
            return

        html = skeleton_to_html(skeleton)
        grant.editor_document = html
        grant.writing_phase = "draft"
        await db.commit()

        eval_criteria = (grant.call_analysis or {}).get("evaluation_criteria", [])
        call_req = grant.call_requirements or ""
        prior_summary = ""

        for i, sec in enumerate(sections):
            name = sec.get("name") or sec.get("title") or f"Section {i + 1}"
            sec_type = sec.get("type") or "other"
            requirements = sec.get("requirements") or call_req
            word_limit = sec.get("word_limit")
            name_lower = name.lower()
            sec_type_lower = sec_type.lower()
            is_intro = any(k in name_lower or k in sec_type_lower for k in INTRO_KEYWORDS)

            yield _sse({"event": "section_start", "section": name, "index": i, "total": len(sections)})

            style_exemplars = await retrieve_style_exemplars(
                db=db,
                section_type=sec_type,
                funder=grant.funder,
                top_k=3,
            )
            content_exemplars = await retrieve_content_exemplars(
                query=f"{name} {requirements[:200]} {grant.grant_idea or ''}",
                db=db,
                section_type=sec_type,
                funder=grant.funder,
                top_k=4,
            )
            reusable = await retrieve_reusable_language(
                query=requirements[:300],
                db=db,
                section_type=sec_type,
                top_k=3,
            )

            citations = []
            try:
                cite_results = await search_citations(f"{name} {grant.grant_idea or ''}"[:200], max_results=3)
                citations = cite_results
            except Exception:
                pass

            if is_intro:
                result = await draft_introduction(
                    grant_idea=grant.grant_idea or "",
                    call_requirements=requirements,
                    evaluation_criteria=eval_criteria,
                    intro_arc=sec.get("intro_arc"),
                    style_profile=grant.style_profile,
                    style_exemplars=style_exemplars,
                    retrieved_sections=content_exemplars,
                    citations=citations,
                    funder=grant.funder or "",
                    word_limit=word_limit,
                )
            else:
                result = await draft_section(
                    section_name=name,
                    section_type=sec_type,
                    call_requirements=requirements,
                    evaluation_criteria=eval_criteria,
                    retrieved_sections=content_exemplars,
                    style_exemplars=style_exemplars,
                    reusable_language=reusable,
                    word_limit=word_limit,
                    funder=grant.funder or "",
                    style_profile=grant.style_profile,
                    prior_sections_summary=prior_summary,
                    citations=citations,
                    grant_idea=grant.grant_idea or "",
                )

            draft_text = result.get("draft", "")
            if draft_text and not draft_text.strip().startswith("<"):
                draft_html = "".join(f"<p>{p.strip()}</p>" for p in draft_text.split("\n\n") if p.strip())
            else:
                draft_html = draft_text

            html = insert_section_content(html, name, draft_html)
            grant.editor_document = html
            await db.commit()

            prior_summary += f"\n{name}: {draft_text[:500]}"

            yield _sse({
                "event": "section_complete",
                "section": name,
                "index": i,
                "word_count": result.get("word_count", len(draft_text.split())),
                "warnings": result.get("warnings", []),
                "human_review_required": result.get("human_review_required", False),
            })

        yield _sse({"event": "draft_complete", "document_html": html})

    async def run_review(self, grant: ActiveGrant, db: AsyncSession) -> dict:
        draft = grant.editor_document or ""
        plain = " ".join(s.plain_text for s in parse_document_sections(draft))
        call_analysis = grant.call_analysis or {}
        eval_criteria = call_analysis.get("evaluation_criteria", [])

        style_exemplars = await retrieve_style_exemplars(db, funder=grant.funder, top_k=4)

        compliance, quality, style = await asyncio.gather(
            check_compliance(plain, call_analysis),
            review_proposal(plain, eval_criteria, call_analysis, grant.style_profile, style_exemplars),
            review_style(plain, grant.style_profile or {}, style_exemplars),
        )

        overall = int(
            (quality.get("overall_score", 50) * 0.5)
            + (style.get("match_score", 50) * 0.25)
            + (70 if compliance.get("overall_status") == "pass" else 40 if compliance.get("overall_status") == "needs_work" else 20) * 0.25
        )

        fixes = []
        for item in compliance.get("recommended_fixes", []):
            fixes.append({"section": "General", "issue": item, "suggestion": item, "severity": "high", "source": "compliance"})
        for item in quality.get("recommended_improvements", []):
            if isinstance(item, str):
                fixes.append({"section": "General", "issue": item, "suggestion": item, "severity": "medium", "source": "quality"})
            elif isinstance(item, dict):
                fixes.append({**item, "source": "quality"})
        for item in style.get("deviations", []):
            fixes.append({**item, "source": "style"})

        report = {
            "overall_score": overall,
            "ready_for_submission": overall >= 75 and compliance.get("overall_status") != "critical_issues",
            "compliance": compliance,
            "quality": quality,
            "style": style,
            "prioritized_fixes": fixes[:20],
        }
        grant.last_review = report
        await db.commit()
        return report

    def _format_call_requirements(self, analysis: dict) -> str:
        parts = []
        if analysis.get("summary"):
            parts.append(f"SUMMARY: {analysis['summary']}")
        if analysis.get("evaluation_criteria"):
            parts.append("EVALUATION CRITERIA:\n" + "\n".join(f"- {c}" for c in analysis["evaluation_criteria"]))
        if analysis.get("required_sections"):
            parts.append("REQUIRED SECTIONS:\n" + "\n".join(f"- {s}" for s in analysis["required_sections"]))
        if analysis.get("section_requirements"):
            parts.append("SECTION REQUIREMENTS:\n" + json.dumps(analysis["section_requirements"], indent=2))
        if analysis.get("budget_constraints"):
            parts.append(f"BUDGET: {analysis['budget_constraints']}")
        if analysis.get("word_limit"):
            parts.append(f"WORD LIMIT: {analysis['word_limit']}")
        return "\n\n".join(parts)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"

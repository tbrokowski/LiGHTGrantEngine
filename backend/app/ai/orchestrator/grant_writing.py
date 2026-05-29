"""Grant writing orchestrator — coordinates multi-agent writing pipeline."""
from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.agents.bibliography_generator import generate_bibliography
from app.ai.agents.call_analyzer import analyze_call as analyze_call_agent, _analysis_has_content
from app.ai.agents.call_strategy_agent import build_call_strategy
from app.ai.agents.compliance_checker import check_compliance
from app.ai.agents.concept_extractor import extract_concepts
from app.ai.agents.grant_reviewer import review_proposal
from app.ai.agents.idea_alignment_agent import align_idea_to_call
from app.ai.agents.intro_architect import draft_introduction
from app.ai.agents.meta_agent import check_narrative_coherence, evaluate_and_improve_section
from app.ai.agents.planning_agent import plan_draft_research
from app.ai.agents.proposal_architect import generate_proposal_outline
from app.ai.agents.research_agent import gather_section_evidence
from app.ai.agents.skeleton_planning_agent import plan_skeleton_research
from app.ai.agents.skeleton_reviewer import review_skeleton
from app.ai.agents.section_drafter import draft_section
from app.ai.agents.style_profiler import build_style_profile
from app.ai.agents.style_reviewer import review_style
from app.ai.context.grant_context import (
    GrantContextManager,
    insert_section_content,
    parse_document_sections,
    skeleton_to_html,
)
from app.ai.rag.retriever import (
    retrieve_archive_style_fingerprints,
    retrieve_content_exemplars,
    retrieve_document_structure,
    retrieve_reusable_language,
    retrieve_style_exemplars,
    retrieve_with_hyde,
)
from app.models.active_grant import ActiveGrant
from app.models.document import Document
from app.services.citation_lookup import search_citations
from app.ai.orchestrator.adaptive_draft import run_adaptive_draft_stream, wait_for_call_intelligence
from app.ai.services.document_constraints_builder import (
    build_document_constraints,
    enforce_skeleton_constraints,
)
from app.ai.services.constraint_allocator import audit_constraints_compliance


INTRO_KEYWORDS = ("intro", "background", "problem", "executive", "rationale")

# Semaphore limits for parallel subagent phases
_RESEARCH_SEMAPHORE = asyncio.Semaphore(4)
_DRAFT_SEMAPHORE = asyncio.Semaphore(3)


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
        if not _analysis_has_content(result):
            err = result.get("error") or "Call analysis returned no usable content"
            raise ValueError(err)
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
            current_grant_id=str(grant.id),
        )
        skeleton = await generate_proposal_outline(
            opportunity_title=grant.title,
            call_analysis=grant.call_analysis or {},
            similar_grants=content_similar,
            structure_templates=structure_templates,
            grant_idea=grant.grant_idea or "",
            style_profile=grant.style_profile or {},
            call_requirements_text=grant.call_requirements or "",
            external_deadline=str(grant.external_deadline) if grant.external_deadline else "",
            internal_deadline=str(grant.internal_deadline) if grant.internal_deadline else "",
        )
        grant.proposal_skeleton = skeleton
        grant.writing_phase = "skeleton"
        await db.commit()
        return skeleton

    async def generate_skeleton_stream(
        self,
        grant: ActiveGrant,
        db: AsyncSession,
        user_section_constraints: list[dict] | None = None,
        user_total_word_limit: int | None = None,
        user_total_page_limit: str | None = None,
    ) -> AsyncIterator[str]:
        """
        Multi-agent skeleton generation pipeline with SSE progress events.

        Pipeline:
          Stage 1 (parallel): Style profile + Archive RAG retrieval
          Stage 2: Call Strategy Agent — synthesizes full call_analysis into winning brief
          Stage 3: Idea Alignment Agent — aligns grant idea to call strategy
          Stage 4: Proposal Architect — generates skeleton with enriched context
        """
        yield _sse({"event": "skeleton_start"})

        # ── Gate: wait for call_intelligence (blueprint + word budgets) ─────────────
        yield _sse({"event": "constraints_wait_intelligence"})
        call_intelligence: dict = await wait_for_call_intelligence(grant, db, timeout_sec=60)
        grant_type_context: str = call_intelligence.get("grant_type_context") or ""
        section_blueprint: list[dict] = call_intelligence.get("section_blueprint") or []

        # ── Stage 1: Style profile (sequential — AsyncSession is not concurrent-safe) ──
        yield _sse({"event": "style_profile_start"})
        try:
            await self.build_style_profile(grant, db)
        except Exception:
            pass  # style profile is nice-to-have; continue without
        yield _sse({"event": "style_profile_complete"})

        # ── Stage 1b: Archive retrieval (sequential after style profile commits) ───────
        call_analysis = grant.call_analysis or {}
        try:
            structure_templates = await retrieve_document_structure(db, grant.funder, top_k=3)
        except Exception:
            structure_templates = []
        try:
            # Enrich RAG query with call thematic areas for more targeted archive hits
            themes = " ".join((call_analysis.get("thematic_areas") or [])[:4])
            rag_query = f"{grant.title} {themes} {grant.grant_idea or ''}".strip()
            content_similar = await retrieve_content_exemplars(
                query=rag_query,
                db=db,
                funder=grant.funder,
                top_k=8,
                current_grant_id=str(grant.id),
            )
        except Exception:
            content_similar = []
        yield _sse({
            "event": "archive_retrieval_complete",
            "templates": len(structure_templates),
            "similar": len(content_similar),
        })

        # ── Stage 2: Call Strategy ─────────────────────────────────────────────
        yield _sse({"event": "call_strategy_start"})
        call_strategy: dict = {}
        if call_analysis:
            try:
                call_strategy = await build_call_strategy(
                    call_analysis=call_analysis,
                    call_requirements_text=grant.call_requirements or "",
                    funder=grant.funder or "",
                    opportunity_title=grant.title or "",
                    grant_type_context=grant_type_context,
                )
            except Exception:
                pass
        yield _sse({"event": "call_strategy_complete"})

        # ── Stage 3: Idea Alignment ────────────────────────────────────────────
        yield _sse({"event": "idea_alignment_start"})
        aligned_concept: dict = {}
        if grant.grant_idea and call_strategy:
            try:
                aligned_concept = await align_idea_to_call(
                    grant_idea=grant.grant_idea,
                    call_strategy=call_strategy,
                    narrative_brief=call_analysis.get("narrative_brief", ""),
                    funder=grant.funder or "",
                    opportunity_title=grant.title or "",
                    section_blueprint=section_blueprint or None,
                )
            except Exception:
                pass
        yield _sse({"event": "idea_alignment_complete"})

        # ── Stage 0: Document constraints (extract → verify → allocate → align) ───
        call_analysis = grant.call_analysis or {}
        document_constraints: dict = {}
        yield _sse({"event": "constraints_extraction_start"})
        try:
            document_constraints = await build_document_constraints(
                call_requirements=grant.call_requirements or "",
                call_analysis=call_analysis,
                call_intelligence=call_intelligence,
                grant_idea=grant.grant_idea or "",
                aligned_concept=aligned_concept or None,
                user_section_constraints=user_section_constraints,
                user_total_word_limit=user_total_word_limit,
                user_total_page_limit=user_total_page_limit,
                funder=grant.funder or "",
                title=grant.title or "",
            )
            grant.document_constraints = document_constraints
            await db.commit()
            yield _sse({
                "event": "constraints_verified",
                "confidence": document_constraints.get("confidence"),
            })
            yield _sse({
                "event": "constraints_allocated",
                "total_word_limit": document_constraints.get("total_word_limit"),
                "section_count": len(document_constraints.get("sections") or []),
            })
        except Exception as exc:
            yield _sse({"event": "constraints_error", "error": str(exc)[:300]})
            document_constraints = grant.document_constraints or {}

        # Entity anchor RAG for skeleton (named programs in idea)
        skeleton_concept_rag: dict[str, list] = {}
        try:
            from app.ai.rag.retriever import retrieve_for_concept
            sk_concepts = extract_concepts(grant.grant_idea or "", [])
            if sk_concepts:
                sk_results = await asyncio.gather(
                    *[retrieve_for_concept(c, db, grant.funder, str(grant.id)) for c in sk_concepts[:6]],
                    return_exceptions=True,
                )
                for c, r in zip(sk_concepts[:6], sk_results):
                    if isinstance(r, list) and r:
                        skeleton_concept_rag[c] = r
                if skeleton_concept_rag:
                    ci_tmp = grant.call_intelligence or {}
                    ci_tmp["skeleton_concept_rag"] = {k: len(v) for k, v in skeleton_concept_rag.items()}
                    grant.call_intelligence = ci_tmp
        except Exception:
            pass



        # ── Stage 3.5: Skeleton Planning — per-section research plan ──────────────
        yield _sse({"event": "skeleton_planning_start"})
        section_research_plan: dict = {}
        try:
            section_research_plan = await plan_skeleton_research(
                opportunity_title=grant.title or "",
                funder=grant.funder or "",
                grant_idea=grant.grant_idea or "",
                call_analysis=call_analysis,
                call_strategy=call_strategy or {},
                aligned_concept=aligned_concept or {},
                call_intelligence=call_intelligence or {},
                section_constraints=user_section_constraints,
            )
        except Exception:
            pass  # planning is best-effort; pipeline continues without it
        planned_sections: list[dict] = section_research_plan.get("sections") or []
        yield _sse({
            "event": "skeleton_planning_complete",
            "planned_sections": len(planned_sections),
        })

        # ── Stage 4: Parallel Per-Section Research ──────────────────────────────
        # For each planned section: HyDE-enhanced archive RAG + Tavily web + academic citations
        yield _sse({"event": "skeleton_research_start", "total": len(planned_sections)})
        section_evidence_bundles: dict[str, dict] = {}

        if planned_sections:
            semaphore = asyncio.Semaphore(4)  # max 4 concurrent research tasks

            async def _research_one(section_brief: dict) -> tuple[str, dict]:
                section_name = section_brief.get("section_name") or "Unknown"
                async with semaphore:
                    # HyDE: generate hypothetical excerpt then embed for archive retrieval
                    hyde_prompt = section_brief.get("hyde_prompt") or (
                        f"Write a 120-word excerpt from the {section_name} section of "
                        f"a competitive grant proposal about {grant.title}. "
                        "Include specific methods, outcomes, and evidence."
                    )
                    try:
                        hyde_results = await retrieve_with_hyde(
                            hyde_prompt=hyde_prompt,
                            db=db,
                            funder=grant.funder or None,
                            section_type=section_brief.get("section_type"),
                            top_k=5,
                            current_grant_id=str(grant.id),
                        )
                    except Exception:
                        hyde_results = []

                    # Web + academic + RAG synthesis using existing research_agent
                    idea_excerpt = section_brief.get("idea_excerpt") or grant.grant_idea or ""
                    try:
                        evidence = await gather_section_evidence(
                            section_name=section_name,
                            section_content=idea_excerpt[:800],
                            section_brief=section_brief,
                            db=db,
                            funder=grant.funder or "",
                            section_type=section_brief.get("section_type") or "other",
                            rag_content_exemplars=hyde_results,
                        )
                    except Exception:
                        evidence = {"rag_content_exemplars": hyde_results}

                    return section_name, evidence

            research_tasks = [_research_one(s) for s in planned_sections]
            research_results = await asyncio.gather(*research_tasks, return_exceptions=True)

            for result in research_results:
                if isinstance(result, Exception):
                    continue
                sec_name, evidence = result
                section_evidence_bundles[sec_name] = evidence

        yield _sse({
            "event": "skeleton_research_complete",
            "researched": len(section_evidence_bundles),
        })

        # ── Stage 5: Evidence-Grounded Skeleton Synthesis ─────────────────────
        yield _sse({"event": "skeleton_synthesis_start"})
        try:
            # Build enriched call_requirements text from strategy
            enriched_requirements = self._build_enriched_requirements(
                grant.call_requirements or "",
                call_strategy,
                aligned_concept,
                call_analysis,
            )

            section_constraints, total_word_limit, total_page_limit = (
                self._resolve_section_constraints(
                    call_analysis,
                    user_section_constraints,
                    user_total_word_limit,
                    user_total_page_limit,
                    document_constraints=document_constraints,
                )
            )

            skeleton = await generate_proposal_outline(
                opportunity_title=grant.title,
                call_analysis=call_analysis,
                similar_grants=content_similar,
                structure_templates=structure_templates,
                # Pass BOTH aligned framing and full idea so the architect has specificity
                grant_idea=grant.grant_idea or "",
                aligned_framing=aligned_concept.get("aligned_framing") if aligned_concept else None,
                style_profile=grant.style_profile or {},
                call_requirements_text=enriched_requirements,
                external_deadline=str(grant.external_deadline) if grant.external_deadline else "",
                internal_deadline=str(grant.internal_deadline) if grant.internal_deadline else "",
                call_strategy=call_strategy,
                aligned_concept=aligned_concept,
                section_constraints=section_constraints,
                total_word_limit=total_word_limit,
                total_page_limit=total_page_limit,
                call_intelligence=call_intelligence or None,
                section_evidence_bundles=section_evidence_bundles or None,
            )
        except Exception as exc:
            yield _sse({"event": "skeleton_error", "error": str(exc)[:500]})
            return

        # ── Enforce locked document constraints on skeleton output ─────────────
        if document_constraints:
            try:
                skeleton = enforce_skeleton_constraints(skeleton, document_constraints)
            except Exception:
                pass

        # ── Stage 6: Adversarial Alignment Review ──────────────────────────────
        try:
            review = await review_skeleton(
                skeleton_text=skeleton.get("raw_text") or "",
                call_requirements=grant.call_requirements or "",
                call_analysis=call_analysis,
                call_strategy=call_strategy or {},
                grant_idea=grant.grant_idea or "",
                document_constraints=document_constraints,
            )
            skeleton["review"] = review
            if document_constraints:
                constraints_audit = audit_constraints_compliance(
                    document_constraints, skeleton
                )
                skeleton["constraints_audit"] = constraints_audit
                if constraints_audit.get("issues"):
                    review.setdefault("compliance_gaps", [])
                    for issue in constraints_audit["issues"][:5]:
                        if issue not in review["compliance_gaps"]:
                            review["compliance_gaps"].append(f"[Constraints] {issue}")
            # Surface compliance gaps and weak sections as top-level fields
            if review.get("compliance_gaps"):
                skeleton["compliance_gaps"] = review["compliance_gaps"]
            if review.get("weak_sections"):
                existing_flags = skeleton.get("flagged_sections") or []
                merged = list({*existing_flags, *review["weak_sections"]})
                skeleton["flagged_sections"] = merged
            if review.get("alignment_score") is not None:
                skeleton["alignment_score"] = review["alignment_score"]
        except Exception:
            pass  # review is best-effort; never blocks skeleton delivery

        # ── TBD scan + RAG fill ────────────────────────────────────────────────
        try:
            skeleton = await _scan_and_fill_tbds(skeleton, db, grant.funder or "")
        except Exception:
            pass  # TBD filling is best-effort; never block skeleton delivery

        grant.proposal_skeleton = skeleton
        grant.writing_phase = "skeleton"
        if call_strategy:
            grant.call_strategy = call_strategy
        if aligned_concept:
            grant.aligned_concept = aligned_concept
        if document_constraints:
            grant.document_constraints = document_constraints
        await db.commit()

        yield _sse({"event": "skeleton_complete", "proposal_skeleton": skeleton})

    def _build_enriched_requirements(
        self,
        base_requirements: str,
        call_strategy: dict,
        aligned_concept: dict,
        call_analysis: dict,
    ) -> str:
        """Build an enriched requirements string from strategy + alignment + base."""
        parts = []

        if base_requirements:
            parts.append(base_requirements[:2000])

        if call_strategy.get("must_demonstrate"):
            parts.append(
                "MUST DEMONSTRATE:\n" + "\n".join(f"- {d}" for d in call_strategy["must_demonstrate"])
            )

        if call_strategy.get("winning_differentiators"):
            parts.append(
                "WINNING DIFFERENTIATORS:\n" + "\n".join(f"- {d}" for d in call_strategy["winning_differentiators"])
            )

        if aligned_concept.get("gaps_to_address"):
            parts.append(
                "GAPS TO ADDRESS:\n" + "\n".join(f"- {g}" for g in aligned_concept["gaps_to_address"])
            )

        if aligned_concept.get("emphasis_areas"):
            emphasis_lines = []
            for ea in aligned_concept["emphasis_areas"][:5]:
                if isinstance(ea, dict):
                    emphasis_lines.append(f"- {ea.get('section', '')}: {ea.get('emphasis', '')}")
            if emphasis_lines:
                parts.append("SECTION EMPHASIS:\n" + "\n".join(emphasis_lines))

        if call_analysis.get("section_requirements"):
            sec_reqs = call_analysis["section_requirements"]
            req_lines = []
            for sec, details in list(sec_reqs.items())[:8]:
                if isinstance(details, dict):
                    asks = details.get("key_asks", [])
                    if asks:
                        req_lines.append(f"- {sec}: {'; '.join(asks[:3])}")
            if req_lines:
                parts.append("KEY SECTION ASKS:\n" + "\n".join(req_lines))

        return "\n\n".join(parts)

    def _resolve_section_constraints(
        self,
        call_analysis: dict,
        user_section_constraints: list[dict] | None,
        user_total_word_limit: int | None,
        user_total_page_limit: str | None,
        document_constraints: dict | None = None,
    ) -> tuple[list[dict], int | None, str | None]:
        """Resolve section constraints; document_constraints (Stage 0) is authoritative when present."""
        dc = document_constraints or {}
        if dc.get("sections"):
            from app.ai.services.document_constraints_builder import merge_user_section_overrides

            sections, tw, tp = merge_user_section_overrides(
                dc["sections"],
                user_section_constraints,
                user_total_word_limit or dc.get("total_word_limit"),
                user_total_page_limit or dc.get("total_page_limit"),
            )
            return sections, tw, tp

        if user_section_constraints:
            return (
                user_section_constraints,
                user_total_word_limit,
                user_total_page_limit,
            )

        section_reqs = call_analysis.get("section_requirements", {})
        section_constraints = []
        for i, (sec_name, details) in enumerate(section_reqs.items()):
            if not isinstance(details, dict):
                continue
            section_constraints.append({
                "name": sec_name,
                "word_limit": details.get("word_limit"),
                "page_limit": details.get("page_limit"),
                "priority": details.get("priority", "medium"),
                "order": i + 1,
            })

        total_word_limit = _parse_int_limit(call_analysis.get("word_limit"))
        total_page_limit = call_analysis.get("page_limit") or None

        return section_constraints, total_word_limit, total_page_limit

    async def generate_draft_stream(
        self,
        grant: ActiveGrant,
        db: AsyncSession,
        flagged_sections: list[str] | None = None,
    ) -> AsyncIterator[str]:
        """
        Adaptive Draft Orchestration (ADO) pipeline.
        Delegates to run_adaptive_draft_stream for meta-orchestrated, routed drafting.
        """
        async for chunk in run_adaptive_draft_stream(
            grant,
            db,
            flagged_sections,
            sse=_sse,
            parse_raw_sections=_parse_raw_text_sections,
        ):
            yield chunk


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
        """Format call analysis as a comprehensive text block for agent context.

        The narrative_brief is used as the primary content; structured fields follow
        for downstream agents (skeleton, drafter, compliance checker).
        """
        parts = []

        if analysis.get("narrative_brief"):
            parts.append(f"CALL BRIEF:\n{analysis['narrative_brief']}")
        elif analysis.get("summary"):
            parts.append(f"SUMMARY: {analysis['summary']}")

        for field, label in [
            ("call_background", "BACKGROUND & CONTEXT"),
            ("requirements_overview", "WHAT THEY ARE LOOKING FOR"),
            ("funder_priorities", "FUNDER PRIORITIES"),
            ("strategic_objectives", "STRATEGIC OBJECTIVES"),
        ]:
            if analysis.get(field) and isinstance(analysis[field], list):
                parts.append(f"{label}:\n" + "\n".join(f"- {item}" for item in analysis[field]))

        if analysis.get("key_focus_areas") and isinstance(analysis["key_focus_areas"], list):
            lines = ["KEY FOCUS AREAS:"]
            for area in analysis["key_focus_areas"]:
                if isinstance(area, dict):
                    lines.append(f"- {area.get('area', '?')}: {area.get('description', '')}")
            parts.append("\n".join(lines))

        if analysis.get("evaluation_criteria"):
            parts.append("EVALUATION CRITERIA:\n" + "\n".join(f"- {c}" for c in analysis["evaluation_criteria"]))

        if analysis.get("required_sections"):
            parts.append("REQUIRED SECTIONS:\n" + "\n".join(f"- {s}" for s in analysis["required_sections"]))

        if analysis.get("section_requirements"):
            sec_lines = ["SECTION REQUIREMENTS:"]
            for sec_name, sec_data in analysis["section_requirements"].items():
                if not isinstance(sec_data, dict):
                    continue
                priority = (sec_data.get("priority") or "").upper()
                word_limit = sec_data.get("word_limit") or sec_data.get("page_limit")
                limit_str = f" | {word_limit} words" if word_limit else ""
                sec_lines.append(f"\n§ {sec_name}  [{priority}{limit_str}]")
                if sec_data.get("requirements"):
                    sec_lines.append(f"  Requirements: {sec_data['requirements']}")
                if sec_data.get("key_asks"):
                    sec_lines.append("  Funder specifically asks for:")
                    for ask in sec_data["key_asks"]:
                        sec_lines.append(f"    - {ask}")
                if sec_data.get("questions_to_address"):
                    sec_lines.append("  Questions this section must answer:")
                    for q in sec_data["questions_to_address"]:
                        sec_lines.append(f"    - {q}")
                if sec_data.get("evidence_needed"):
                    sec_lines.append("  Evidence needed:")
                    for e in sec_data["evidence_needed"]:
                        sec_lines.append(f"    - {e}")
            parts.append("\n".join(sec_lines))

        if analysis.get("budget_constraints"):
            parts.append(f"BUDGET CONSTRAINTS: {analysis['budget_constraints']}")

        if analysis.get("deadlines"):
            dl = analysis["deadlines"]
            if isinstance(dl, dict):
                dl_lines = [f"  {k}: {v}" for k, v in dl.items() if v]
                if dl_lines:
                    parts.append("DEADLINES:\n" + "\n".join(dl_lines))
            else:
                parts.append(f"DEADLINES: {dl}")

        if analysis.get("eligibility_checklist"):
            critical = [
                item for item in analysis["eligibility_checklist"]
                if isinstance(item, dict) and item.get("critical")
            ]
            if critical:
                lines = [f"  - {item.get('item', '')} [{item.get('notes', '')}]" for item in critical]
                parts.append("CRITICAL ELIGIBILITY REQUIREMENTS:\n" + "\n".join(lines))

        for field, label in [
            ("word_limit", "WORD LIMIT"),
            ("page_limit", "PAGE LIMIT"),
            ("award_amount", "AWARD AMOUNT"),
            ("project_duration", "PROJECT DURATION"),
            ("geographic_eligibility", "GEOGRAPHIC ELIGIBILITY"),
            ("required_partners", "PARTNERSHIP REQUIREMENTS"),
            ("format_requirements", "FORMAT REQUIREMENTS"),
            ("submission_portal", "SUBMISSION PORTAL"),
            ("foa_number", "FOA/REFERENCE NUMBER"),
            ("contact_info", "CONTACT INFO"),
        ]:
            if analysis.get(field):
                parts.append(f"{label}: {analysis[field]}")

        if analysis.get("risks"):
            parts.append("RISKS & CONCERNS:\n" + "\n".join(f"- {r}" for r in analysis["risks"]))

        if analysis.get("missing_information"):
            parts.append("MISSING INFORMATION (to find out):\n" + "\n".join(f"- {m}" for m in analysis["missing_information"]))

        return "\n\n".join(parts)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _scan_and_fill_tbds(
    skeleton: dict,
    db: AsyncSession,
    funder: str,
) -> dict:
    """
    Scan skeleton raw_text for [TBD: ...] markers.
    Attempt to fill each with RAG-retrieved reusable language (similarity > 0.7).
    Remaining unfilled TBDs are collected into skeleton["flagged_sections"].
    """
    import re

    raw_text: str = skeleton.get("raw_text") or ""
    if not raw_text:
        return skeleton

    # Find all TBD markers with surrounding context (15 words either side)
    tbd_pattern = re.compile(r"\[TBD:[^\]]*\]")
    matches = list(tbd_pattern.finditer(raw_text))
    if not matches:
        skeleton["flagged_sections"] = []
        return skeleton

    filled_count = 0
    flagged: list[str] = []
    modified_text = raw_text

    for match in reversed(matches):  # reverse so offsets stay valid
        tbd_token = match.group(0)
        start = max(0, match.start() - 80)
        end = min(len(raw_text), match.end() + 80)
        context = raw_text[start:end].strip()

        try:
            candidates = await retrieve_reusable_language(
                query=context,
                db=db,
                section_type="other",
                top_k=1,
            )
        except Exception:
            candidates = []

        if candidates:
            candidate = candidates[0]
            similarity = candidate.get("similarity") or 0.0
            snippet = (candidate.get("full_text") or "")[:300].strip()
            if similarity >= 0.70 and snippet:
                modified_text = modified_text[:match.start()] + snippet + modified_text[match.end():]
                filled_count += 1
                continue

        # Could not fill — find which section this TBD is in
        section_heading = ""
        for line in raw_text[:match.start()].splitlines():
            if line.startswith("## "):
                section_heading = line[3:].strip()
        if section_heading and section_heading not in flagged:
            flagged.append(section_heading)

    if filled_count > 0:
        skeleton["raw_text"] = modified_text

    skeleton["flagged_sections"] = flagged
    skeleton["tbd_count"] = len(matches)
    skeleton["tbd_filled_count"] = filled_count
    return skeleton


def _parse_int_limit(value) -> int | None:
    """Parse a word/page limit value that may be a string like '15,000 words' or an int."""
    if value is None:
        return None
    if isinstance(value, int):
        return value
    import re
    match = re.search(r"[\d,]+", str(value))
    if match:
        try:
            return int(match.group(0).replace(",", ""))
        except ValueError:
            pass
    return None


def _parse_raw_text_sections(raw_text: str) -> list[dict]:
    """
    Parse markdown-style ## headings from raw_text into skeleton section dicts.
    Used as a fallback when proposal_skeleton.sections is empty but raw_text exists.
    """
    sections: list[dict] = []
    current_name: str | None = None
    current_lines: list[str] = []

    for line in raw_text.splitlines():
        if line.startswith("## "):
            if current_name is not None:
                sections.append({
                    "name": current_name,
                    "type": "other",
                    "content": "\n".join(current_lines).strip(),
                    "requirements": "",
                    "word_limit": None,
                    "priority": "medium",
                    "order": len(sections),
                })
            current_name = line[3:].strip()
            current_lines = []
        else:
            if current_name is not None:
                current_lines.append(line)

    if current_name is not None:
        sections.append({
            "name": current_name,
            "type": "other",
            "content": "\n".join(current_lines).strip(),
            "requirements": "",
            "word_limit": None,
            "priority": "medium",
            "order": len(sections),
        })

    if not sections and raw_text.strip():
        sections = [{
            "name": "Full Proposal",
            "type": "other",
            "content": raw_text,
            "requirements": "",
            "word_limit": None,
            "priority": "high",
            "order": 0,
        }]

    return sections

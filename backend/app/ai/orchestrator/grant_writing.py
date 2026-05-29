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

        # ── Read call_intelligence (may still be running, graceful fallback) ──────────
        call_intelligence: dict = grant.call_intelligence or {}
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

            # Resolve section constraints: user overrides take precedence, fall back to call_analysis
            section_constraints, total_word_limit, total_page_limit = (
                self._resolve_section_constraints(
                    call_analysis,
                    user_section_constraints,
                    user_total_word_limit,
                    user_total_page_limit,
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

        # ── Stage 6: Adversarial Alignment Review ──────────────────────────────
        try:
            review = await review_skeleton(
                skeleton_text=skeleton.get("raw_text") or "",
                call_requirements=grant.call_requirements or "",
                call_analysis=call_analysis,
                call_strategy=call_strategy or {},
                grant_idea=grant.grant_idea or "",
            )
            skeleton["review"] = review
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
        # Persist strategy context so the draft pipeline can use it without re-computing
        if call_strategy:
            grant.call_strategy = call_strategy
        if aligned_concept:
            grant.aligned_concept = aligned_concept
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
    ) -> tuple[list[dict], int | None, str | None]:
        """Resolve section constraints with user overrides taking precedence over call_analysis."""
        # User-provided constraints win over auto-extracted ones
        if user_section_constraints:
            return (
                user_section_constraints,
                user_total_word_limit,
                user_total_page_limit,
            )

        # Auto-extract from call_analysis.section_requirements
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

        # Parse document-level limits from call_analysis
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
        Agentic SSE stream — five phases:
          1.  Planning:          PlanningAgent + call_strategy/aligned_concept context
          1.5 Concept extraction: Extract named concepts → proactive RAG pre-fetch
          2.  Research:          ResearchAgent per section (parallel, semaphore 4)
          3.  Drafting:          SectionDrafter / IntroArchitect with strategy + concept context
          4.  Assembly:          Meta-agent quality loop → coherence + compliance + word count warnings
          5.  Bibliography:      Collect all citations → APA References section
        """
        skeleton = grant.proposal_skeleton or {}
        all_sections = skeleton.get("sections") or []

        # Fall back to raw_text if sections array is empty (legacy / raw-edit skeletons)
        if not all_sections and skeleton.get("raw_text"):
            all_sections = _parse_raw_text_sections(skeleton["raw_text"])

        if not all_sections:
            yield _sse({"error": "No skeleton sections found. Generate skeleton first."})
            return

        # If specific sections were flagged, draft those first then append the rest
        flagged_set = set(flagged_sections or skeleton.get("flagged_sections") or [])
        if flagged_set:
            priority_secs = [s for s in all_sections if (s.get("name") or s.get("title")) in flagged_set]
            rest_secs = [s for s in all_sections if (s.get("name") or s.get("title")) not in flagged_set]
            sections = priority_secs + rest_secs
        else:
            sections = all_sections

        # Initialise document HTML scaffold
        html = skeleton_to_html(skeleton)
        grant.editor_document = html
        grant.writing_phase = "draft"
        await db.commit()

        eval_criteria = (grant.call_analysis or {}).get("evaluation_criteria", [])
        call_req = grant.call_requirements or ""
        call_narrative_brief = (grant.call_analysis or {}).get("narrative_brief", "")
        section_requirements_map = (grant.call_analysis or {}).get("section_requirements") or {}
        required_sections = (grant.call_analysis or {}).get("required_sections") or []

        # Load persisted call strategy and aligned concept (saved during skeleton phase)
        call_strategy: dict = grant.call_strategy or {}
        aligned_concept: dict = grant.aligned_concept or {}

        # Build per-section strategy and emphasis maps from the call strategy
        strategy_section_map: dict[str, str] = call_strategy.get("section_strategy") or {}
        emphasis_areas_list: list[dict] = aligned_concept.get("emphasis_areas") or []
        emphasis_map: dict[str, str] = {
            ea.get("section", ""): ea.get("emphasis", "")
            for ea in emphasis_areas_list
            if isinstance(ea, dict) and ea.get("section")
        }

        # ── Phase 1: Planning ──────────────────────────────────────────────────
        yield _sse({"event": "planning_start", "total": len(sections)})
        try:
            plan = await plan_draft_research(
                opportunity_title=grant.title,
                funder=grant.funder or "",
                grant_idea=grant.grant_idea or "",
                skeleton_sections=sections,
                call_requirements=call_req,
                flagged_section_names=list(flagged_set) if flagged_set else None,
                call_strategy=call_strategy or None,
                aligned_concept=aligned_concept or None,
            )
        except Exception:
            plan = {"narrative_context": {}, "section_briefs": []}

        narrative_context = plan.get("narrative_context") or {}
        section_briefs_map: dict[str, dict] = {
            b.get("section_name", ""): b
            for b in plan.get("section_briefs", [])
            if b.get("section_name")
        }
        yield _sse({"event": "planning_complete", "total": len(sections)})

        # ── Phase 1.5: Concept extraction + proactive RAG pre-fetch ───────────
        # Enrich concept list with call thematic areas from call_intelligence
        ci = grant.call_intelligence or {}
        ci_per_section_guide: dict[str, str] = ci.get("per_section_writing_guide") or {}
        theme_terms: list[str] = (grant.call_analysis or {}).get("thematic_areas") or []
        base_concepts = extract_concepts(grant.grant_idea or "", sections)
        concepts = list(dict.fromkeys(base_concepts + theme_terms[:5]))[:12]
        concept_rag_map: dict[str, list[dict]] = {}
        if concepts:
            yield _sse({"event": "concept_extraction", "concepts": concepts[:8]})
            try:
                concept_rag_results = await asyncio.gather(
                    *[
                        retrieve_content_exemplars(
                            query=concept,
                            db=db,
                            funder=grant.funder,
                            top_k=3,
                            current_grant_id=str(grant.id),
                        )
                        for concept in concepts[:8]
                    ],
                    return_exceptions=True,
                )
                for concept, result in zip(concepts[:8], concept_rag_results):
                    if isinstance(result, list) and result:
                        concept_rag_map[concept] = result
            except Exception:
                pass

        # ── Phase 2: Research (parallel) ───────────────────────────────────────
        yield _sse({"event": "research_start", "total": len(sections)})

        async def _research_section(sec: dict) -> tuple[dict, dict]:
            name = sec.get("name") or sec.get("title") or "Section"
            sec_type = sec.get("type") or "other"
            brief = section_briefs_map.get(name) or {}
            content = sec.get("content") or ""

            # Enrich RAG query with the section's call-specific writing guide snippet
            section_guide = ci_per_section_guide.get(name, "")
            rag_query = f"{name} {content[:100]} {section_guide[:80]} {grant.grant_idea or ''}".strip()

            async with _RESEARCH_SEMAPHORE:
                style_exemplars, content_exemplars, reusable = await asyncio.gather(
                    retrieve_style_exemplars(db=db, section_type=sec_type, funder=grant.funder, top_k=3),
                    retrieve_content_exemplars(
                        query=rag_query,
                        db=db,
                        section_type=sec_type,
                        funder=grant.funder,
                        top_k=4,
                        current_grant_id=str(grant.id),
                    ),
                    retrieve_reusable_language(
                        query=(sec.get("requirements") or call_req)[:300],
                        db=db,
                        section_type=sec_type,
                        top_k=3,
                    ),
                    return_exceptions=True,
                )

                evidence_bundle = await gather_section_evidence(
                    section_name=name,
                    section_content=content,
                    section_brief=brief,
                    db=db,
                    funder=grant.funder or "",
                    section_type=sec_type,
                    rag_style_exemplars=style_exemplars if isinstance(style_exemplars, list) else [],
                    rag_content_exemplars=content_exemplars if isinstance(content_exemplars, list) else [],
                    rag_reusable_language=reusable if isinstance(reusable, list) else [],
                )
            return sec, evidence_bundle

        research_tasks = [_research_section(sec) for sec in sections]
        research_results = await asyncio.gather(*research_tasks, return_exceptions=True)
        # Map section name → (sec dict, evidence_bundle)
        section_evidence_map: dict[str, tuple[dict, dict]] = {}
        for res in research_results:
            if isinstance(res, Exception):
                continue
            sec, evidence_bundle = res
            name = sec.get("name") or sec.get("title") or "Section"
            section_evidence_map[name] = (sec, evidence_bundle)

        yield _sse({"event": "research_complete", "total": len(sections)})

        # ── Phase 3: Draft (parallel) ──────────────────────────────────────────
        word_count_warnings: list[dict] = []
        all_draft_results: list[dict] = []

        def _get_concept_bundles_for_section(section_content: str) -> list[dict]:
            """Find concept RAG bundles whose concept appears in this section's text."""
            bundles = []
            content_upper = section_content.upper()
            for concept, rag_docs in concept_rag_map.items():
                if concept.upper() in content_upper:
                    bundles.extend(rag_docs)
            return bundles[:6]

        async def _draft_section_task(sec: dict, idx: int) -> tuple[int, str, dict]:
            name = sec.get("name") or sec.get("title") or f"Section {idx + 1}"
            sec_type = sec.get("type") or "other"
            name_lower = name.lower()
            sec_type_lower = sec_type.lower()
            is_intro = any(k in name_lower or k in sec_type_lower for k in INTRO_KEYWORDS)

            sec_bundle_tuple = section_evidence_map.get(name)
            evidence_bundle: dict = sec_bundle_tuple[1] if sec_bundle_tuple else {}

            skeleton_content = sec.get("content") or ""
            compliance_guidance = sec.get("requirements") or ""
            evidence_summary = evidence_bundle.get("summary_for_drafter", "")
            suggested_citations = (
                evidence_bundle.get("suggested_citations", [])
                + [r.get("formatted_citation", "") for r in evidence_bundle.get("academic_results", [])[:4]]
            )
            rag_style = evidence_bundle.get("rag_style_exemplars") or []
            rag_content = evidence_bundle.get("rag_content_exemplars") or []
            rag_reusable = evidence_bundle.get("rag_reusable_language") or []

            word_limit = sec.get("word_limit")
            sec_specific_req = (
                section_requirements_map.get(name)
                or section_requirements_map.get(name.lower())
                or sec.get("section_requirements")
            )
            if isinstance(sec_specific_req, dict):
                word_limit = sec_specific_req.get("word_limit") or word_limit

            # Format citations for agent
            all_citations = [{"formatted_citation": c} for c in suggested_citations if c]

            # Per-section strategy + alignment context
            strategic_guidance = (
                strategy_section_map.get(name)
                or strategy_section_map.get(name.lower())
                or ""
            )
            emphasis_direction = (
                emphasis_map.get(name)
                or emphasis_map.get(name.lower())
                or ""
            )
            # Concept bundles: archive docs for concepts mentioned in this section
            concept_bundles = _get_concept_bundles_for_section(skeleton_content)

            # Per-section writing instructions from call_intelligence
            writing_instructions = ci_per_section_guide.get(name) or ci_per_section_guide.get(name.lower()) or ""

            async with _DRAFT_SEMAPHORE:
                if is_intro:
                    result = await draft_introduction(
                        grant_idea=grant.grant_idea or "",
                        call_requirements=compliance_guidance or call_req,
                        evaluation_criteria=eval_criteria,
                        intro_arc=sec.get("intro_arc"),
                        style_profile=grant.style_profile,
                        style_exemplars=rag_style,
                        retrieved_sections=rag_content,
                        citations=all_citations,
                        funder=grant.funder or "",
                        word_limit=word_limit,
                        skeleton_content=skeleton_content,
                        compliance_guidance=compliance_guidance,
                        evidence_summary=evidence_summary,
                        narrative_context=narrative_context,
                        opening_hook=aligned_concept.get("opening_hook", ""),
                        strategic_framing=call_strategy.get("narrative_framing", ""),
                        concept_bundles=concept_bundles,
                    )
                else:
                    result = await draft_section(
                        section_name=name,
                        section_type=sec_type,
                        call_requirements=compliance_guidance or call_req,
                        evaluation_criteria=eval_criteria,
                        retrieved_sections=rag_content,
                        style_exemplars=rag_style,
                        reusable_language=rag_reusable,
                        word_limit=word_limit,
                        funder=grant.funder or "",
                        style_profile=grant.style_profile,
                        prior_sections_summary="",  # not available in parallel mode
                        citations=all_citations,
                        grant_idea=grant.grant_idea or "",
                        section_specific_requirements=sec_specific_req,
                        call_narrative_brief=call_narrative_brief,
                        skeleton_content=skeleton_content,
                        compliance_guidance=compliance_guidance,
                        evidence_summary=evidence_summary,
                        narrative_context=narrative_context,
                        strategic_guidance=strategic_guidance,
                        emphasis_direction=emphasis_direction,
                        concept_bundles=concept_bundles,
                        writing_instructions=writing_instructions,
                    )

            # Word count check
            actual_wc = result.get("word_count") or len((result.get("draft") or "").split())
            if word_limit and actual_wc > word_limit * 1.1:
                result["_word_count_warning"] = {
                    "section": name,
                    "word_limit": word_limit,
                    "actual": actual_wc,
                    "overage": actual_wc - word_limit,
                }

            return idx, name, result

        draft_tasks = [_draft_section_task(sec, i) for i, sec in enumerate(sections)]

        # Stream section_start events and collect results as they complete
        section_results: dict[int, tuple[str, dict]] = {}
        for i, sec in enumerate(sections):
            name = sec.get("name") or sec.get("title") or f"Section {i + 1}"
            yield _sse({"event": "section_start", "section": name, "index": i, "total": len(sections)})

        completed_drafts = await asyncio.gather(*draft_tasks, return_exceptions=True)
        for res in completed_drafts:
            if isinstance(res, Exception):
                continue
            idx, name, result = res
            section_results[idx] = (name, result)
            all_draft_results.append(result)
            # Collect word count warnings from parallel draft phase
            if result.get("_word_count_warning"):
                word_count_warnings.append(result["_word_count_warning"])
                yield _sse({"event": "section_word_count_warning", **result["_word_count_warning"]})

        # ── Phase 4: Assembly + Meta-Agent Quality Loop (sequential, in order) ──
        all_warnings: list[str] = []
        collected_questions: list[dict] = []
        prior_summary = ""
        final_section_content: dict[str, str] = {}  # section_name → final HTML

        yield _sse({"event": "meta_agent_start", "total": len(sections)})

        for i, sec in enumerate(sections):
            name = sec.get("name") or sec.get("title") or f"Section {i + 1}"
            sec_type = sec.get("type") or "other"

            if i not in section_results:
                continue
            _, result = section_results[i]

            draft_text = result.get("draft", "")
            if draft_text and not draft_text.strip().startswith("<"):
                draft_html = "".join(f"<p>{p.strip()}</p>" for p in draft_text.split("\n\n") if p.strip())
            else:
                draft_html = draft_text

            warnings = result.get("warnings", [])
            all_warnings.extend(warnings)

            # Run meta-agent quality loop on this section
            improved_html = draft_html
            try:
                async for meta_event in evaluate_and_improve_section(
                    section_name=name,
                    section_content=draft_html,
                    section_type=sec_type,
                    prior_sections_summary=prior_summary,
                    call_requirements=call_req,
                    narrative_context=narrative_context,
                    style_profile=grant.style_profile or {},
                    db=db,
                    funder=grant.funder or "",
                    grant_idea=grant.grant_idea or "",
                    max_rounds=3,
                ):
                    event_type = meta_event.get("event", "")
                    if event_type == "meta_agent_accepted":
                        improved_html = meta_event.get("content") or draft_html
                    elif event_type == "meta_agent_question":
                        collected_questions.append(meta_event)
                    yield _sse(meta_event)
            except Exception:
                # Never let meta-agent failure block draft assembly
                pass

            final_section_content[name] = improved_html
            html = insert_section_content(html, name, improved_html)

            # Update prior_summary for next section's coherence context
            plain_snippet = improved_html.replace("<p>", "").replace("</p>", "\n").replace("<br>", "\n")
            prior_summary += f"\n{name}: {plain_snippet[:400]}"

            actual_wc = result.get("word_count", len(draft_text.split()))
            yield _sse({
                "event": "section_complete",
                "section": name,
                "index": i,
                "total": len(sections),
                "word_count": actual_wc,
                "warnings": warnings,
                "human_review_required": result.get("human_review_required", False),
            })

        grant.editor_document = html
        # Store collected questions on the grant for the refine-draft endpoint
        skeleton_with_questions = dict(grant.proposal_skeleton or {})
        if collected_questions:
            skeleton_with_questions["_meta_agent_questions"] = collected_questions
            grant.proposal_skeleton = skeleton_with_questions
        await db.commit()

        # ── Section compliance mapping ─────────────────────────────────────────
        missing_sections: list[str] = []
        if required_sections:
            drafted_names_lower = {(s.get("name") or s.get("title") or "").lower() for s in sections}
            for req in required_sections:
                if not any(req.lower() in dn or dn in req.lower() for dn in drafted_names_lower):
                    missing_sections.append(req)
            yield _sse({
                "event": "section_compliance_map",
                "required": required_sections,
                "drafted": [s.get("name") or s.get("title") for s in sections],
                "missing": missing_sections,
            })

        # ── Narrative coherence check across all sections ─────────────────────
        coherence_result: dict = {}
        try:
            section_dicts = [
                {
                    "name": (sec.get("name") or sec.get("title") or ""),
                    "content": final_section_content.get(sec.get("name") or sec.get("title") or "", ""),
                }
                for sec in sections
            ]
            coherence_result = await check_narrative_coherence(
                sections=section_dicts,
                narrative_context=narrative_context,
                call_requirements=call_req,
                grant_idea=grant.grant_idea or "",
            )
            yield _sse({
                "event": "coherence_check",
                "overall": coherence_result.get("overall", "adequate"),
                "issues": coherence_result.get("issues", [])[:8],
                "strengths": coherence_result.get("strengths", [])[:3],
            })
        except Exception:
            pass

        # ── Compliance pass ───────────────────────────────────────────────────
        compliance_gaps: list[str] = []
        if call_req:
            try:
                plain_text = " ".join(s.plain_text for s in parse_document_sections(html))
                compliance_result = await check_compliance(plain_text, grant.call_analysis or {})
                compliance_gaps = compliance_result.get("recommended_fixes", [])
                yield _sse({
                    "event": "compliance_pass",
                    "status": compliance_result.get("overall_status", "unknown"),
                    "gaps": compliance_gaps[:10],
                })
            except Exception:
                pass

        # ── Phase 5: Bibliography generation ─────────────────────────────────
        yield _sse({"event": "bibliography_start"})
        try:
            bib_result = await generate_bibliography(
                draft_results=all_draft_results,
                use_llm_cleanup=False,
            )
            if bib_result.get("references_html"):
                html = html + "\n" + bib_result["references_html"]
                grant.editor_document = html
                await db.commit()
            yield _sse({
                "event": "bibliography_complete",
                "citation_count": bib_result.get("citation_count", 0),
            })
        except Exception:
            pass

        yield _sse({
            "event": "draft_complete",
            "document_html": html,
            "total_warnings": len(all_warnings),
            "compliance_gaps": compliance_gaps[:5],
            "missing_sections": missing_sections,
            "word_count_warnings": word_count_warnings,
            "agent_questions": collected_questions,
            "agent_questions_count": len(collected_questions),
            "coherence": coherence_result.get("overall", "adequate"),
        })

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

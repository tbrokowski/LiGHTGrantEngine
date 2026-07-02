"""Adaptive draft generation pipeline (ADO)."""
from __future__ import annotations

import asyncio
import os
from typing import AsyncIterator, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.agents.bibliography_generator import generate_bibliography
from app.ai.agents.compliance_checker import check_compliance
from app.ai.agents.concept_extractor import extract_concepts
from app.ai.agents.domain_reviewer import review_section_domain
from app.ai.agents.draft_orchestrator import (
    apply_word_budgets_to_skeleton,
    build_draft_execution_plan,
)
from app.ai.agents.grant_meta_synthesizer import GrantMetaSynthesizer
from app.ai.agents.meta_agent import check_narrative_coherence, evaluate_and_improve_section
from app.ai.agents.planning_agent import plan_draft_research
from app.ai.agents.research_agent import gather_section_evidence
from app.ai.agents.draft_section_context import compress_prior_sections, evidence_coverage_check, build_refinement_feedback
from app.ai.agents.section_length_adjuster import compress_section, expand_section
from app.ai.agents.section_router import draft_section_routed, INTRO_KEYWORDS
from app.ai.agents.section_stitcher import stitch_subsections
from app.ai.agents.subsection_planner import plan_subsections
from app.ai.context.grant_context import insert_section_content, parse_document_sections, skeleton_to_html
from app.ai.rag.retriever import (
    retrieve_content_exemplars,
    retrieve_entity_mentions,
    retrieve_for_concept,
    retrieve_reusable_language,
    retrieve_style_exemplars,
    retrieve_with_hyde,
)
from app.models.active_grant import ActiveGrant

_RESEARCH_SEMAPHORE = asyncio.Semaphore(4)
_DRAFT_SEMAPHORE = asyncio.Semaphore(3)
_SUBSECTION_SEMAPHORE = asyncio.Semaphore(3)
_EXPANSION_WORD_THRESHOLD = 1500


async def wait_for_call_intelligence(grant: ActiveGrant, db: AsyncSession, timeout_sec: int = 60) -> dict:
    """Poll or synthesize call_intelligence before draft."""
    if grant.call_intelligence and grant.call_intelligence.get("section_blueprint"):
        return grant.call_intelligence
    for _ in range(timeout_sec // 2):
        await asyncio.sleep(2)
        await db.refresh(grant)
        if grant.call_intelligence and (grant.call_intelligence.get("section_blueprint") or grant.call_intelligence.get("grant_type_context")):
            return grant.call_intelligence
    try:
        synthesizer = GrantMetaSynthesizer()
        ci = await synthesizer.synthesize(
            call_analysis=grant.call_analysis or {},
            grant_idea=grant.grant_idea or "",
            existing_skeleton=grant.proposal_skeleton or {},
            funder=grant.funder or "",
            title=grant.title or "",
        )
        grant.call_intelligence = ci
        await db.commit()
        return ci
    except Exception:
        return grant.call_intelligence or {}


def _spec_for_section(execution_plan: dict, name: str) -> dict:
    for s in execution_plan.get("sections") or []:
        if s.get("section_name") == name:
            return s
    return {}


def _get_concept_bundles(section_content: str, idea: str, concept_rag_map: dict) -> list[dict]:
    bundles = []
    text_upper = (section_content + " " + idea).upper()
    for concept, docs in concept_rag_map.items():
        if concept.upper() in text_upper:
            bundles.extend(docs)
    return bundles[:8]


async def _gather_entity_and_concept_bundles(
    section_content: str,
    idea: str,
    concept_rag_map: dict,
    must_surface_terms: list[str],
    db: AsyncSession,
    funder: str,
    grant_id: str,
) -> list[dict]:
    """Substring concept match plus mandatory entity RAG for orchestrator terms."""
    seen: set[str] = set()
    bundles: list[dict] = []

    def _add(docs: list[dict]) -> None:
        for d in docs or []:
            key = str(d.get("id") or d.get("title") or d.get("full_text", "")[:80])
            if key not in seen:
                seen.add(key)
                bundles.append(d)

    _add(_get_concept_bundles(section_content, idea, concept_rag_map))
    for term in must_surface_terms or []:
        _add(concept_rag_map.get(term, []))
        if not term:
            continue
        try:
            mentions = await retrieve_entity_mentions(
                entity=term,
                db=db,
                funder=funder,
                top_k=4,
                current_grant_id=grant_id,
            )
            _add(mentions if isinstance(mentions, list) else [])
        except Exception:
            pass
    return bundles[:12]


async def run_adaptive_draft_stream(
    grant: ActiveGrant,
    db: AsyncSession,
    flagged_sections: list[str] | None,
    sse: Callable[[dict], str],
    parse_raw_sections,
) -> AsyncIterator[str]:
    """Full ADO pipeline; yields SSE strings via sse(dict)."""
    skeleton = grant.proposal_skeleton or {}
    all_sections = skeleton.get("sections") or []
    if not all_sections and skeleton.get("raw_text"):
        all_sections = parse_raw_sections(skeleton["raw_text"])
    if not all_sections:
        yield sse({"error": "No skeleton sections found. Generate skeleton first."})
        return
    if not grant.call_analysis:
        yield sse({"error": "Call analysis required before draft. Run call analysis first."})
        return

    flagged_set = set(flagged_sections or skeleton.get("flagged_sections") or [])
    if flagged_set:
        sections = [s for s in all_sections if (s.get("name") or s.get("title")) in flagged_set]
        sections += [s for s in all_sections if (s.get("name") or s.get("title")) not in flagged_set]
    else:
        sections = all_sections

    html = skeleton_to_html(skeleton)
    grant.editor_document = html
    grant.writing_phase = "draft"
    await db.commit()

    call_req = grant.call_requirements or ""
    call_analysis = grant.call_analysis or {}
    eval_criteria = call_analysis.get("evaluation_criteria", [])
    call_narrative_brief = call_analysis.get("narrative_brief", "")
    section_requirements_map = call_analysis.get("section_requirements") or {}
    required_sections = call_analysis.get("required_sections") or []
    call_strategy = grant.call_strategy or {}
    aligned_concept = grant.aligned_concept or {}
    strategy_section_map = call_strategy.get("section_strategy") or {}
    emphasis_map = {
        ea.get("section", ""): ea.get("emphasis", "")
        for ea in (aligned_concept.get("emphasis_areas") or [])
        if isinstance(ea, dict) and ea.get("section")
    }

    # Phase 0: Orchestrator
    yield sse({"event": "orchestrator_start"})
    ci = await wait_for_call_intelligence(grant, db)
    execution_plan = await build_draft_execution_plan(
        opportunity_title=grant.title or "",
        funder=grant.funder or "",
        grant_idea=grant.grant_idea or "",
        call_requirements=call_req,
        call_analysis=call_analysis,
        call_intelligence=ci,
        proposal_skeleton=skeleton,
        call_strategy=call_strategy,
        aligned_concept=aligned_concept,
    )
    grant.draft_execution_plan = execution_plan
    skeleton = apply_word_budgets_to_skeleton(dict(skeleton), execution_plan)
    grant.proposal_skeleton = skeleton
    sections = skeleton.get("sections") or sections
    await db.commit()
    yield sse({
        "event": "orchestrator_complete",
        "alignment_score": execution_plan.get("alignment_score"),
        "alignment_gaps": (execution_plan.get("alignment_gaps") or [])[:5],
        "total_target_words": (execution_plan.get("document_profile") or {}).get("total_target_words"),
    })

    spec_by_name = {s["section_name"]: s for s in (execution_plan.get("sections") or []) if s.get("section_name")}
    meta_sections_set = set(execution_plan.get("use_meta_agent_sections") or [])
    for fn in flagged_set:
        meta_sections_set.add(fn)

    # Phase 1: Planning
    yield sse({"event": "planning_start", "total": len(sections)})
    try:
        plan = await plan_draft_research(
            opportunity_title=grant.title,
            funder=grant.funder or "",
            grant_idea=grant.grant_idea or "",
            skeleton_sections=sections,
            call_requirements=call_req,
            flagged_section_names=list(flagged_set) if flagged_set else None,
            call_strategy=call_strategy,
            aligned_concept=aligned_concept,
            execution_plan=execution_plan,
            section_requirements=section_requirements_map,
        )
    except Exception:
        plan = {"narrative_context": {}, "section_briefs": []}
    narrative_context = plan.get("narrative_context") or {}
    section_briefs_map = {b.get("section_name", ""): b for b in plan.get("section_briefs", []) if b.get("section_name")}
    yield sse({"event": "planning_complete", "total": len(sections)})

    # Entity anchor RAG
    ci_guide = (grant.call_intelligence or {}).get("per_section_writing_guide") or {}
    theme_terms = call_analysis.get("thematic_areas") or []
    concepts = list(dict.fromkeys(extract_concepts(grant.grant_idea or "", sections) + theme_terms[:5]))[:12]
    concept_rag_map: dict[str, list[dict]] = {}
    if concepts:
        yield sse({"event": "concept_extraction", "concepts": concepts[:8]})
        results = await asyncio.gather(
            *[retrieve_for_concept(c, db, grant.funder, str(grant.id)) for c in concepts[:8]],
            return_exceptions=True,
        )
        for concept, result in zip(concepts[:8], results):
            if isinstance(result, list) and result:
                concept_rag_map[concept] = result
        execution_plan["concept_rag_map"] = concept_rag_map
        grant.draft_execution_plan = execution_plan
        await db.commit()

    # Phase 2: Tiered research
    yield sse({"event": "research_start", "total": len(sections)})

    async def _research_section(sec: dict) -> tuple[dict, dict]:
        name = sec.get("name") or sec.get("title") or "Section"
        spec = spec_by_name.get(name) or {}
        tier = spec.get("research_tier") or "standard"
        sec_type = sec.get("type") or "other"
        brief = section_briefs_map.get(name) or {}
        for aq in spec.get("archive_queries") or []:
            brief.setdefault("archive_queries", []).append(aq)
        content = sec.get("content") or ""
        section_guide = ci_guide.get(name, "")

        async with _RESEARCH_SEMAPHORE:
            rag_content: list[dict] = []
            if tier in ("deep", "standard"):
                queries = spec.get("archive_queries") or [name]
                for q in queries[:2]:
                    try:
                        hyde = await retrieve_with_hyde(
                            hyde_prompt=f"Excerpt from {name} section about {q} for {grant.title}",
                            db=db, funder=grant.funder, section_type=sec_type,
                            top_k=4, current_grant_id=str(grant.id),
                        )
                        rag_content.extend(hyde)
                    except Exception:
                        pass
                rag_query = f"{name} {content[:200]} {section_guide[:80]} {grant.grant_idea or ''}"
                try:
                    rag_content.extend(await retrieve_content_exemplars(
                        query=rag_query, db=db, section_type=sec_type,
                        funder=grant.funder, top_k=5, current_grant_id=str(grant.id),
                    ))
                except Exception:
                    pass
            for term in spec.get("must_surface_from_idea") or []:
                rag_content.extend(concept_rag_map.get(term, []))
                try:
                    entity_hits = await retrieve_entity_mentions(
                        entity=term,
                        db=db,
                        funder=grant.funder,
                        top_k=3,
                        current_grant_id=str(grant.id),
                    )
                    if isinstance(entity_hits, list):
                        rag_content.extend(entity_hits)
                except Exception:
                    pass

            style_ex, reusable = [], []
            if tier != "light":
                try:
                    style_ex = await retrieve_style_exemplars(db=db, section_type=sec_type, funder=grant.funder, top_k=3)
                    reusable = await retrieve_reusable_language(
                        query=(sec.get("requirements") or call_req)[:300],
                        db=db, section_type=sec_type, top_k=3,
                    )
                except Exception:
                    pass

            skip_web = tier == "light" or (
                tier == "deep" and rag_content and (rag_content[0].get("relevance_score") or 0) >= 0.75
            )
            if skip_web:
                brief = {**brief, "web_search_queries": [], "academic_search_queries": []}

            evidence = await gather_section_evidence(
                section_name=name, section_content=content, section_brief=brief,
                db=db, funder=grant.funder or "", section_type=sec_type,
                rag_style_exemplars=style_ex if isinstance(style_ex, list) else [],
                rag_content_exemplars=rag_content,
                rag_reusable_language=reusable if isinstance(reusable, list) else [],
            )
        return sec, evidence, len(rag_content), tier

    research_results = await asyncio.gather(*[_research_section(s) for s in sections], return_exceptions=True)
    section_evidence_map: dict[str, tuple[dict, dict]] = {}
    research_coverage: list[dict] = []
    for res in research_results:
        if isinstance(res, Exception):
            continue
        sec, ev, exemplar_count, tier = res
        name = sec.get("name") or sec.get("title") or ""
        section_evidence_map[name] = (sec, ev)
        ke_count = len(ev.get("key_evidence") or [])
        cov = {
            "section": name,
            "research_tier": tier,
            "exemplar_count": exemplar_count,
            "key_evidence_count": ke_count,
            "degraded": tier in ("deep", "standard") and exemplar_count == 0,
        }
        research_coverage.append(cov)
        yield sse({
            "event": "section_evidence_ready",
            "section": name,
            "exemplar_count": exemplar_count,
            "key_evidence_count": ke_count,
            "research_tier": tier,
        })
        if cov["degraded"]:
            yield sse({
                "event": "section_research_degraded",
                "section": name,
                "research_tier": tier,
                "reason": "no_archive_hits",
            })

    execution_plan["research_coverage"] = research_coverage
    grant.draft_execution_plan = execution_plan
    await db.commit()
    yield sse({"event": "research_complete", "total": len(sections), "research_coverage": research_coverage})

    # Phase 3: Routed drafting
    word_count_warnings: list[dict] = []
    under_length: list[dict] = []
    all_draft_results: list[dict] = []
    section_results: dict[int, tuple[str, dict]] = {}
    draft_parallel = os.environ.get("DRAFT_PARALLEL_SECTIONS", "false").lower() in ("1", "true", "yes")

    async def _draft_one(sec: dict, idx: int, prior_summary: str) -> tuple[int, str, dict]:
        name = sec.get("name") or sec.get("title") or f"Section {idx + 1}"
        spec = spec_by_name.get(name) or {}
        agent = spec.get("agent") or sec.get("draft_agent") or "default"
        target_words = spec.get("target_words") or sec.get("word_limit")
        min_words = spec.get("min_words") or (int(target_words * 0.85) if target_words else None)
        expansion = spec.get("expansion_mode") or "single"
        sec_type = sec.get("type") or "other"
        is_intro = any(k in name.lower() for k in INTRO_KEYWORDS)
        _, evidence_bundle = section_evidence_map.get(name, (sec, {}))
        skeleton_content = sec.get("content") or ""
        evidence_summary = evidence_bundle.get("summary_for_drafter", "")
        suggested_citations = evidence_bundle.get("suggested_citations", []) + [
            r.get("formatted_citation", "") for r in evidence_bundle.get("academic_results", [])[:4]
        ]
        concept_bundles = await _gather_entity_and_concept_bundles(
            skeleton_content,
            grant.grant_idea or "",
            concept_rag_map,
            spec.get("must_surface_from_idea") or [],
            db,
            grant.funder or "",
            str(grant.id),
        )
        key_evidence = evidence_bundle.get("key_evidence") or []
        rag_exemplars = evidence_bundle.get("rag_content_exemplars") or []
        archive_exemplars_used = [
            (e.get("title") or e.get("grant_title") or "Archive")[:80]
            for e in rag_exemplars[:4]
        ]
        sec_specific_req = section_requirements_map.get(name) or section_requirements_map.get(name.lower()) or {}
        if isinstance(sec_specific_req, dict) and sec_specific_req.get("word_limit"):
            target_words = target_words or sec_specific_req["word_limit"]
        draft_kwargs = dict(
            grant_idea=grant.grant_idea or "",
            call_requirements=(sec.get("requirements") or call_req),
            evaluation_criteria=eval_criteria,
            retrieved_sections=evidence_bundle.get("rag_content_exemplars") or [],
            style_exemplars=evidence_bundle.get("rag_style_exemplars") or [],
            reusable_language=evidence_bundle.get("rag_reusable_language") or [],
            target_words=target_words,
            min_words=min_words,
            word_limit=target_words,
            funder=grant.funder or "",
            style_profile=grant.style_profile,
            prior_sections_summary=prior_summary,
            citations=[{"formatted_citation": c} for c in suggested_citations if c],
            section_specific_requirements=sec_specific_req,
            call_narrative_brief=call_narrative_brief,
            skeleton_content=skeleton_content,
            compliance_guidance=sec.get("requirements") or "",
            evidence_summary=evidence_summary,
            key_evidence=key_evidence,
            archive_exemplars_used=archive_exemplars_used,
            web_results=evidence_bundle.get("web_results") or [],
            academic_results=evidence_bundle.get("academic_results") or [],
            narrative_context=narrative_context,
            strategic_guidance=strategy_section_map.get(name) or strategy_section_map.get(name.lower()) or "",
            emphasis_direction=emphasis_map.get(name) or emphasis_map.get(name.lower()) or "",
            concept_bundles=concept_bundles,
            writing_instructions=ci_guide.get(name) or ci_guide.get(name.lower()) or "",
            opening_hook=aligned_concept.get("opening_hook", ""),
            strategic_framing=call_strategy.get("narrative_framing", ""),
            section_type=sec_type,
            required_subsections=spec.get("required_subsections"),
            is_intro=is_intro,
        )

        async with _DRAFT_SEMAPHORE:
            if expansion == "hierarchical" and target_words and target_words > _EXPANSION_WORD_THRESHOLD:
                subs = await plan_subsections(name, target_words, skeleton_content, section_briefs_map.get(name) or {}, grant.grant_idea or "")

                async def _draft_sub(sub: dict) -> dict:
                    sub_name = f"{name} — {sub.get('title', 'Part')}"
                    sub_target = sub.get("target_words") or 500
                    sub_spec = {**spec, "target_words": sub_target, "min_words": int(sub_target * 0.85), "expansion_mode": "single"}
                    async with _SUBSECTION_SEMAPHORE:
                        r = await draft_section_routed(agent, sub_name, **{**draft_kwargs, "skeleton_content": sub.get("focus", "") + "\n" + skeleton_content[:2000], "target_words": sub_target, "min_words": int(sub_target * 0.85)})
                    return {"title": sub.get("title"), "draft": r.get("draft", "")}

                sub_drafts = await asyncio.gather(*[_draft_sub(s) for s in subs[:8]], return_exceptions=True)
                valid_subs = [sd for sd in sub_drafts if isinstance(sd, dict)]
                draft_text = await stitch_subsections(name, valid_subs, target_words)
                result = {"draft": draft_text, "word_count": len(draft_text.split()), "warnings": []}
            else:
                result = await draft_section_routed(agent, name, **draft_kwargs)

                # Per-section refinement: one targeted re-draft if coverage check fails
                draft_text_check = result.get("draft", "")
                cov = evidence_coverage_check(
                    draft_text_check,
                    spec.get("must_surface_from_idea"),
                    key_evidence,
                    len(rag_exemplars),
                )
                if not cov["passed"] and cov.get("issues"):
                    feedback = build_refinement_feedback(cov, name)
                    if feedback:
                        try:
                            result = await draft_section_routed(
                                agent, name, **{**draft_kwargs, "refinement_feedback": feedback}
                            )
                        except Exception:
                            result = {"draft": draft_text_check, "word_count": len(draft_text_check.split()), "warnings": []}

        draft_text = result.get("draft", "")
        actual_wc = result.get("word_count") or len(draft_text.split())
        if min_words and actual_wc < min_words:
            try:
                expanded = await expand_section(
                    name, draft_text, target_words or min_words, min_words,
                    grant.grant_idea or "", evidence_summary,
                    key_evidence=key_evidence,
                    retrieved_sections=rag_exemplars,
                )
                result["draft"] = expanded
                actual_wc = len(expanded.split())
                under_length.append({"section": name, "before": result.get("word_count"), "after": actual_wc})
            except Exception:
                under_length.append({"section": name, "actual": actual_wc, "min_words": min_words})
        if target_words and actual_wc > target_words * 1.1:
            try:
                result["draft"] = await compress_section(name, result["draft"], target_words)
                actual_wc = len(result["draft"].split())
            except Exception:
                pass
            word_count_warnings.append({"section": name, "word_limit": target_words, "actual": actual_wc, "overage": actual_wc - target_words})
        result["word_count"] = actual_wc
        return idx, name, result

    ordered_indices = sorted(
        range(len(sections)),
        key=lambda i: sections[i].get("order", i) if sections[i].get("order") is not None else i,
    )

    if draft_parallel:
        for i, sec in enumerate(sections):
            yield sse({"event": "section_start", "section": sec.get("name") or sec.get("title"), "index": i, "total": len(sections)})
        completed = await asyncio.gather(
            *[_draft_one(sec, i, "") for i, sec in enumerate(sections)],
            return_exceptions=True,
        )
        for res in completed:
            if isinstance(res, Exception):
                continue
            idx, name, result = res
            section_results[idx] = (name, result)
            all_draft_results.append(result)
    else:
        sections_done: list[tuple[str, str]] = []
        prior_digest = ""
        for ord_pos, idx in enumerate(ordered_indices):
            sec = sections[idx]
            name = sec.get("name") or sec.get("title") or f"Section {idx + 1}"
            yield sse({"event": "section_start", "section": name, "index": ord_pos, "total": len(sections)})
            try:
                res = await _draft_one(sec, idx, prior_digest)
                if isinstance(res, Exception):
                    continue
                _, name, result = res
                section_results[idx] = (name, result)
                all_draft_results.append(result)
                draft_plain = result.get("draft", "")
                sections_done.append((name, draft_plain))
                prior_digest = await compress_prior_sections(sections_done)
            except Exception:
                continue

    # Phase 4: 3-round critique → refine loop (all sections)
    constraints_issues: list = []
    doc_constraints = getattr(grant, "document_constraints", None) or {}
    audit = doc_constraints.get("audit") or doc_constraints.get("constraints_audit") or {}
    if isinstance(audit, dict):
        constraints_issues = list(audit.get("issues") or audit.get("violations") or [])[:10]
    elif isinstance(audit, list):
        constraints_issues = audit[:10]

    qa_report: dict = {
        "under_length": under_length,
        "domain_reviews": [],
        "meta_sections": [],
        "research_coverage": research_coverage,
        "evidence_coverage": [],
        "constraints_issues": constraints_issues,
        "critique_rounds": 3,
    }
    yield sse({"event": "meta_agent_start", "total": len(sections), "rounds_per_section": 3})
    collected_questions: list[dict] = []
    all_warnings: list[str] = []
    prior_summary = ""
    final_section_content: dict[str, str] = {}

    for i, sec in enumerate(sections):
        name = sec.get("name") or sec.get("title") or f"Section {i + 1}"
        if i not in section_results:
            continue
        _, result = section_results[i]
        draft_text = result.get("draft", "")
        draft_html = draft_text if draft_text.strip().startswith("<") else "".join(
            f"<p>{p.strip()}</p>" for p in draft_text.split("\n\n") if p.strip()
        )
        spec = spec_by_name.get(name) or {}
        domain = spec.get("domain_review")
        if domain:
            try:
                dr = await review_section_domain(name, draft_html, domain, grant.grant_idea or "")
                qa_report["domain_reviews"].append({"section": name, **dr})
            except Exception:
                pass

        # Deterministic pre-check — seeds Round 1 with known issues
        exemplar_count = next(
            (c.get("exemplar_count", 0) for c in research_coverage if c.get("section") == name),
            0,
        )
        _, ev_bundle = section_evidence_map.get(name, (sec, {}))
        pre_cov_check = evidence_coverage_check(
            draft_text,
            spec.get("must_surface_from_idea"),
            ev_bundle.get("key_evidence"),
            exemplar_count,
        )
        initial_issues = pre_cov_check.get("issues") or []

        # 3-round LLM critique → refine loop for every section
        improved_html = draft_html
        try:
            async for meta_event in evaluate_and_improve_section(
                section_name=name,
                section_content=draft_html,
                section_type=sec.get("type") or "other",
                prior_sections_summary=prior_summary,
                call_requirements=call_req,
                narrative_context=narrative_context,
                style_profile=grant.style_profile or {},
                db=db,
                funder=grant.funder or "",
                grant_idea=grant.grant_idea or "",
                max_rounds=3,
                initial_issues=initial_issues,
            ):
                if meta_event.get("event") == "meta_agent_accepted":
                    improved_html = meta_event.get("content") or draft_html
                elif meta_event.get("event") == "meta_agent_question":
                    collected_questions.append(meta_event)
                yield sse(meta_event)
            qa_report["meta_sections"].append(name)
        except Exception:
            pass

        # Re-check evidence coverage on the POST-improvement content — checking
        # draft_text here (before evaluate_and_improve_section runs) would report
        # citation/archive-usage issues the critique loop already fixed.
        post_cov_check = evidence_coverage_check(
            improved_html,
            spec.get("must_surface_from_idea"),
            ev_bundle.get("key_evidence"),
            exemplar_count,
        )
        qa_report["evidence_coverage"].append({"section": name, **post_cov_check})

        final_section_content[name] = improved_html
        html = insert_section_content(html, name, improved_html)
        prior_summary += f"\n{name}: {improved_html[:800]}"
        all_warnings.extend(result.get("warnings", []))
        yield sse({"event": "section_complete", "section": name, "index": i, "total": len(sections), "word_count": result.get("word_count", 0)})

    grant.editor_document = html
    grant.draft_qa_report = qa_report
    if collected_questions:
        sk = dict(grant.proposal_skeleton or {})
        sk["_meta_agent_questions"] = collected_questions
        grant.proposal_skeleton = sk
    await db.commit()

    # Coherence + compliance (fuller context)
    coherence_result: dict = {}
    yield sse({"event": "overview_pass_start", "message": "Running high-level overview pass across assembled proposal…"})
    try:
        section_dicts = [
            {"name": n, "type": next((s.get("type", "other") for s in sections if (s.get("name") or s.get("title")) == n), "other"), "content": c[:3000]}
            for n, c in final_section_content.items()
        ]
        coherence_result = await check_narrative_coherence(
            sections=section_dicts, narrative_context=narrative_context,
            call_requirements=call_req, grant_idea=grant.grant_idea or "",
        )
        yield sse({
            "event": "coherence_check",
            "overall": coherence_result.get("overall", "adequate"),
            "narrative_arc": coherence_result.get("narrative_arc", "adequate"),
            "issues": coherence_result.get("issues", [])[:10],
            "strengths": coherence_result.get("strengths", [])[:5],
            "criteria_coverage": coherence_result.get("criteria_coverage", {}),
            "top_priority_fixes": coherence_result.get("top_priority_fixes", [])[:3],
            "fundability_assessment": coherence_result.get("fundability_assessment", ""),
        })
        qa_report["coherence_result"] = coherence_result
    except Exception:
        pass

    compliance_gaps: list[str] = []
    if call_req:
        try:
            plain_text = " ".join(s.plain_text for s in parse_document_sections(html))
            cr = await check_compliance(plain_text[:50000], call_analysis)
            compliance_gaps = cr.get("recommended_fixes", [])
            yield sse({"event": "compliance_pass", "status": cr.get("overall_status"), "gaps": compliance_gaps[:10]})
        except Exception:
            pass

    # Bibliography
    yield sse({"event": "bibliography_start"})
    try:
        bib = await generate_bibliography(draft_results=all_draft_results, use_llm_cleanup=True)
        if bib.get("references_html"):
            html = html + "\n" + bib["references_html"]
            grant.editor_document = html
            await db.commit()
        yield sse({"event": "bibliography_complete", "citation_count": bib.get("citation_count", 0)})
    except Exception:
        pass

    # Figures (overview if intro exists)
    yield sse({"event": "figures_start"})
    try:
        from app.ai.agents.figure_generator import generate_overview_figure
        has_intro = any(any(k in (s.get("name") or "").lower() for k in INTRO_KEYWORDS) for s in sections)
        if has_intro and not grant.overview_figure_url:
            fig = await generate_overview_figure(
                opportunity_title=grant.title or "",
                grant_idea=grant.grant_idea or "",
                call_analysis=call_analysis,
                call_strategy=call_strategy,
                aligned_concept=aligned_concept,
            )
            if fig.get("image_url"):
                grant.overview_figure_url = fig["image_url"]
                grant.overview_figure_alt = fig.get("alt_text", "Overview figure")
                img_tag = f'<p><img src="{fig["image_url"]}" alt="{grant.overview_figure_alt}" style="max-width:100%"/></p>'
                html = html.replace("</h2>", f"</h2>{img_tag}", 1) if "</h2>" in html else html + img_tag
                grant.editor_document = html
                await db.commit()
        yield sse({"event": "figures_complete"})
    except Exception:
        yield sse({"event": "figures_complete", "skipped": True})

    missing_sections: list[str] = []
    if required_sections:
        drafted_lower = {(s.get("name") or s.get("title") or "").lower() for s in sections}
        for req in required_sections:
            if not any(req.lower() in dn or dn in req.lower() for dn in drafted_lower):
                missing_sections.append(req)

    yield sse({
        "event": "draft_complete",
        "document_html": html,
        "total_warnings": len(all_warnings),
        "compliance_gaps": compliance_gaps[:5],
        "missing_sections": missing_sections,
        "word_count_warnings": word_count_warnings,
        "under_length_resolved": len(under_length),
        "execution_plan_score": execution_plan.get("alignment_score"),
        "coherence": coherence_result.get("overall", "adequate"),
        "narrative_arc": coherence_result.get("narrative_arc", "adequate"),
        "fundability_assessment": coherence_result.get("fundability_assessment", ""),
        "top_priority_fixes": coherence_result.get("top_priority_fixes", [])[:3],
        "criteria_coverage": coherence_result.get("criteria_coverage", {}),
        "critique_rounds_per_section": 3,
    })

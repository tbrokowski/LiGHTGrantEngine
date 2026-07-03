"""Adaptive draft generation pipeline (ADO)."""
from __future__ import annotations

import asyncio
from typing import AsyncIterator, Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.agents.bibliography_generator import generate_bibliography
from app.ai.agents.compliance_checker import check_compliance
from app.ai.agents.concept_extractor import classify_proposal_entities, extract_concepts
from app.ai.agents.document_editor import apply_document_edits, review_document_alignment
from app.ai.agents.domain_reviewer import review_section_domain
from app.ai.agents.draft_orchestrator import (
    apply_word_budgets_to_skeleton,
    build_draft_execution_plan,
)
from app.ai.agents.grant_meta_synthesizer import GrantMetaSynthesizer
from app.ai.agents.meta_agent import evaluate_and_improve_section
from app.ai.agents.planning_agent import plan_draft_research
from app.ai.agents.research_agent import gather_section_evidence
from app.ai.agents.draft_section_context import evidence_coverage_check
from app.ai.agents.section_ledger import build_ledger_entry, render_ledger_for_prompt, LedgerEntry
from app.ai.agents.section_length_adjuster import compress_section, expand_section
from app.ai.agents.section_router import draft_section_routed, INTRO_KEYWORDS
from app.ai.client import get_call_counts, reset_call_counts
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
_ADJACENT_WINDOW = 2  # how many immediately-preceding sections get full text vs. the compact ledger


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


async def _persist_archive_citations(
    grant_id: str,
    section_name: str,
    citation_markers: list[dict],
    db: AsyncSession,
) -> None:
    """Insert a GrantCitation row for each archive-sourced citation_marker (source_type
    == "archive", carrying the archive ProposalSection.id as source_ref — see the
    submit_draft tool schema in section_drafter_agentic.py). This is what makes an
    archive citation show up in the existing citations list/CitationsPanel with a
    click-through reference back to its source, instead of being lost once the draft
    run ends (citation_markers previously only existed in-memory for the bibliography)."""
    from app.models.grant_writing import GrantCitation
    from app.models.section import ProposalSection

    archive_markers = [
        m for m in (citation_markers or [])
        if isinstance(m, dict) and m.get("source_type") == "archive" and m.get("source_ref")
    ]
    if not archive_markers:
        return
    section_ids = list({m["source_ref"] for m in archive_markers})
    rows = await db.execute(select(ProposalSection).where(ProposalSection.id.in_(section_ids)))
    sections_by_id = {s.id: s for s in rows.scalars().all()}
    for marker in archive_markers:
        section = sections_by_id.get(marker["source_ref"])
        if not section:
            continue
        db.add(GrantCitation(
            grant_id=grant_id,
            section_title=section_name,
            claim_text=marker.get("marker", ""),
            source_type="archive",
            external_id=section.id,
            formatted_citation=marker.get("full_citation") or marker.get("marker", ""),
            metadata_={
                "archive_id": section.archive_id,
                "section_type": section.section_type,
                "grant_title": section.grant_title,
            },
        ))
    await db.commit()


def _genericize(text: str, entity_classification: dict[str, dict]) -> str:
    """Replace any proposal-specific named entity in text with its generic descriptor
    before it's embedded into an archive query — the raw name can't appear in OTHER
    teams' past proposals, so searching (or asking an LLM to write a HyDE excerpt) with
    it literally in the query just fails or misleads."""
    if not entity_classification:
        return text
    for term, info in entity_classification.items():
        if info.get("is_proposal_specific") and info.get("generic_descriptor") and term in text:
            text = text.replace(term, info["generic_descriptor"])
    return text


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
    entity_classification: dict[str, dict] | None = None,
) -> list[dict]:
    """Substring concept match plus mandatory entity RAG for orchestrator terms.

    For terms classified as proposal-specific (this team's own platform/project name —
    see concept_extractor.classify_proposal_entities), a literal archive substring search
    is guaranteed to fail or mislead, since that name can't appear in OTHER teams' past
    proposals. Those terms are searched by their generic descriptor instead.
    """
    seen: set[str] = set()
    bundles: list[dict] = []
    entity_classification = entity_classification or {}

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
        classification = entity_classification.get(term) or {}
        try:
            if classification.get("is_proposal_specific") and classification.get("generic_descriptor"):
                hits = await retrieve_content_exemplars(
                    query=classification["generic_descriptor"],
                    db=db,
                    funder=funder,
                    top_k=4,
                    current_grant_id=grant_id,
                )
                _add(hits if isinstance(hits, list) else [])
            else:
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
    reset_call_counts()

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
    # Classify which concepts are THIS team's own naming (can't appear in the archive of
    # other teams' proposals — search by generic descriptor instead) vs. generic reusable
    # terms (safe to search literally). One cheap LLM call for the whole draft.
    entity_classification = await classify_proposal_entities(grant.grant_idea or "", concepts) if concepts else {}
    if concepts:
        yield sse({"event": "concept_extraction", "concepts": concepts[:8]})
        queries = [
            (entity_classification.get(c) or {}).get("generic_descriptor") or c
            if (entity_classification.get(c) or {}).get("is_proposal_specific")
            else c
            for c in concepts[:8]
        ]
        results = await asyncio.gather(
            *[retrieve_for_concept(q, db, grant.funder, str(grant.id)) for q in queries],
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
                # Genericize the grant title/label for HyDE — a raw proposal-specific name
                # (like a team's own platform) would just get echoed into the hypothetical
                # excerpt and then embedded, polluting the search with a term that can't
                # exist in OTHER teams' archived proposals.
                hyde_label = _genericize(grant.title or "this grant", entity_classification)
                queries = spec.get("archive_queries") or [name]
                for q in queries[:2]:
                    try:
                        hyde = await retrieve_with_hyde(
                            hyde_prompt=f"Excerpt from {name} section about {q} for {hyde_label}",
                            db=db, funder=grant.funder, section_type=sec_type,
                            top_k=4, current_grant_id=str(grant.id),
                        )
                        rag_content.extend(hyde)
                    except Exception:
                        pass
                rag_query = _genericize(
                    f"{name} {content[:200]} {section_guide[:80]} {grant.grant_idea or ''}",
                    entity_classification,
                )
                try:
                    rag_content.extend(await retrieve_content_exemplars(
                        query=rag_query, db=db, section_type=sec_type,
                        funder=grant.funder, top_k=5, current_grant_id=str(grant.id),
                    ))
                except Exception:
                    pass
            for term in spec.get("must_surface_from_idea") or []:
                rag_content.extend(concept_rag_map.get(term, []))
                classification = entity_classification.get(term) or {}
                try:
                    if classification.get("is_proposal_specific") and classification.get("generic_descriptor"):
                        entity_hits = await retrieve_content_exemplars(
                            query=classification["generic_descriptor"],
                            db=db,
                            funder=grant.funder,
                            top_k=3,
                            current_grant_id=str(grant.id),
                        )
                    else:
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

    # Phase 3: Sequential agentic drafting. Always sequential (no parallel mode) —
    # later sections need real context of earlier ones, which is the whole point
    # of the ledger/adjacent-context mechanism below.
    word_count_warnings: list[dict] = []
    under_length: list[dict] = []
    all_draft_results: list[dict] = []
    section_results: dict[int, tuple[str, dict]] = {}
    ledger_entries: list[LedgerEntry] = []

    async def _draft_one(
        sec: dict, idx: int, adjacent_sections: list[tuple[str, str]], ledger_block: str,
    ) -> tuple[int, str, dict]:
        name = sec.get("name") or sec.get("title") or f"Section {idx + 1}"
        spec = spec_by_name.get(name) or {}
        agent = spec.get("agent") or sec.get("draft_agent") or "default"
        target_words = spec.get("target_words") or sec.get("word_limit")
        min_words = spec.get("min_words") or (int(target_words * 0.85) if target_words else None)
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
            entity_classification,
        )
        key_evidence = evidence_bundle.get("key_evidence") or []
        rag_exemplars = evidence_bundle.get("rag_content_exemplars") or []
        sec_specific_req = section_requirements_map.get(name) or section_requirements_map.get(name.lower()) or {}
        if isinstance(sec_specific_req, dict) and sec_specific_req.get("word_limit"):
            target_words = target_words or sec_specific_req["word_limit"]

        # Long sections get a structural outline embedded in the drafting
        # instructions instead of being fragmented into independently-drafted
        # subsections + a stitch call — one coherent agentic pass, not several.
        outline = spec.get("required_subsections") if spec.get("expansion_mode") == "hierarchical" else None

        draft_kwargs = dict(
            grant_idea=grant.grant_idea or "",
            call_requirements=(sec.get("requirements") or call_req),
            evaluation_criteria=eval_criteria,
            retrieved_sections=evidence_bundle.get("rag_content_exemplars") or [],
            style_exemplars=evidence_bundle.get("rag_style_exemplars") or [],
            reusable_language=evidence_bundle.get("rag_reusable_language") or [],
            target_words=target_words,
            min_words=min_words,
            funder=grant.funder or "",
            style_profile=grant.style_profile,
            citations=[{"formatted_citation": c} for c in suggested_citations if c],
            section_specific_requirements=sec_specific_req,
            call_narrative_brief=call_narrative_brief,
            skeleton_content=skeleton_content,
            compliance_guidance=sec.get("requirements") or "",
            evidence_summary=evidence_summary,
            key_evidence=key_evidence,
            narrative_context=narrative_context,
            strategic_guidance=strategy_section_map.get(name) or strategy_section_map.get(name.lower()) or "",
            emphasis_direction=emphasis_map.get(name) or emphasis_map.get(name.lower()) or "",
            concept_bundles=concept_bundles,
            writing_instructions=ci_guide.get(name) or ci_guide.get(name.lower()) or "",
            opening_hook=aligned_concept.get("opening_hook", ""),
            strategic_framing=call_strategy.get("narrative_framing", ""),
            section_type=sec_type,
            is_intro=is_intro,
        )

        async with _DRAFT_SEMAPHORE:
            result = await draft_section_routed(
                agent, name, db,
                adjacent_sections=adjacent_sections,
                ledger_block=ledger_block,
                outline=outline,
                **draft_kwargs,
            )

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

    adjacent_window: list[tuple[str, str]] = []
    for ord_pos, idx in enumerate(ordered_indices):
        sec = sections[idx]
        name = sec.get("name") or sec.get("title") or f"Section {idx + 1}"
        yield sse({"event": "section_start", "section": name, "index": ord_pos, "total": len(sections)})
        try:
            adjacent_names = {n for n, _ in adjacent_window}
            ledger_block = render_ledger_for_prompt([e for e in ledger_entries if e.section_name not in adjacent_names])
            res = await _draft_one(sec, idx, list(adjacent_window), ledger_block)
            _, name, result = res
            section_results[idx] = (name, result)
            all_draft_results.append(result)
            draft_text = result.get("draft", "")
            try:
                await _persist_archive_citations(
                    str(grant.id), name, result.get("citation_markers") or [], db,
                )
            except Exception:
                pass
            entry = await build_ledger_entry(name, draft_text)
            ledger_entries.append(entry)
            adjacent_window.append((name, draft_text))
            if len(adjacent_window) > _ADJACENT_WINDOW:
                adjacent_window.pop(0)
        except Exception:
            continue

    # Phase 4: reduced-scope critique pass — only for user-flagged sections and
    # sections the execution plan singles out. Agentic drafting already
    # self-corrects most evidence/citation gaps inline, and the whole-document
    # alignment pass below catches cross-section issues with full-document
    # visibility a per-section loop never had anyway.
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
        "critique_rounds": 1,
    }
    yield sse({"event": "meta_agent_start", "total": len(meta_sections_set), "rounds_per_section": 1})
    collected_questions: list[dict] = []
    all_warnings: list[str] = []
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

        exemplar_count = next(
            (c.get("exemplar_count", 0) for c in research_coverage if c.get("section") == name),
            0,
        )
        _, ev_bundle = section_evidence_map.get(name, (sec, {}))

        improved_html = draft_html
        if name in meta_sections_set:
            pre_cov_check = evidence_coverage_check(
                draft_text,
                spec.get("must_surface_from_idea"),
                ev_bundle.get("key_evidence"),
                exemplar_count,
            )
            initial_issues = pre_cov_check.get("issues") or []
            try:
                full_ledger_block = render_ledger_for_prompt([e for e in ledger_entries if e.section_name != name])
                async for meta_event in evaluate_and_improve_section(
                    section_name=name,
                    section_content=draft_html,
                    section_type=sec.get("type") or "other",
                    prior_sections_summary=full_ledger_block,
                    call_requirements=call_req,
                    narrative_context=narrative_context,
                    style_profile=grant.style_profile or {},
                    db=db,
                    funder=grant.funder or "",
                    grant_idea=grant.grant_idea or "",
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

        # Evidence coverage is checked for every section (for the report), even
        # though only flagged/meta-agent sections go through the critique loop —
        # this reflects the agentic drafter's own self-correction, not a stale
        # pre-refinement snapshot.
        post_cov_check = evidence_coverage_check(
            improved_html,
            spec.get("must_surface_from_idea"),
            ev_bundle.get("key_evidence"),
            exemplar_count,
        )
        qa_report["evidence_coverage"].append({"section": name, **post_cov_check})

        final_section_content[name] = improved_html
        html = insert_section_content(html, name, improved_html)
        all_warnings.extend(result.get("warnings", []))
        yield sse({"event": "section_complete", "section": name, "index": i, "total": len(sections), "word_count": result.get("word_count", 0)})

    grant.editor_document = html
    grant.draft_qa_report = qa_report
    if collected_questions:
        sk = dict(grant.proposal_skeleton or {})
        sk["_meta_agent_questions"] = collected_questions
        grant.proposal_skeleton = sk
    await db.commit()

    # Whole-document alignment pass — Reviewer + Rewriter (replaces the old
    # check_narrative_coherence, which only reported findings and never acted
    # on them). This is the first place call_intelligence.evaluation_framework
    # and adversarial_challenges are actually cross-referenced against drafted
    # content instead of just being extracted and displayed.
    coherence_result: dict = {}
    yield sse({"event": "overview_pass_start", "message": "Running whole-document alignment review…"})
    try:
        coherence_result = await review_document_alignment(
            html=html,
            call_intelligence=grant.call_intelligence or {},
            document_constraints=doc_constraints,
            call_requirements=call_req,
            grant_idea=grant.grant_idea or "",
            narrative_context=narrative_context,
        )
        findings = coherence_result.get("issues") or []
        if findings:
            yield sse({"event": "alignment_edits_start", "total_findings": len(findings)})
            html, edit_log = await apply_document_edits(
                html=html,
                findings=findings,
                grant_idea=grant.grant_idea or "",
                funder=grant.funder or "",
                style_profile=grant.style_profile,
                db=db,
            )
            grant.editor_document = html
            await db.commit()
            for e in edit_log:
                yield sse({"event": "alignment_edit_applied", "section": e["section"], "reason": e["reason"]})
            qa_report["alignment_edits"] = edit_log
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

    call_counts = get_call_counts()
    qa_report["llm_call_counts"] = call_counts
    grant.draft_qa_report = qa_report
    await db.commit()

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
        "critique_rounds_per_section": 1,
        "total_llm_calls": sum(call_counts.values()),
        "llm_call_counts": call_counts,
    })

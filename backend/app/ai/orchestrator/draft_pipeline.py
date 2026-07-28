"""Unified orchestrator-worker draft pipeline (replaces the per-section fan-out).

Drop-in for `run_adaptive_draft_stream`: same signature, same SSE event names, same
persistence (`grant.editor_document` via skeleton_to_html + insert_section_content),
so `generate_draft_stream`, `grant_writing_tasks`, and the editor UI are unchanged.

Flow (few agent *types*, the same writer parallelized, shared-memory blackboard):

  PLAN      the LEAD ARCHITECT already produced the skeleton + per-section briefs +
            a dependency/coordination map at skeleton time (grant.proposal_skeleton).
            We layer sections topologically so coupled ones draft after their deps
            and independent ones draft in parallel.

  GROUND +  each section, in dependency waves (parallel within a wave, bounded by a
  WRITE     semaphore): retrieve archive exemplars + style + reusable language (the
            reranked/contextual/verbatim RAG stack), then ONE writer (`draft_section`)
            writes it grounded in our voice + the running document-so-far. As each
            finishes it posts a ledger entry (key_claims) other writers read.

  CRITIC    every section gets one combined critique->rewrite pass
            (`evaluate_and_improve_section`) against the running document + ledger,
            reconciling cross-section consistency, structure, call coverage, voice,
            and evidence grounding. Result is merged into the document.

  DONE      persist editor_document; emit draft_complete.
"""
from __future__ import annotations

from typing import AsyncIterator, Callable

import asyncio
import structlog

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.active_grant import ActiveGrant
from app.ai.client import reset_call_counts
from app.ai.agents.section_drafter import draft_section
from app.ai.agents.meta_agent import evaluate_and_improve_section
from app.ai.agents.section_ledger import build_ledger_entry, render_ledger_for_prompt
from app.ai.context.grant_context import insert_section_content, skeleton_to_html
from app.ai.rag.retriever import (
    retrieve_content_exemplars,
    retrieve_style_exemplars,
    retrieve_reusable_language,
)

logger = structlog.get_logger()

_MAX_PARALLEL_WRITERS = 4


def _section_name(sec: dict, idx: int) -> str:
    return sec.get("name") or sec.get("title") or f"Section {idx + 1}"


def _dependency_waves(sections: list[dict], deps: list) -> list[list[int]]:
    """Topological layering by name → indices. Sections whose deps are all satisfied
    go in the current wave (drafted in parallel); the rest follow. Cycles/unknowns
    degrade to a single dependency-free wave."""
    name_to_idx = {_section_name(s, i): i for i, s in enumerate(sections)}
    # dep_of[i] = set of section indices i depends on
    dep_of: dict[int, set[int]] = {i: set() for i in range(len(sections))}
    for pair in deps or []:
        try:
            dependent, prereq = pair[0], pair[1]
        except Exception:
            continue
        di, pi = name_to_idx.get(dependent), name_to_idx.get(prereq)
        if di is not None and pi is not None and di != pi:
            dep_of[di].add(pi)

    waves: list[list[int]] = []
    done: set[int] = set()
    remaining = set(range(len(sections)))
    while remaining:
        wave = sorted(i for i in remaining if dep_of[i] <= done)
        if not wave:  # cycle / unresolved → flush the rest in one wave
            wave = sorted(remaining)
        waves.append(wave)
        done |= set(wave)
        remaining -= set(wave)
    return waves


async def run_draft_pipeline_stream(
    grant: ActiveGrant,
    db: AsyncSession,
    flagged_sections: list[str] | None,
    sse: Callable[[dict], str],
    parse_raw_sections,
) -> AsyncIterator[str]:
    reset_call_counts()

    skeleton = grant.proposal_skeleton or {}
    sections = skeleton.get("sections") or []
    if not sections and skeleton.get("raw_text"):
        sections = parse_raw_sections(skeleton["raw_text"])
    if not sections:
        yield sse({"error": "No skeleton sections found. Generate skeleton first."})
        return
    if not grant.call_analysis:
        yield sse({"error": "Call analysis required before draft. Run call analysis first."})
        return

    call_req = grant.call_requirements or ""
    call_analysis = grant.call_analysis or {}
    eval_criteria = call_analysis.get("evaluation_criteria", [])
    call_narrative_brief = call_analysis.get("narrative_brief", "")
    section_requirements_map = call_analysis.get("section_requirements") or {}
    style_profile = grant.style_profile or {}
    funder = grant.funder or ""
    grant_idea = grant.grant_idea or ""

    html = skeleton_to_html(skeleton)
    grant.editor_document = html
    grant.writing_phase = "draft"
    await db.commit()

    # ── PLAN (LEAD ARCHITECT) ─────────────────────────────────────────────────
    # If the skeleton doesn't already carry per-section briefs + a coordination map
    # (older skeletons won't), the lead architect produces them now — one grounded
    # reasoning call — so the parallel writers have specific, non-overlapping briefs.
    yield sse({"event": "planning_start", "total": len(sections)})
    if not any(s.get("brief") for s in sections) or "coordination" not in skeleton:
        try:
            from app.ai.agents.lead_architect import build_proposal_plan
            from app.ai.rag.retriever import retrieve_document_structure

            structures, exemplars0 = await asyncio.gather(
                retrieve_document_structure(db, funder, top_k=3),
                retrieve_content_exemplars(query=f"{grant.title} {grant_idea[:200]}", db=db, funder=funder, top_k=6),
            )
            plan = await build_proposal_plan(
                grant_title=grant.title or "",
                funder=funder,
                grant_idea=grant_idea,
                call_requirements=call_req,
                call_analysis=call_analysis,
                archive_structures=structures,
                archive_exemplars=exemplars0,
                total_word_limit=skeleton.get("total_word_limit"),
            )
            briefs_by_name = {s.get("name"): s.get("brief") for s in (plan.get("sections") or []) if s.get("name")}
            for s in sections:
                nm = s.get("name") or s.get("title")
                if nm in briefs_by_name and briefs_by_name[nm] and not s.get("brief"):
                    s["brief"] = briefs_by_name[nm]
            if plan.get("coordination") and "coordination" not in skeleton:
                skeleton["coordination"] = plan["coordination"]
                grant.proposal_skeleton = skeleton
                await db.commit()
        except Exception as exc:
            logger.warning("lead_architect planning skipped", error=str(exc))

    deps = ((skeleton.get("coordination") or {}).get("dependencies")) or []
    waves = _dependency_waves(sections, deps)
    yield sse({"event": "planning_complete", "total": len(sections)})

    # Blackboard shared across writers/critic.
    ledger_entries: list = []
    drafts: dict[int, dict] = {}  # idx -> {name, html, word_count}

    async def _ground_and_write(idx: int) -> tuple[int, str, dict]:
        sec = sections[idx]
        name = _section_name(sec, idx)
        sec_type = sec.get("section_type") or sec.get("type") or "other"
        word_limit = sec.get("word_limit")
        brief = sec.get("brief") or {}
        query = f"{name} {grant_idea[:200]} {funder}"

        # Ground once (reranked + contextual + verbatim archive, style, reusable).
        try:
            exemplars, style_ex, reusable = await asyncio.gather(
                retrieve_content_exemplars(query=query, db=db, section_type=sec_type, funder=funder, top_k=4),
                retrieve_style_exemplars(db=db, section_type=sec_type, funder=funder, top_k=2),
                retrieve_reusable_language(query=query, db=db, section_type=sec_type, top_k=2),
            )
        except Exception:
            exemplars, style_ex, reusable = [], [], []

        prior = render_ledger_for_prompt([e for e in ledger_entries if e.section_name != name])
        brief_text = ""
        if brief:
            pts = "\n".join(f"- {p}" for p in (brief.get("points") or []))
            brief_text = (
                f"TOPIC SENTENCE: {brief.get('topic_sentence', '')}\n"
                f"COVER: \n{pts}\n"
                f"THIS SECTION OWNS: {brief.get('owns', '')}\n"
                f"DO NOT COVER (other sections own): {', '.join(brief.get('defers') or [])}"
            )

        try:
            result = await draft_section(
                section_name=name,
                section_type=sec_type,
                call_requirements=call_req,
                evaluation_criteria=eval_criteria,
                retrieved_sections=exemplars,
                style_exemplars=style_ex,
                reusable_language=reusable,
                word_limit=word_limit,
                funder=funder,
                style_profile=style_profile,
                prior_sections_summary=prior,
                grant_idea=grant_idea,
                section_specific_requirements=section_requirements_map.get(name),
                call_narrative_brief=call_narrative_brief,
                skeleton_content=brief_text or (sec.get("description") or ""),
            )
        except Exception as exc:
            logger.warning("draft_pipeline write failed", section=name, error=str(exc))
            result = {"draft": sec.get("description") or "", "word_count": 0}

        draft_text = result.get("draft", "") or ""
        draft_html = draft_text if draft_text.strip().startswith("<") else "".join(
            f"<p>{p.strip()}</p>" for p in draft_text.split("\n\n") if p.strip()
        )
        return idx, name, {"html": draft_html, "word_count": result.get("word_count") or len(draft_text.split())}

    # ── GROUND + PARALLEL WRITE (dependency-layered) ───────────────────────────
    yield sse({"event": "research_start", "total": len(sections)})
    for wave in waves:
        for idx in wave:
            yield sse({"event": "section_start", "section": _section_name(sections[idx], idx),
                       "index": idx, "total": len(sections)})
        sem = asyncio.Semaphore(_MAX_PARALLEL_WRITERS)

        async def _bounded(i: int):
            async with sem:
                return await _ground_and_write(i)

        results = await asyncio.gather(*[_bounded(i) for i in wave], return_exceptions=True)
        for res in results:
            if isinstance(res, Exception):
                continue
            idx, name, data = res
            drafts[idx] = {"name": name, **data}
            try:
                ledger_entries.append(await build_ledger_entry(name, data["html"]))
            except Exception:
                pass
    yield sse({"event": "research_complete", "total": len(sections)})

    # ── CRITIC: one integrated critique->rewrite per section over the running doc ─
    yield sse({"event": "meta_agent_start", "total": len(drafts), "rounds_per_section": 1})
    for idx in sorted(drafts):
        name = drafts[idx]["name"]
        draft_html = drafts[idx]["html"]
        prior = render_ledger_for_prompt([e for e in ledger_entries if e.section_name != name])
        improved = draft_html
        try:
            async for ev in evaluate_and_improve_section(
                section_name=name,
                section_content=draft_html,
                section_type=(sections[idx].get("section_type") or "other"),
                prior_sections_summary=prior,
                call_requirements=call_req,
                narrative_context={"grant_idea": grant_idea, "running_document": (grant.editor_document or "")[:20000]},
                style_profile=style_profile,
                db=db,
                funder=funder,
                grant_idea=grant_idea,
            ):
                if ev.get("content"):
                    improved = ev["content"]
        except Exception as exc:
            logger.warning("draft_pipeline critic failed", section=name, error=str(exc))
        html = insert_section_content(html, name, improved)
        grant.editor_document = html
        await db.commit()
        yield sse({"event": "section_complete", "section": name, "index": idx,
                   "total": len(sections), "word_count": drafts[idx]["word_count"]})

    grant.editor_document = html
    grant.writing_phase = "draft"
    await db.commit()

    try:
        from app.ai.client import get_call_counts
        total_calls = sum(get_call_counts().values())
    except Exception:
        total_calls = None
    logger.info("draft_pipeline complete", sections=len(sections), waves=len(waves), llm_calls=total_calls)
    yield sse({"event": "draft_complete", "sections": len(sections)})

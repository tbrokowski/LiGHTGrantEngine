"""
Draft Orchestrator — Phase 0 of adaptive draft generation.

Reads call analysis, call intelligence, skeleton, and grant idea; produces
a draft_execution_plan with per-section agents, word targets, research tiers,
and alignment audit. User inputs take precedence over AI guidance.
"""
from __future__ import annotations

import json
import re

from app.ai.client import chat_complete

SYSTEM_PROMPT = """You are a senior grant proposal orchestrator planning a full competitive draft.

You receive the team's grant idea, skeleton outline, call requirements, and AI-extracted call intelligence.
Your job is to produce an EXECUTION PLAN — not prose.

TRUST ORDER (strict):
1. grant_idea and skeleton content (team truth)
2. call_requirements and call document requirements
3. call_analysis and call_intelligence (guidance only — may contain errors)

Rules:
- Allocate word budgets that sum to approximately total_target_words from the call
- Large calls (30+ pages) need substantial per-section targets — do NOT under-allocate
- Route sections to specialized agents only when appropriate
- requires_work_packages: true ONLY for Horizon/EC/structured WP calls with explicit work packages
- expansion_mode "hierarchical" when target_words > 1500; else "single"
- research_tier "deep" for methods, work plan, technical sections; "light" for admin/budget/abbreviations
- List must_surface_from_idea terms (programs, acronyms like MOOVE, DISCO) from the grant idea
- Flag alignment_gaps when skeleton misses required call sections or idea terms

Return valid JSON only."""

USER_PROMPT = """Plan draft execution for this grant proposal.

GRANT: {title}
FUNDER: {funder}

GRANT IDEA (authoritative):
{grant_idea}

CALL REQUIREMENTS:
{call_requirements}

CALL ANALYSIS SUMMARY:
Narrative: {narrative_brief}
Required sections: {required_sections}
Document word limit: {word_limit}
Document page limit: {page_limit}
Evaluation criteria: {evaluation_criteria}

CALL INTELLIGENCE (guidance — may be incomplete):
{call_intelligence_block}

ALIGNED CONCEPT:
{aligned_block}

CALL STRATEGY:
{strategy_block}

SKELETON SECTIONS:
{skeleton_sections}

---

Return JSON:
{{
  "alignment_score": 0-100,
  "alignment_gaps": ["specific gap"],
  "missing_call_sections": ["section name from call not in skeleton"],
  "idea_terms_not_in_skeleton": ["MOOVE", "..."],
  "document_profile": {{
    "total_target_words": int,
    "total_target_pages": int or null,
    "requires_work_packages": bool,
    "grant_type_label": str
  }},
  "sections": [
    {{
      "section_name": "exact skeleton section name",
      "agent": "intro|methods|work_packages|impact|budget|default",
      "target_words": int,
      "min_words": int,
      "expansion_mode": "single|hierarchical",
      "research_tier": "deep|standard|light",
      "required_subsections": [],
      "archive_queries": ["query for RAG"],
      "must_surface_from_idea": [],
      "needs_figure": bool,
      "domain_review": null or "clinical|technical|implementation",
      "priority": "high|medium|low"
    }}
  ],
  "wave_order": {{
    "wave1_parallel": ["section names for background/methods/WP"],
    "wave2_sequential": ["section names needing prior context"]
  }},
  "use_meta_agent_sections": ["only flagged or low-quality section names"],
  "notes": "brief orchestrator notes for the team"
}}"""


def _parse_int_from_limit(val) -> int | None:
    if val is None:
        return None
    if isinstance(val, int):
        return val
    s = str(val).replace(",", "")
    m = re.search(r"(\d+)", s)
    return int(m.group(1)) if m else None


def _estimate_total_words(call_analysis: dict, call_intelligence: dict) -> int:
    ci_total = call_intelligence.get("total_allocated_words")
    if isinstance(ci_total, int) and ci_total > 500:
        return ci_total
    wl = _parse_int_from_limit(call_analysis.get("word_limit"))
    if wl and wl > 500:
        return wl
    pl = _parse_int_from_limit(call_analysis.get("page_limit"))
    if pl and pl > 1:
        return pl * 500
    blueprint = call_intelligence.get("section_blueprint") or []
    if blueprint:
        return sum(int(s.get("suggested_word_count") or 800) for s in blueprint)
    return 12000


def _format_skeleton_sections(sections: list[dict]) -> str:
    lines = []
    for sec in sections:
        name = sec.get("name") or sec.get("title") or "?"
        wl = sec.get("word_limit")
        content = sec.get("content") or ""
        lines.append(f"## {name} (limit: {wl or 'unset'})")
        lines.append(content[:4000] if content else "[empty]")
        lines.append("")
    return "\n".join(lines)[:50000]


def _format_ci_block(ci: dict) -> str:
    if not ci:
        return "Not available"
    parts = []
    if ci.get("grant_type_context"):
        parts.append(f"Grant type: {ci['grant_type_context'][:500]}")
    if ci.get("section_blueprint"):
        for s in (ci["section_blueprint"] or [])[:15]:
            parts.append(
                f"  - {s.get('name')}: ~{s.get('suggested_word_count')} words — {s.get('purpose', '')[:80]}"
            )
    if ci.get("per_section_writing_guide"):
        parts.append("Per-section guides available.")
    return "\n".join(parts)[:3000]


def _infer_agent(section_name: str, requires_wp: bool) -> str:
    n = section_name.lower()
    if any(k in n for k in ("intro", "background", "executive", "rationale", "summary")):
        return "intro"
    if requires_wp and any(k in n for k in ("work plan", "work package", "wp", "implementation plan", "work programme")):
        return "work_packages"
    if any(k in n for k in ("method", "approach", "design", "technical", "protocol", "work plan")):
        if "work package" not in n and "wp" not in n.split():
            return "methods"
    if any(k in n for k in ("impact", "dissemination", "sustainability", "outreach", "exploitation")):
        return "impact"
    if any(k in n for k in ("budget", "resources", "cost", "financial")):
        return "budget"
    return "default"


def _requires_work_packages(call_analysis: dict, call_intelligence: dict, call_req: str) -> bool:
    text = (
        (call_req or "")[:8000]
        + " ".join(str(x) for x in (call_analysis.get("requirements_overview") or [])[:20])
    ).lower()
    if any(k in text for k in ("work package", "work programme", "wp1", "deliverable d", "ga ", "horizon europe")):
        return True
    for s in (call_intelligence.get("section_blueprint") or []):
        name = (s.get("name") or "").lower()
        if "work package" in name or name.startswith("wp"):
            return True
    return False


def _normalize_plan(
    plan: dict,
    skeleton_sections: list[dict],
    call_analysis: dict,
    call_intelligence: dict,
    call_req: str,
) -> dict:
    """Ensure every skeleton section has an execution spec; fill defaults."""
    total = _estimate_total_words(call_analysis, call_intelligence)
    requires_wp = _requires_work_packages(call_analysis, call_intelligence, call_req)
    profile = plan.get("document_profile") or {}
    profile.setdefault("total_target_words", total)
    profile.setdefault("requires_work_packages", requires_wp)
    plan["document_profile"] = profile

    spec_by_name: dict[str, dict] = {}
    for s in plan.get("sections") or []:
        name = s.get("section_name") or ""
        if name:
            spec_by_name[name] = s

    n_secs = max(len(skeleton_sections), 1)
    default_per = max(400, total // n_secs)
    normalized: list[dict] = []

    for sec in skeleton_sections:
        name = sec.get("name") or sec.get("title") or ""
        if not name:
            continue
        spec = spec_by_name.get(name) or {}
        user_wl = sec.get("word_limit")
        target = int(spec.get("target_words") or user_wl or default_per)
        if user_wl:
            target = max(target, int(user_wl))
        agent = spec.get("agent") or _infer_agent(name, requires_wp)
        if agent == "work_packages" and not requires_wp:
            agent = "methods" if "method" in name.lower() else "default"
        expansion = spec.get("expansion_mode") or ("hierarchical" if target > 1500 else "single")
        n_lower = name.lower()
        tier = spec.get("research_tier") or "standard"
        if agent in ("methods", "work_packages", "intro", "impact"):
            tier = "deep"
        elif any(k in n_lower for k in ("method", "technical", "approach", "impact", "dissemination")):
            tier = "deep"
        elif any(k in n_lower for k in ("budget", "admin", "abbreviation", "cv", "form")):
            tier = "light"
        archive_q = list(spec.get("archive_queries") or [name])
        for term in spec.get("must_surface_from_idea") or []:
            if term and term not in archive_q:
                archive_q.append(str(term))
        quality_rubric = spec.get("quality_rubric") or {
            "min_exemplar_count": 2 if tier == "deep" else 1,
            "require_citations": tier in ("deep", "standard"),
        }
        normalized.append({
            "section_name": name,
            "agent": agent,
            "target_words": target,
            "min_words": int(spec.get("min_words") or target * 0.85),
            "expansion_mode": expansion,
            "research_tier": tier,
            "required_subsections": spec.get("required_subsections") or [],
            "archive_queries": archive_q[:6],
            "must_surface_from_idea": spec.get("must_surface_from_idea") or [],
            "needs_figure": bool(spec.get("needs_figure")),
            "domain_review": spec.get("domain_review"),
            "priority": spec.get("priority") or "medium",
            "quality_rubric": quality_rubric,
        })

    plan["sections"] = normalized
    if not plan.get("wave_order"):
        w1, w2 = [], []
        for s in normalized:
            if s["agent"] in ("intro", "methods", "work_packages") or s["priority"] == "high":
                w1.append(s["section_name"])
            else:
                w2.append(s["section_name"])
        plan["wave_order"] = {"wave1_parallel": w1, "wave2_sequential": w2}
    return plan


async def build_draft_execution_plan(
    opportunity_title: str,
    funder: str,
    grant_idea: str,
    call_requirements: str,
    call_analysis: dict,
    call_intelligence: dict | None,
    proposal_skeleton: dict,
    call_strategy: dict | None = None,
    aligned_concept: dict | None = None,
) -> dict:
    sections = proposal_skeleton.get("sections") or []
    if not sections and proposal_skeleton.get("raw_text"):
        import re
        headings = re.findall(r"^##\s+(.+)$", proposal_skeleton["raw_text"], re.MULTILINE)
        sections = [{"name": h.strip(), "content": ""} for h in headings]

    strategy_block = ""
    if call_strategy:
        strategy_block = json.dumps({
            "must_demonstrate": (call_strategy.get("must_demonstrate") or [])[:6],
            "critical_themes": (call_strategy.get("critical_themes") or [])[:6],
        }, indent=0)[:2000]

    aligned_block = ""
    if aligned_concept:
        aligned_block = (aligned_concept.get("aligned_framing") or "")[:1500]

    user_prompt = USER_PROMPT.format(
        title=opportunity_title or "Grant",
        funder=funder or "Unknown",
        grant_idea=(grant_idea or "")[:6000],
        call_requirements=(call_requirements or "")[:6000],
        narrative_brief=(call_analysis.get("narrative_brief") or "")[:800],
        required_sections=call_analysis.get("required_sections") or [],
        word_limit=call_analysis.get("word_limit"),
        page_limit=call_analysis.get("page_limit"),
        evaluation_criteria=(call_analysis.get("evaluation_criteria") or [])[:8],
        call_intelligence_block=_format_ci_block(call_intelligence or {}),
        aligned_block=aligned_block or "Not available",
        strategy_block=strategy_block or "Not available",
        skeleton_sections=_format_skeleton_sections(sections),
    )

    try:
        response = await chat_complete(
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            agent_name="draft_orchestrator",
            json_mode=True,
        )
        plan = json.loads(response)
    except (json.JSONDecodeError, TypeError, Exception):
        plan = {}

    if not plan.get("sections"):
        plan = _fallback_plan(sections, call_analysis, call_intelligence or {}, call_requirements or "")

    return _normalize_plan(
        plan,
        sections,
        call_analysis,
        call_intelligence or {},
        call_requirements or "",
    )


def _fallback_plan(
    sections: list[dict],
    call_analysis: dict,
    call_intelligence: dict,
    call_req: str,
) -> dict:
    total = _estimate_total_words(call_analysis, call_intelligence)
    requires_wp = _requires_work_packages(call_analysis, call_intelligence, call_req)
    n = max(len(sections), 1)
    per = max(400, total // n)
    return {
        "alignment_score": 70,
        "alignment_gaps": [],
        "missing_call_sections": [],
        "idea_terms_not_in_skeleton": [],
        "document_profile": {
            "total_target_words": total,
            "requires_work_packages": requires_wp,
            "grant_type_label": call_intelligence.get("call_type_label") or "",
        },
        "sections": [
            {
                "section_name": s.get("name") or s.get("title") or "",
                "agent": _infer_agent(s.get("name") or "", requires_wp),
                "target_words": int(s.get("word_limit") or per),
                "min_words": int((s.get("word_limit") or per) * 0.85),
                "expansion_mode": "hierarchical" if (s.get("word_limit") or per) > 1500 else "single",
                "research_tier": "standard",
                "archive_queries": [s.get("name") or ""],
                "must_surface_from_idea": [],
                "needs_figure": False,
                "domain_review": None,
                "priority": "medium",
            }
            for s in sections
            if s.get("name") or s.get("title")
        ],
        "wave_order": {"wave1_parallel": [], "wave2_sequential": []},
        "use_meta_agent_sections": [],
        "notes": "Fallback plan — orchestrator LLM unavailable",
    }


def apply_word_budgets_to_skeleton(
    skeleton: dict,
    execution_plan: dict,
) -> dict:
    """Merge orchestrator targets into skeleton sections; user limits win if higher."""
    specs = {
        s["section_name"]: s
        for s in (execution_plan.get("sections") or [])
        if s.get("section_name")
    }
    sections = skeleton.get("sections") or []
    for sec in sections:
        name = sec.get("name") or sec.get("title") or ""
        spec = specs.get(name)
        if not spec:
            continue
        user_wl = sec.get("word_limit")
        target = spec.get("target_words")
        if user_wl and target:
            sec["word_limit"] = max(int(user_wl), int(target))
        elif target:
            sec["word_limit"] = int(target)
        sec["target_words"] = sec.get("word_limit") or target
        sec["min_words"] = spec.get("min_words")
        sec["expansion_mode"] = spec.get("expansion_mode")
        sec["draft_agent"] = spec.get("agent")
    skeleton["sections"] = sections
    profile = execution_plan.get("document_profile") or {}
    if profile.get("total_target_words") and not skeleton.get("total_word_limit"):
        skeleton["total_word_limit"] = profile["total_target_words"]
    skeleton["draft_execution_plan"] = execution_plan
    return skeleton

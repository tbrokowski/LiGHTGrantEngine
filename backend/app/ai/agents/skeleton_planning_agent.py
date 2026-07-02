"""
Skeleton Planning Agent (Stage 3.5)
Runs after idea alignment and before per-section research.

Given the call strategy, aligned concept, call analysis, user idea, and section
constraints, produces a per-section research plan: targeted web / academic queries,
a HyDE prompt for archive retrieval, key claims to support, and the idea excerpt
most relevant to each section.

This is a lightweight gpt-4o-mini call that writes *queries and plans*, not prose.
"""
from __future__ import annotations

import json
import re

from app.ai.client import chat_complete

SYSTEM_PROMPT = """You are a research planning specialist for competitive grant proposal writing.

Your job is to decompose a grant proposal into sections and generate targeted research plans for each.
You do NOT write the proposal — you write the queries and plans that will be used to gather evidence.

For each section you must produce:
1. Targeted web search queries (specific enough to find current statistics, case studies, similar projects)
2. Academic search queries (PubMed/OpenAlex style: MeSH terms, author + topic combos)
3. A HyDE prompt: a 2-sentence instruction telling an LLM how to write a 120-word hypothetical
   excerpt from a WINNING grant proposal for this section. This excerpt will be used as a
   vector search query to find similar archive content.
4. Key claims the section needs evidence for (pulled from the grant idea)
5. The exact excerpt from the grant idea most relevant to this section

Rules:
- Web queries must be specific: include disease areas, geographies, technologies, population groups
  from the idea. Bad: "AI in healthcare". Good: "AI-assisted ultrasound diagnosis SSA resource-limited settings"
- HyDE prompts must mention the call type (NIH, Horizon Europe, etc.) and the idea's specific approach
- Idea excerpts must be VERBATIM phrases from the grant idea, 50-150 words
- If no relevant excerpt exists for a section, use null
- Output valid JSON only, no prose"""

USER_PROMPT_TEMPLATE = """Plan the per-section research for this grant proposal skeleton.

GRANT: {opportunity_title}
FUNDER: {funder}
GRANT TYPE: {grant_type_context}

GRANT IDEA (the team's proposed approach — primary content source):
{grant_idea}

ALIGNED FRAMING (how the idea maps to the call):
{aligned_framing}

CALL NARRATIVE:
{narrative_brief}

REQUIRED SECTIONS (from call analysis):
{required_sections}

SECTION CONSTRAINTS (from user — may differ from call's required sections):
{section_constraints}

CALL STRATEGY:
{strategy_block}

KEY EVALUATION CRITERIA:
{evaluation_criteria}

---

For each section that will appear in the skeleton, produce a research plan.
Use the SECTION CONSTRAINTS if provided (they may rename or reorder sections).
Otherwise use REQUIRED SECTIONS from the call. Include at most 18 sections — if the SECTION
CONSTRAINTS list an enumerated set of work packages or components, plan a section for every one
of them; do not drop or merge any to stay under a smaller count.

Respond with valid JSON:
{{
  "sections": [
    {{
      "section_name": "exact section name to use in skeleton",
      "section_brief": "1-2 sentence description of what this section must achieve for THIS call",
      "idea_excerpt": "verbatim text from GRANT IDEA most relevant to this section, or null",
      "key_claims_to_support": [
        "specific claim from the idea that needs evidence",
        "another claim to ground in data"
      ],
      "web_search_queries": [
        "specific query 1 (include technology/geography/population from idea)",
        "specific query 2",
        "optional query 3"
      ],
      "academic_search_queries": [
        "PubMed/OpenAlex style query 1",
        "optional query 2"
      ],
      "hyde_prompt": "Write a 120-word excerpt from the {section_name} section of a winning {grant_type} grant proposal about {specific_approach}. Include specific methods, outcomes, and evidence typical of high-scoring proposals for this funder.",
      "section_type": "background|methodology|objectives|impact|budget|team|other"
    }}
  ],
  "overall_narrative": "1 sentence: the core through-line connecting all sections in this proposal"
}}"""


def _format_required_sections(call_analysis: dict, section_constraints: list[dict] | None) -> str:
    if section_constraints:
        names = [s.get("name") or s.get("title") or "" for s in section_constraints if s.get("name") or s.get("title")]
        if names:
            return "User-specified: " + ", ".join(names)
    required = call_analysis.get("required_sections") or []
    if required:
        return ", ".join(required[:12])
    sec_reqs = call_analysis.get("section_requirements") or {}
    if sec_reqs:
        return ", ".join(list(sec_reqs.keys())[:12])
    return "Not specified — infer from call context"


def _format_strategy_block(call_strategy: dict | None, aligned_concept: dict | None) -> str:
    parts = []
    if call_strategy:
        if call_strategy.get("critical_themes"):
            parts.append("Critical themes: " + " | ".join(call_strategy["critical_themes"][:5]))
        if call_strategy.get("must_demonstrate"):
            parts.append("Must demonstrate:\n" + "\n".join(f"- {d}" for d in call_strategy["must_demonstrate"][:5]))
        if call_strategy.get("section_strategy"):
            sec_strat = call_strategy["section_strategy"]
            lines = []
            for sec, guidance in list(sec_strat.items())[:6]:
                if isinstance(guidance, str):
                    lines.append(f"- {sec}: {guidance[:200]}")
            if lines:
                parts.append("Per-section strategy:\n" + "\n".join(lines))
        if call_strategy.get("key_phrases_to_echo"):
            parts.append("Key funder phrases to use: " + " | ".join(call_strategy["key_phrases_to_echo"][:5]))
    if aligned_concept:
        if aligned_concept.get("gaps_to_address"):
            parts.append("Gaps to address:\n" + "\n".join(f"- {g}" for g in aligned_concept["gaps_to_address"][:4]))
        if aligned_concept.get("strengths_to_lead_with"):
            parts.append("Strengths to foreground:\n" + "\n".join(f"- {s}" for s in aligned_concept["strengths_to_lead_with"][:3]))
    return "\n\n".join(parts) if parts else "Not available"


def _format_section_constraints(section_constraints: list[dict] | None) -> str:
    if not section_constraints:
        return "None — use sections from call analysis"
    lines = []
    for s in section_constraints[:18]:
        name = s.get("name") or s.get("title") or "Untitled"
        wl = s.get("word_limit") or s.get("wordLimit")
        pl = s.get("page_limit") or s.get("pageLimit")
        extra = f" (max {wl} words)" if wl else ""
        extra += f" ({pl} pages)" if pl else ""
        lines.append(f"- {name}{extra}")
    return "\n".join(lines)


async def plan_skeleton_research(
    opportunity_title: str,
    funder: str,
    grant_idea: str,
    call_analysis: dict,
    call_strategy: dict | None = None,
    aligned_concept: dict | None = None,
    call_intelligence: dict | None = None,
    section_constraints: list[dict] | None = None,
) -> dict:
    """
    Produce a per-section research plan for skeleton generation.

    Returns:
      {
        "sections": [
          {
            "section_name": str,
            "section_brief": str,
            "idea_excerpt": str | None,
            "key_claims_to_support": list[str],
            "web_search_queries": list[str],
            "academic_search_queries": list[str],
            "hyde_prompt": str,
            "section_type": str,
          }
        ],
        "overall_narrative": str,
      }
    """
    grant_type_context = (call_intelligence or {}).get("grant_type_context") or ""
    narrative_brief = call_analysis.get("narrative_brief") or ""
    evaluation_criteria = call_analysis.get("evaluation_criteria") or []
    aligned_framing = (aligned_concept or {}).get("aligned_framing") or ""

    user_prompt = USER_PROMPT_TEMPLATE.format(
        opportunity_title=opportunity_title or "Grant Proposal",
        funder=funder or "Funder",
        grant_type_context=grant_type_context[:300] if grant_type_context else "Not classified",
        grant_idea=(grant_idea or "")[:8000],
        aligned_framing=aligned_framing[:1500] if aligned_framing else "Not available",
        narrative_brief=narrative_brief[:800] if narrative_brief else "Not available",
        required_sections=_format_required_sections(call_analysis, section_constraints),
        section_constraints=_format_section_constraints(section_constraints),
        strategy_block=_format_strategy_block(call_strategy, aligned_concept),
        evaluation_criteria="\n".join(f"- {c}" for c in evaluation_criteria[:8]) if evaluation_criteria else "Not specified",
    )

    response = await chat_complete(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        agent_name="skeleton_planning_agent",
        json_mode=True,
    )

    try:
        result = json.loads(response)
        # Normalise: ensure sections is a list
        if isinstance(result, list):
            result = {"sections": result, "overall_narrative": ""}
        if not isinstance(result.get("sections"), list):
            result["sections"] = []
        return result
    except (json.JSONDecodeError, TypeError, AttributeError):
        return {"sections": [], "overall_narrative": ""}

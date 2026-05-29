"""
Grant Meta-Synthesizer
Reads THREE inputs — call_analysis (AI-extracted, may have errors), grant_idea
(user's own words, primary source of truth), and existing_skeleton (user-edited,
always preserved) — then produces call_intelligence as GUIDANCE for downstream agents.

Pipeline:
  Step 1: Alignment check — where idea meets the call, where the gaps are
  Step 2: Gap-driven routing — select sub-analyses from pool based on gaps
  Step 3: Parallel sub-analyses (gpt-4o-mini, fast + cheap)
  Step 4: Adversarial review — Devil's Advocate + Compliance Auditor (gpt-4o)
  Step 5: Final synthesis → call_intelligence stored on grant

call_intelligence is GUIDANCE only. User inputs always take precedence.
"""
from __future__ import annotations

import asyncio
import json
import logging

from app.ai.client import chat_complete

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Analysis pool — each is a focused question answered against the call
# ---------------------------------------------------------------------------

_ANALYSIS_POOL: dict[str, str] = {
    # Always-on
    "core_requirements": """Extract and prioritize ALL explicit requirements from this call.
Focus on what the funder REQUIRES (not just suggests), ordered by importance.
Return JSON: {"requirements": [list, most important first], "mandatory_items": [list of hard requirements], "eligibility_conditions": [list]}""",

    "evaluation_framework": """Map the evaluation criteria to proposal sections and estimate relative weights.
Return JSON: {"criteria": [{"name": str, "weight_pct": int, "relevant_sections": [list], "what_reviewers_look_for": str}], "total_scoring_notes": str}""",

    "section_structure": """Determine the optimal proposal section structure for this call.
Use required sections, evaluation flow, and structural guidance from the call.
Return JSON: {"sections": [{"name": str, "purpose": str, "required": bool, "order": int, "evaluation_criterion": str}], "structure_notes": str}""",

    "word_budget": """Distribute a word budget across sections proportional to evaluation weights.
If total word limit is unstated, estimate for a competitive proposal (3000–15000 words typical).
Return JSON: {"total_estimated_words": int, "sections": [{"name": str, "word_count": int, "rationale": str}], "distribution_notes": str}""",

    # Research
    "scientific_rigor": """What methodological evidence does this call specifically require?
What standards of scientific rigor does the funder expect?
Return JSON: {"required_evidence_types": [list], "methodological_expectations": str, "literature_requirements": str}""",

    "preliminary_data": """Does this call require or expect preliminary data from the applicant?
What form should it take and how prominently should it appear?
Return JSON: {"requires_preliminary_data": bool, "expected_form": str, "prominence_guidance": str, "if_absent_recommendation": str}""",

    "study_design": """Are there specific study design requirements in this call?
What methodologies are acceptable or expected?
Return JSON: {"design_requirements": [list], "acceptable_methodologies": [list], "excluded_approaches": [list], "notes": str}""",

    # Implementation
    "scalability_sustainability": """What scale and sustainability requirements does this call have?
What implementation frameworks does it reference or imply?
Return JSON: {"scale_requirements": str, "sustainability_expectations": str, "implementation_frameworks_mentioned": [list], "continuation_requirements": str}""",

    "cost_effectiveness": """Does this call require cost analysis, value for money, or budget narrative?
What level of budget detail is expected?
Return JSON: {"cost_analysis_required": bool, "budget_narrative_expectations": str, "value_for_money_framing": str, "allowable_cost_categories": [list]}""",

    "fidelity_quality": """What quality assurance or fidelity monitoring does this call expect?
Return JSON: {"quality_requirements": [list], "monitoring_expectations": str, "standards_to_comply_with": [list]}""",

    # Innovation / tech
    "trl_pathway": """Does this call reference Technology Readiness Levels or maturity stages?
What is the expected TRL range and what demonstration milestones are required?
Return JSON: {"trl_mentioned": bool, "starting_trl": str, "ending_trl": str, "demonstration_milestones": [list], "notes": str}""",

    "technical_risk": """What technical risks must be acknowledged and mitigated per this call?
Return JSON: {"required_risks_to_address": [list], "mitigation_expectations": str, "risk_framework_required": bool}""",

    "transition_commercialization": """Does this call require a transition plan, commercialization pathway, or exploitation strategy?
Return JSON: {"required": bool, "pathway_type": str, "key_requirements": [list], "timeline_expectations": str}""",

    # Capacity / development
    "theory_of_change": """Does this call require an explicit theory of change or logic model?
Return JSON: {"required": bool, "format_expected": str, "depth_required": str, "key_components": [list]}""",

    "mel_equity": """What monitoring, evaluation, and learning (MEL) requirements does this call have?
What equity or reach criteria are mentioned?
Return JSON: {"mel_requirements": [list], "indicator_expectations": str, "equity_criteria": [list], "reporting_requirements": str}""",
}

_ALWAYS_ON = ["core_requirements", "evaluation_framework", "section_structure", "word_budget"]


# ---------------------------------------------------------------------------
# Main class
# ---------------------------------------------------------------------------

class GrantMetaSynthesizer:
    """
    Reads call_analysis + grant_idea + existing_skeleton.
    Produces call_intelligence as guidance (not overrides).
    All steps catch exceptions — returns partial result rather than failing.
    """

    async def synthesize(
        self,
        call_analysis: dict,
        grant_idea: str,
        existing_skeleton: dict | None,
        funder: str,
        title: str,
    ) -> dict:
        try:
            alignment = await self._alignment_check(
                call_analysis, grant_idea or "", existing_skeleton or {}
            )
        except Exception as exc:
            logger.warning("meta_synthesizer alignment_check failed: %s", exc)
            alignment = {
                "active_analyses": _ALWAYS_ON[:],
                "call_specific_questions": [],
                "gaps": [],
                "covered": [],
                "alignment_summary": "",
            }

        active_analyses: list[str] = alignment.get("active_analyses") or _ALWAYS_ON[:]
        call_specific_questions: list[str] = alignment.get("call_specific_questions") or []

        pool_tasks = [
            self._run_analysis(name, call_analysis, grant_idea or "", existing_skeleton or {})
            for name in active_analyses
        ]
        adhoc_tasks = [
            self._run_adhoc_analysis(q, call_analysis, grant_idea or "")
            for q in call_specific_questions[:3]
        ]
        all_results = await asyncio.gather(*pool_tasks, *adhoc_tasks, return_exceptions=True)

        sub_results: list[dict] = []
        for i, r in enumerate(all_results):
            if isinstance(r, Exception):
                logger.warning("meta_synthesizer sub-analysis %d failed: %s", i, r)
            elif isinstance(r, dict):
                sub_results.append(r)

        try:
            adversarial = await self._adversarial_review(
                alignment, sub_results, call_analysis, grant_idea or ""
            )
        except Exception as exc:
            logger.warning("meta_synthesizer adversarial_review failed: %s", exc)
            adversarial = {"rejection_risks": [], "compliance_gaps": []}

        try:
            call_intelligence = await self._final_synthesis(
                alignment, sub_results, adversarial, call_analysis, funder, title
            )
        except Exception as exc:
            logger.warning("meta_synthesizer final_synthesis failed: %s", exc)
            call_intelligence = self._fallback_intelligence(alignment, adversarial, call_analysis)

        return call_intelligence

    # ------------------------------------------------------------------
    # Step 1: Alignment check
    # ------------------------------------------------------------------

    async def _alignment_check(
        self,
        call_analysis: dict,
        grant_idea: str,
        existing_skeleton: dict,
    ) -> dict:
        call_summary = _format_call_summary(call_analysis)
        skeleton_summary = _format_skeleton_summary(existing_skeleton)

        prompt = f"""You are reviewing a grant proposal concept against a specific funder's call.

CALL ANALYSIS (AI-extracted — treat as candidate requirements, may have errors):
{call_summary}

USER'S GRANT IDEA (primary source of truth — this is what the team wants to propose):
{grant_idea[:2000] if grant_idea else 'Not yet provided'}

USER'S EXISTING SKELETON (if any):
{skeleton_summary}

Your task:
1. Identify where the user's idea clearly addresses call requirements (covered)
2. Identify where the call requires something the idea hasn't addressed (gaps)
3. Identify areas that are ambiguous or unclear in the user's plan
4. Select sub-analyses to run based on the GAPS found (not just call type)
5. Generate 1-3 call-specific questions that go beyond the standard pool

Available pool analyses (always include the 4 core ones plus relevant gap-driven ones):
- core_requirements, evaluation_framework, section_structure, word_budget (always include)
- scientific_rigor, preliminary_data, study_design (for research-type gaps)
- scalability_sustainability, cost_effectiveness, fidelity_quality (for implementation gaps)
- trl_pathway, technical_risk, transition_commercialization (for innovation/tech gaps)
- theory_of_change, mel_equity (for capacity/MEL gaps)

Return JSON:
{{
  "covered": [list of strings — things the idea clearly addresses],
  "gaps": [list of strings — things the call requires that the idea hasn't addressed],
  "ambiguous": [list of strings — unclear or underspecified areas],
  "active_analyses": [list of pool analysis names to run],
  "call_specific_questions": [1-3 specific questions about this call-idea combination],
  "alignment_summary": "2-3 sentence summary of how well the idea fits the call"
}}"""

        response = await chat_complete(
            messages=[
                {"role": "system", "content": "You are analyzing a grant proposal concept against a call. Return only valid JSON."},
                {"role": "user", "content": prompt},
            ],
            agent_name="meta_synthesizer_alignment",
            json_mode=True,
            max_tokens=800,
        )
        result = _parse_json(response)
        if not result:
            return {"active_analyses": _ALWAYS_ON[:], "call_specific_questions": [], "gaps": [], "covered": [], "alignment_summary": ""}

        active = result.get("active_analyses") or []
        for a in _ALWAYS_ON:
            if a not in active:
                active.append(a)
        result["active_analyses"] = [a for a in active if a in _ANALYSIS_POOL]
        return result

    # ------------------------------------------------------------------
    # Step 2/3: Sub-analyses
    # ------------------------------------------------------------------

    async def _run_analysis(
        self,
        name: str,
        call_analysis: dict,
        grant_idea: str,
        existing_skeleton: dict,
    ) -> dict:
        prompt_template = _ANALYSIS_POOL.get(name)
        if not prompt_template:
            return {}

        call_summary = _format_call_summary(call_analysis)
        skeleton_hint = ""
        sections = existing_skeleton.get("sections") or []
        if sections:
            names = [s.get("name") for s in sections[:8] if s.get("name")]
            skeleton_hint = f"\nUSER'S SKELETON SECTIONS: {names}"

        prompt = f"""CALL ANALYSIS (AI-extracted):
{call_summary}

USER'S GRANT IDEA:
{grant_idea[:800] if grant_idea else 'Not provided'}{skeleton_hint}

ANALYSIS TASK:
{prompt_template}

Answer based only on what the call actually states. Return only valid JSON."""

        response = await chat_complete(
            messages=[
                {"role": "system", "content": "You are analyzing a grant call. Return valid JSON only."},
                {"role": "user", "content": prompt},
            ],
            agent_name=f"meta_synthesizer_{name}",
            json_mode=True,
            max_tokens=500,
        )
        result = _parse_json(response) or {}
        result["_analysis_name"] = name
        return result

    async def _run_adhoc_analysis(
        self,
        question: str,
        call_analysis: dict,
        grant_idea: str,
    ) -> dict:
        call_summary = _format_call_summary(call_analysis)
        prompt = f"""CALL ANALYSIS:
{call_summary}

USER'S GRANT IDEA:
{grant_idea[:800] if grant_idea else 'Not provided'}

QUESTION TO ANSWER ABOUT THIS CALL-IDEA COMBINATION:
{question}

Return JSON: {{"question": "...", "answer": "...", "implication_for_proposal": "..."}}"""

        response = await chat_complete(
            messages=[
                {"role": "system", "content": "You are analyzing a specific aspect of a grant call. Return only valid JSON."},
                {"role": "user", "content": prompt},
            ],
            agent_name="meta_synthesizer_adhoc",
            json_mode=True,
            max_tokens=350,
        )
        result = _parse_json(response) or {}
        result["_analysis_name"] = "adhoc"
        return result

    # ------------------------------------------------------------------
    # Step 4: Adversarial review
    # ------------------------------------------------------------------

    async def _adversarial_review(
        self,
        alignment: dict,
        sub_results: list[dict],
        call_analysis: dict,
        grant_idea: str,
    ) -> dict:
        call_summary = _format_call_summary(call_analysis)
        gaps_str = "\n".join(f"- {g}" for g in (alignment.get("gaps") or []))

        devil_prompt = f"""You are a skeptical, rigorous grant reviewer.

CALL (what the funder requires):
{call_summary}

PROPOSED APPROACH (what the team plans to do):
{grant_idea[:1200] if grant_idea else 'Not provided'}

KNOWN GAPS:
{gaps_str or 'None identified'}

What are the 3 most likely reasons this proposal would be REJECTED or scored low?
Be specific — reference actual call requirements where the approach falls short or is unclear.
Do NOT raise generic concerns that don't relate to this specific call.

Return JSON: {{"rejection_risks": [list of 3 specific strings]}}"""

        compliance_prompt = f"""You are a compliance auditor reviewing a grant proposal.

MANDATORY REQUIREMENTS FROM CALL:
{_format_mandatory_items(call_analysis)}

PROPOSED APPROACH:
{grant_idea[:800] if grant_idea else 'Not provided'}

What mandatory requirements or compliance conditions from the call has the proposed approach
NOT addressed or left unclear? Only flag what the call ACTUALLY requires.

Return JSON: {{"compliance_gaps": [list of specific unaddressed items]}}"""

        devil_result, compliance_result = await asyncio.gather(
            chat_complete(
                messages=[{"role": "user", "content": devil_prompt}],
                agent_name="meta_synthesizer_devil",
                json_mode=True,
                max_tokens=400,
            ),
            chat_complete(
                messages=[{"role": "user", "content": compliance_prompt}],
                agent_name="meta_synthesizer_compliance",
                json_mode=True,
                max_tokens=400,
            ),
            return_exceptions=True,
        )

        rejection_risks: list = []
        compliance_gaps: list = []

        if not isinstance(devil_result, Exception):
            d = _parse_json(devil_result) or {}
            rejection_risks = d.get("rejection_risks") or []

        if not isinstance(compliance_result, Exception):
            c = _parse_json(compliance_result) or {}
            compliance_gaps = c.get("compliance_gaps") or []

        return {"rejection_risks": rejection_risks, "compliance_gaps": compliance_gaps}

    # ------------------------------------------------------------------
    # Step 5: Final synthesis
    # ------------------------------------------------------------------

    async def _final_synthesis(
        self,
        alignment: dict,
        sub_results: list[dict],
        adversarial: dict,
        call_analysis: dict,
        funder: str,
        title: str,
    ) -> dict:
        sub_summary = _format_sub_results_summary(sub_results)
        call_type_label = _build_call_type_label(call_analysis, funder)

        prompt = f"""You are synthesizing grant call analysis into guidance for a proposal writing team.

CALL TYPE: {call_type_label}
TITLE: {title}
FUNDER: {funder or 'Unknown'}

ALIGNMENT SUMMARY:
{alignment.get('alignment_summary', '')}

COVERED BY IDEA: {alignment.get('covered', [])}
GAPS TO ADDRESS: {alignment.get('gaps', [])}
AMBIGUOUS AREAS: {alignment.get('ambiguous', [])}

SUB-ANALYSIS RESULTS:
{sub_summary}

ADVERSARIAL REVIEW:
Rejection risks: {adversarial.get('rejection_risks', [])}
Compliance gaps: {adversarial.get('compliance_gaps', [])}

Produce call_intelligence JSON. This is GUIDANCE for the proposal team — it informs and suggests,
it does NOT override the user's own content and plans. The user's idea and skeleton always take precedence.

Return JSON:
{{
  "call_type_label": str,
  "alignment_summary": str,
  "grant_type_context": str (2-3 sentences: what wins for this call, how scoring works, what reviewers prioritize — derived from THIS call specifically),
  "section_blueprint": [
    {{
      "name": str,
      "purpose": str,
      "suggested_word_count": int,
      "required": bool,
      "order": int,
      "evaluation_criterion": str,
      "key_requirements": [list],
      "writing_notes": str
    }}
  ],
  "per_section_writing_guide": {{section_name: "brief guidance string"}},
  "gap_questions": [list of specific questions the user should answer before skeleton generation — about missing elements relative to the call],
  "adversarial_challenges": {{
    "rejection_risks": [list],
    "compliance_gaps": [list]
  }},
  "total_allocated_words": int or null,
  "compliance_checklist": [list of mandatory call requirements],
  "confidence_note": "This intelligence was derived from AI extraction and may contain errors. User inputs take precedence."
}}"""

        response = await chat_complete(
            messages=[
                {"role": "system", "content": "You are synthesizing grant call intelligence into actionable guidance. Return only valid JSON."},
                {"role": "user", "content": prompt},
            ],
            agent_name="meta_synthesizer_synthesis",
            json_mode=True,
            max_tokens=3000,
        )
        result = _parse_json(response)
        if not result:
            return self._fallback_intelligence(alignment, adversarial, call_analysis)

        result.setdefault("adversarial_challenges", adversarial)
        result.setdefault(
            "confidence_note",
            "This intelligence was derived from AI extraction and may contain errors. User inputs take precedence.",
        )
        return result

    # ------------------------------------------------------------------
    # Fallback
    # ------------------------------------------------------------------

    def _fallback_intelligence(
        self,
        alignment: dict,
        adversarial: dict,
        call_analysis: dict,
    ) -> dict:
        return {
            "call_type_label": call_analysis.get("funder_type", ""),
            "alignment_summary": alignment.get("alignment_summary", ""),
            "grant_type_context": "",
            "section_blueprint": [],
            "per_section_writing_guide": {},
            "gap_questions": alignment.get("ambiguous") or [],
            "adversarial_challenges": adversarial,
            "total_allocated_words": None,
            "compliance_checklist": call_analysis.get("required_sections") or [],
            "confidence_note": "Synthesis failed — using minimal fallback. User inputs take precedence.",
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_json(response: str | None) -> dict | None:
    if not response:
        return None
    try:
        return json.loads(response)
    except (json.JSONDecodeError, TypeError):
        return None


def _format_call_summary(call_analysis: dict) -> str:
    parts = []
    if call_analysis.get("narrative_brief"):
        parts.append(f"NARRATIVE BRIEF: {call_analysis['narrative_brief'][:600]}")
    if call_analysis.get("funder_priorities"):
        parts.append("FUNDER PRIORITIES: " + " | ".join(str(p) for p in call_analysis["funder_priorities"][:5]))
    if call_analysis.get("strategic_objectives"):
        parts.append("STRATEGIC OBJECTIVES: " + " | ".join(str(o) for o in call_analysis["strategic_objectives"][:4]))
    if call_analysis.get("thematic_areas"):
        parts.append("THEMATIC AREAS: " + ", ".join(call_analysis["thematic_areas"][:6]))
    if call_analysis.get("evaluation_criteria"):
        parts.append("EVALUATION CRITERIA: " + " | ".join(str(c) for c in call_analysis["evaluation_criteria"][:6]))
    if call_analysis.get("required_sections"):
        parts.append("REQUIRED SECTIONS: " + ", ".join(call_analysis["required_sections"][:10]))
    if call_analysis.get("budget_constraints"):
        parts.append(f"BUDGET: {call_analysis['budget_constraints']}")
    if call_analysis.get("requirements_overview"):
        parts.append("REQUIREMENTS: " + " | ".join(str(r) for r in call_analysis["requirements_overview"][:5]))
    return "\n".join(parts) if parts else "Call analysis not available"


def _format_skeleton_summary(skeleton: dict) -> str:
    if not skeleton:
        return "No existing skeleton"
    sections = skeleton.get("sections") or []
    if not sections and skeleton.get("raw_text"):
        return "Skeleton exists (raw text, no parsed sections)"
    if sections:
        names = [s.get("name") or s.get("title") for s in sections if s.get("name") or s.get("title")]
        return f"Skeleton has {len(sections)} sections: {', '.join(names[:8])}"
    return "No skeleton yet"


def _format_mandatory_items(call_analysis: dict) -> str:
    parts = []
    if call_analysis.get("required_sections"):
        parts.append("Required sections: " + ", ".join(call_analysis["required_sections"]))
    if call_analysis.get("budget_constraints"):
        parts.append(f"Budget constraints: {call_analysis['budget_constraints']}")
    if call_analysis.get("requirements_overview"):
        parts.append("Requirements: " + " | ".join(str(r) for r in call_analysis["requirements_overview"][:8]))
    return "\n".join(parts) if parts else "Not specified"


def _format_sub_results_summary(sub_results: list[dict]) -> str:
    if not sub_results:
        return "No sub-analysis results"
    lines = []
    for r in sub_results:
        name = r.get("_analysis_name", "unknown")
        content = {k: v for k, v in r.items() if not k.startswith("_")}
        if content:
            lines.append(f"[{name}]: {json.dumps(content)[:400]}")
    return "\n".join(lines[:12]) if lines else "No content"


def _extract_sub_result(sub_results: list[dict], name: str) -> dict:
    for r in sub_results:
        if r.get("_analysis_name") == name:
            return {k: v for k, v in r.items() if not k.startswith("_")}
    return {}


def _build_call_type_label(call_analysis: dict, funder: str) -> str:
    funder_type = call_analysis.get("funder_type", "")
    program = call_analysis.get("program_name", "")
    parts = []
    if funder:
        parts.append(funder)
    if program:
        parts.append(program)
    elif funder_type and funder_type != "other":
        parts.append(funder_type.upper().replace("_", " "))
    return " — ".join(parts) if parts else "Grant Call"

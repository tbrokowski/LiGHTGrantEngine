"""
Agent 1: Call Analyzer
Two-stage pipeline:
  Stage 1 (_scan_document_structure): fast structural scan — identifies which sections
    exist in the document (background, objectives, eligibility, requirements, etc.)
    and extracts the key text/snippets from each. Capped at first 60k chars.
  Stage 2 (_analyze_chunk): deep extraction guided by the structure map produced in
    Stage 1. Returns a rich JSON schema including new fields (call_background,
    strategic_objectives, key_focus_areas, key_phrases, requirements_overview,
    funder_priorities) alongside all existing fields.

Short-document shortcut: documents under 25k chars skip Stage 1 and go straight to
Stage 2 with a no-structure-map enriched prompt — the model can hold the full
document in context natively.

For very long documents (> 400k chars) the existing chunking logic is preserved.
"""
import json
import logging
import re
import asyncio
from collections.abc import Callable
from app.ai.client import chat_complete

logger = logging.getLogger(__name__)


def _parse_llm_json(response: str) -> dict:
    """Parse JSON from an LLM response, tolerating markdown fences and trailing text.

    Also unwraps single-key wrapper responses like {"analysis": {...}} or
    {"result": {...}} so callers always see a flat field dict.
    """
    if not response or not response.strip():
        return {}
    text = response.strip()
    parsed: dict | None = None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        pass
    if parsed is None:
        # Extract ```json ... ``` or ``` ... ``` block
        fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.IGNORECASE)
        if fence:
            try:
                parsed = json.loads(fence.group(1).strip())
            except json.JSONDecodeError:
                pass
    if parsed is None:
        # First balanced { ... } object
        start = text.find("{")
        if start >= 0:
            depth = 0
            for i, ch in enumerate(text[start:], start):
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        try:
                            parsed = json.loads(text[start : i + 1])
                        except json.JSONDecodeError:
                            pass
                        break
    if not parsed:
        return {}
    # Unwrap single-key wrapper responses: {"analysis": {...}} → {...}
    if len(parsed) == 1:
        only_val = next(iter(parsed.values()))
        if isinstance(only_val, dict) and len(only_val) >= 3:
            return only_val
    return parsed


def _analysis_has_content(result: dict) -> bool:
    """True if the analysis dict contains user-visible content.

    Checks known field names first (fast path), then falls back to a
    structural check: if the model returned a rich dict with 5+ non-empty
    values that are not just error/metadata keys, accept it even if the
    field names differ from what we expect (guards against minor schema drift).
    """
    if not result:
        return False
    # Fast path: known text fields
    if result.get("narrative_brief") or result.get("summary"):
        return True
    # Known list/dict fields
    list_fields = (
        "call_background", "funder_priorities", "strategic_objectives",
        "requirements_overview", "winning_factors", "required_sections", "evaluation_criteria",
        "eligibility_checklist", "risks", "missing_information", "thematic_areas",
        "key_phrases", "key_focus_areas",
    )
    for field in list_fields:
        val = result.get(field)
        if isinstance(val, list) and len(val) > 0:
            return True
        if isinstance(val, dict) and len(val) > 0:
            return True
    if result.get("section_requirements"):
        return True
    scalar_fields = (
        "budget_constraints", "geographic_eligibility", "award_amount",
        "submission_portal", "required_partners",
    )
    if any(result.get(f) for f in scalar_fields):
        return True
    # Fallback: accept any response that has 5+ populated keys outside of
    # error/parse-metadata keys — this handles minor field-name schema drift.
    skip = {"error", "raw_response"}
    populated = sum(
        1 for k, v in result.items()
        if k not in skip and v not in (None, "", [], {})
    )
    if populated >= 5:
        logger.warning(
            "call_analyzer: _analysis_has_content fallback triggered — "
            "model returned %d populated keys not matching known schema: %s",
            populated,
            list(result.keys())[:15],
        )
        return True
    return False

SYSTEM_PROMPT = """You are a senior grant strategist with 20+ years of experience writing and reviewing
major competitive grants: NIH R01/R21/R34, NSF, ERC, Horizon Europe, Wellcome Trust, Gates Foundation,
BARDA, DOD/DARPA, USAID, and private foundations.

Your role is to extract structured, actionable intelligence from grant call documents so proposal teams
can WIN — not just comply.

Five principles you always apply:
1. QUOTE DIRECTLY. Use the funder's exact language wherever possible. Reviewers reward proposals
   that echo call language precisely. Paraphrase only when no direct quote is available.
2. SURFACE WHAT WINS. Every call has 2-3 things reviewers weight most heavily. Find them, name them,
   and make sure they appear prominently in every relevant field.
3. BE SPECIFIC. "Must demonstrate clinical validation in 2+ independent sites" beats "show validation".
   Strip every generic phrase and replace it with what THIS call specifically requires.
4. FLAG DISQUALIFIERS. Eligibility gotchas, mandatory section requirements, page limits, institutional
   restrictions — missing any of these means instant rejection. Flag them loudly.
5. FOCUS ON PROJECT PLAN AND RESEARCH PROPOSAL. These sections — work plan, methodology, innovation,
   and impact — are where proposals are won or lost. Extract explicit requirements for these above all.

Always respond with valid JSON matching the schema requested. Never wrap JSON in a parent key."""

CHUNK_SIZE = 400_000  # GPT-4o supports 128k tokens (~512k chars) — covers any real-world grant document
CHUNK_OVERLAP = 500
SHORT_DOC_THRESHOLD = 60_000   # chars — skip Stage 1 structure scan below this
SCAN_CAP = 60_000              # chars fed to Stage 1 structure scan
STAGE2_INPUT_CAP = 120_000     # max chars sent to Stage 2 for single-chunk docs

# Progress labels cycled during the extraction LLM call (fires every 3.5 s)
_EXTRACTION_PROGRESS_LABELS = [
    "Analyzing call context and background…",
    "Identifying funder priorities and key objectives…",
    "Mapping eligibility and team requirements…",
    "Extracting evaluation criteria and scoring weights…",
    "Analyzing project plan and methodology requirements…",
    "Identifying deadlines, budget constraints, and format rules…",
    "Synthesizing call intelligence…",
    "Compiling analysis…",
]


# ---------------------------------------------------------------------------
# Grant-type context templates
# ---------------------------------------------------------------------------

_GRANT_TYPE_CONTEXTS: dict[str, str] = {
    "nih": """GRANT TYPE: NIH (National Institutes of Health)
SCORING SYSTEM: Impact Score 1-9 (1=exceptional). Five criteria: Significance, Investigators,
  Innovation, Approach, Environment. Reviewers score each; overall impact score drives funding.
CRITICAL FOR WINNING:
- Specific Aims page (1 page): must be perfect — reviewers read this first; it often determines
  the fate of the full application. State the problem, long-term goal, overall objective, central
  hypothesis, and 3-4 specific aims with expected outcomes.
- Innovation: NIH explicitly scores how the proposal shifts existing paradigms. Quote the call's
  stated research gaps and explain exactly how this work addresses them.
- Approach: Reviewers look for rigorous experimental design, consideration of pitfalls and
  alternatives, and statistical power. Missing power calculations = weak score.
- Preliminary Data: Expected for R01s. Demonstrate feasibility. Show the team HAS done this before.
- Human Subjects / Vertebrate Animals: Separate scored attachments. Oversight required.
KEY LANGUAGE TO EXTRACT: "scientific premise", "rigor and reproducibility", "biological variables",
  "inclusion of diverse populations", study section name, PO contact, ESI/NI eligibility flags.""",

    "nsf": """GRANT TYPE: NSF (National Science Foundation)
SCORING SYSTEM: Two mandatory criteria scored equally — Intellectual Merit (scientific quality,
  innovation, impact on the field) and Broader Impacts (societal benefits, STEM education,
  underrepresented groups, infrastructure). Both MUST be explicitly addressed.
CRITICAL FOR WINNING:
- Every section of the proposal must thread both Intellectual Merit AND Broader Impacts.
  Reviewers are required to comment on both — proposals silent on either are returned without review.
- Project Description: typically 15 pages. Dense. Every sentence earns its place.
- Data Management Plan: required attachment. NSF takes open-data requirements seriously.
- Broader Impacts: many teams lose here. Concrete plans for education, outreach, and diversity
  are far stronger than vague statements.
KEY LANGUAGE TO EXTRACT: program solicitation number, Dear Colleague Letter if applicable,
  any special eligibility (EPSCoR, HBCU, MSI), "transformative research" language, review panel.""",

    "ec_horizon": """GRANT TYPE: European Commission — Horizon Europe / Horizon 2020
SCORING SYSTEM: Three criteria each scored 0-5 (threshold 3.5 each; combined threshold 10):
  1. Excellence (scientific quality, methodology, interdisciplinarity, openness)
  2. Impact (expected outcomes, KPIs, exploitation, dissemination, EU added value)
  3. Implementation (work plan, WP structure, milestones, team expertise, budget)
CRITICAL FOR WINNING:
- Part B Technical Description drives the score. Three sections map exactly to the criteria.
  Excellence ≠ just being good science — it means advancing the state of the art beyond current EU
  projects. Be explicit about what gap this fills that existing projects don't.
- Impact section must include a concrete Dissemination & Exploitation Plan, measurable KPIs,
  TRL trajectory (state TRL at start and end), and how results will persist after funding ends.
- Work Packages: Every WP needs a lead, partners, tasks, deliverables, and milestones. WP1 is
  always management. Missing this structure = low Implementation score.
- Open Science: FAIR data management plan, open access publications, and open-source software
  commitments are explicitly scored.
- Budget eligibility: Personnel rates per country, 25% flat-rate overhead for most entities,
  subcontracting rules (≤ work share), third-party contributions.
KEY LANGUAGE TO EXTRACT: Topic identifier (e.g. HORIZON-HLTH-2025-DISEASE-07-01), TRL levels,
  expected outcomes as stated in the Work Programme, consortium requirements (SME involvement,
  country balance), page limits per section, submission system (F&T Portal).""",

    "sbir": """GRANT TYPE: SBIR / STTR (Small Business Innovation Research / Technology Transfer)
SCORING SYSTEM: Dual review — Technical Merit + Commercialization Potential. Both must be strong.
  Phase I: feasibility demonstration. Phase II: full R&D + commercialization plan.
CRITICAL FOR WINNING:
- Commercialization Potential is scored separately and equally to technical merit. A technically
  brilliant proposal with a weak commercialization section will not score well.
- TRL Trajectory: Clearly state current TRL and the TRL you will reach at Phase I/II end.
  Reviewers expect Phase I to advance from ~TRL 2-3 to TRL 4-5; Phase II to TRL 6-7+.
- Team: SBIR requires the small business to do ≥51% of work. STTR requires university partner to
  do ≥30%. Document IP assignment agreements.
- Market Analysis: TAM/SAM/SOM, competitive landscape, regulatory pathway (FDA clearance? 510k?),
  and a realistic pathway to revenue within 2-3 years of Phase II end.
KEY LANGUAGE TO EXTRACT: specific SBIR topic number, technical focus area, agency point of contact
  (TPOC), phase transition expectations, matching fund requirements, IP ownership terms.""",

    "foundation": """GRANT TYPE: Private Foundation (Gates, Wellcome, Bloomberg, Bezos Earth Fund, etc.)
SCORING SYSTEM: Varies by foundation but typically: Theory of Change clarity, evidence base,
  implementation feasibility, team credibility, geographic/population reach, and value for money.
CRITICAL FOR WINNING:
- Theory of Change: Foundations invest in change, not just research. Articulate clearly:
  inputs → activities → outputs → outcomes → impact. Make causal logic explicit.
- Alignment with Foundation Strategy: Most major foundations publish strategic frameworks. Show
  how this work sits inside their stated strategic priorities — use their language exactly.
- Monitoring, Evaluation & Learning (MEL): Funders expect a MEL plan with baseline data,
  milestones, and how learnings will be shared. "We will evaluate success by X metric" is weak;
  "We will commission a mixed-methods evaluation against Y baseline with Z frequency" is strong.
- Geographic Reach / Equity: Most foundations prioritize LMIC contexts, underserved populations,
  or specific geographies. Show how the work reaches those the funder cares about.
KEY LANGUAGE TO EXTRACT: foundation's stated priority areas, required report cadence, co-funding
  expectations, indirect cost limits (often 10-15%), open-access publication requirements.""",

    "dod": """GRANT TYPE: DOD / DARPA / AFRL / ONR / ARPA-E
SCORING SYSTEM: Technical merit, military/national relevance, and team credentials. For DARPA:
  technical risk tolerance is HIGH — they fund the "impossible" with credible plans to attempt it.
CRITICAL FOR WINNING:
- Broad Agency Announcements (BAAs) and Solicitations have specific Technical Areas (TAs) or
  Technical Focus Areas. Align every section to the stated TA explicitly.
- White Paper (if required): 5-8 page precursor reviewed before full proposal invitation.
  Spend most effort here — TPOC feedback shapes the full proposal.
- DARPA: Propose something genuinely bold. "Incremental improvement" proposals are routinely
  declined. Phrase ambition in specific, testable milestones with clear go/no-go criteria.
- Transition Plan: DOD cares about how technology transitions from lab to operational capability
  (ACAT programs, PMs, transition partners). Identify the acquisition pathway.
- Security / ITAR / CUI: Flag any ITAR-controlled technology early. Classified work needs SCIF.
KEY LANGUAGE TO EXTRACT: solicitation number, TPOC name and email, technical area numbers,
  security classification requirements, prototype OT eligibility, SBIR/STTR linkage if stated.""",

    "other": """GRANT TYPE: General / Other Competitive Grant
GRANT WRITING BEST PRACTICES — applied when specific funder type is unknown:
- ALIGNMENT: Every paragraph must connect your work to the funder's stated goals. Use their
  exact language. Reviewers reward proposals that echo the call document.
- SPECIFICITY: Replace every generic phrase with a specific, verifiable claim. "We have
  extensive experience" → "We have completed 5 peer-reviewed studies in X with N participants."
- LOGIC MODEL: Problem → Gap → Proposed Solution → Expected Outcomes → Measurable Impact.
  Make the causal chain explicit and unambiguous.
- TEAM FIT: Explain why THIS team is uniquely qualified. Highlight relevant prior work, existing
  infrastructure, and named collaborators with specific roles.
- BUDGET JUSTIFICATION: Every line item must be justified against a deliverable. Reviewers
  scrutinize whether the requested budget is proportionate to the proposed work.
- RISK MITIGATION: Name the 3 biggest risks and describe specific mitigation plans. Pretending
  there are no risks signals inexperience.""",
}

_GRANT_TYPE_CLASSIFIER_PROMPT = """Classify this grant call document and return a JSON object.
Read the first portion of the document and identify the funder type.

Return ONLY a JSON object with:
  funder_type        string — one of: "nih"|"nsf"|"ec_horizon"|"sbir"|"foundation"|"dod"|"other"
  program_name       string — the specific program or scheme name (e.g. "Horizon Europe", "R01")
  scoring_framework  list[string] — the main review criteria as stated (e.g. ["Significance","Innovation","Approach"])
  key_sections       list[string] — proposal sections explicitly required by this call
  critical_extras    list[string] — 3-5 things this funder type specifically requires that generic calls don't
  funder_name        string — the full name of the funding organization"""


# ---------------------------------------------------------------------------
# Stage 0: Grant type classifier
# ---------------------------------------------------------------------------

async def _classify_grant_type(call_text: str, funder: str) -> dict:
    """Stage 0 — ultra-fast grant type classification using first 3k chars + funder name.

    Returns a classification dict used to inject type-specific context into Stage 2.
    Uses gpt-4o-mini for speed (response < 300 tokens, latency ~1s).
    """
    sample = call_text[:3000]
    prompt = f"""FUNDER: {funder or "Unknown"}

DOCUMENT (first portion):
{sample}

{_GRANT_TYPE_CLASSIFIER_PROMPT}"""

    response = await chat_complete(
        messages=[
            {"role": "system", "content": "You are classifying a grant call document. Return only valid JSON."},
            {"role": "user", "content": prompt},
        ],
        agent_name="call_analyzer_classifier",
        json_mode=True,
        max_tokens=300,
    )
    result = _parse_llm_json(response)
    if result:
        logger.info(
            "call_analyzer stage0: classified as funder_type=%s program=%s",
            result.get("funder_type"), result.get("program_name"),
        )
    return result or {"funder_type": "other"}


def _build_grant_type_context(classification: dict) -> str:
    """Build the GRANT TYPE CONTEXT block injected into the Stage 2 prompt."""
    funder_type = classification.get("funder_type", "other")
    template = _GRANT_TYPE_CONTEXTS.get(funder_type, _GRANT_TYPE_CONTEXTS["other"])

    extras: list[str] = []
    if classification.get("scoring_framework"):
        extras.append("SCORING CRITERIA: " + " | ".join(classification["scoring_framework"]))
    if classification.get("key_sections"):
        extras.append("REQUIRED SECTIONS: " + ", ".join(classification["key_sections"]))
    if classification.get("critical_extras"):
        extras.append("FUNDER-SPECIFIC EXTRAS:\n" + "\n".join(f"  - {e}" for e in classification["critical_extras"]))

    suffix = "\n" + "\n".join(extras) if extras else ""
    return template + suffix


# ---------------------------------------------------------------------------
# Progress ticker
# ---------------------------------------------------------------------------

async def _progress_ticker(
    on_step: Callable[[list[dict]], None],
    pre_steps: list[dict],
    interval: float = 3.5,
) -> None:
    """Background coroutine: emit on_step with rotating labels every `interval` seconds.

    Runs in parallel with the extraction LLM call. Cancelled when extraction returns.
    The `pre_steps` list contains the already-done steps before the active extract step.
    """
    labels = list(_EXTRACTION_PROGRESS_LABELS)
    for label in labels:
        await asyncio.sleep(interval)
        on_step([
            *pre_steps,
            {"id": "extract", "label": label, "status": "active"},
            {"id": "save", "label": "Saving Call Intelligence", "status": "pending"},
        ])
    # Keep repeating the last label if extraction still running after all labels
    while True:
        await asyncio.sleep(interval)
        on_step([
            *pre_steps,
            {"id": "extract", "label": "Compiling analysis…", "status": "active"},
            {"id": "save", "label": "Saving Call Intelligence", "status": "pending"},
        ])


# ---------------------------------------------------------------------------
# Stage 1: Structure scan
# ---------------------------------------------------------------------------

async def _scan_document_structure(call_text: str, funder: str) -> dict:
    """
    Stage 1 — fast structural pass over the document (first SCAN_CAP chars).

    Returns a JSON object describing:
      - sections_found: list of {name, type, key_content} for each major section
      - background_text: excerpt that contains the funder's background/motivation
      - objectives_text: excerpt that states the call's objectives/goals
      - requirements_text: excerpt that contains proposal requirements
      - key_themes: list of high-level themes/topics the call addresses
      - funder_context: 2-3 sentence description of who the funder is and why
        they are running this call

    This map is then fed into Stage 2 to guide deep extraction.
    """
    sample = call_text[:SCAN_CAP]
    prompt = f"""You are scanning a grant call document to map its structure before a deeper analysis pass.

FUNDER: {funder}

DOCUMENT TEXT (first portion):
{sample}

Return a JSON object with:

- sections_found: list of objects, one per major document section you can identify:
    {{"name": str, "type": "background"|"objectives"|"requirements"|"eligibility"|"evaluation"|"budget"|"submission"|"other", "key_content": str}}
  key_content should be a 2-5 sentence excerpt or paraphrase of the core content of that section.

- background_text: The most relevant excerpt (up to 500 words) from the document that explains
  WHY this call exists — the problem being addressed, program history, funder motivation.

- objectives_text: The most relevant excerpt (up to 300 words) that states WHAT the funder
  wants to achieve — goals, expected outcomes, success criteria.

- requirements_text: The most relevant excerpt (up to 400 words) that lists what a proposal
  MUST contain, demonstrate, or deliver.

- key_themes: list of 4-8 high-level themes or topic areas this call focuses on (short strings).

- funder_context: 2-3 sentence description of the funder's mission and why they are running
  this specific call now.
"""
    response = await chat_complete(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        agent_name="call_analyzer_scan",  # uses gpt-4o-mini via config override
        json_mode=True,
    )
    return _parse_llm_json(response)


# ---------------------------------------------------------------------------
# Stage 2: Deep extraction
# ---------------------------------------------------------------------------

async def _analyze_chunk(
    chunk_text: str,
    chunk_index: int,
    total_chunks: int,
    call_url: str,
    funder: str,
    extra_instructions: str = "",
    structure_map: dict | None = None,
    grant_type_ctx: str = "",
) -> dict:
    """Stage 2 deep extraction — schema-first prompt with type-specific context and direct-quote requirements.

    Prompt structure: grant type context → output schema → document → "produce now".
    This ensures the model knows exactly what to extract AND how to frame it as it reads.
    """
    chunk_note = (
        f"(Chunk {chunk_index + 1}/{total_chunks} — extract everything in this section; "
        "a merge pass will unify all chunks.)"
        if total_chunks > 1
        else ""
    )

    structure_context = ""
    if structure_map:
        structure_context = (
            "─── DOCUMENT STRUCTURE MAP ────────────────────────────────────────────────────\n"
            "Use this map to locate information precisely — do not re-read the full doc for each field.\n"
            + json.dumps(structure_map, indent=2)
            + "\n\n"
        )

    type_context_block = (
        f"─── GRANT TYPE CONTEXT ─────────────────────────────────────────────────────────\n{grant_type_ctx}\n\n"
        if grant_type_ctx
        else ""
    )

    user_prompt = f"""You are extracting structured intelligence from a grant call document so a proposal
team can write a winning proposal. Return ONLY a valid JSON object with the fields below.

FUNDER: {funder or "Unknown"}
CALL URL: {call_url or "N/A"}
{f"NOTE: {extra_instructions}" if extra_instructions else ""}{f"NOTE: {chunk_note}" if chunk_note else ""}

{type_context_block}{structure_context}
─── QUOTING RULES ──────────────────────────────────────────────────────────────
For funder_priorities, strategic_objectives, requirements_overview, and winning_factors:
  - ALWAYS use the funder's exact language in quotes where possible
  - Format: "\"[exact phrase from document]\" — [1-sentence interpretation, ≤15 words]"
  - If no exact quote is available, paraphrase tightly and note it's a paraphrase
  - Strip all generic grant-writing boilerplate — every bullet must be specific to THIS call

─── REQUIRED JSON FIELDS ───────────────────────────────────────────────────────

summary
  string — 2-3 sentence plain-English overview of what this call funds, who it targets, and the
  expected outcome. Include the call reference number if found.

narrative_brief
  string — 4-paragraph actionable synthesis for the proposal team:
    (1) What the funder wants to achieve and the specific gap/problem they are funding a solution for
        (quote key phrases from the document)
    (2) What a WINNING proposal MUST contain, demonstrate, and deliver — be concrete and call-specific,
        not generic. Focus on the project plan, methodology, and research proposal requirements.
    (3) Team composition, eligibility, consortium requirements, and any critical partnership mandates
    (4) Critical constraints, budget rules, page limits, and the top 2-3 disqualifiers to avoid
  Write as tight, actionable prose. No generic policy language. Each paragraph must give the team
  a concrete action or decision.

call_background
  list[string] — 5-8 bullets on background/context/funder motivation. Each bullet = one complete
  informative sentence. Cover: the problem being addressed, why now, program history, funder's
  strategic motivation, sector context.

funder_priorities
  list[string] — 4-6 strings, highest priority first. Use the funder's EXACT language:
  "\"[exact phrase from call]\" — [why this is top priority, ≤12 words]"
  Pull phrases that are repeated, appear in scoring criteria, or are bolded/emphasized.

strategic_objectives
  list[string] — 4-8 outcome strings stating what the funder explicitly defines as success.
  Use the call's language: "Call states: \"[quote]\" — proposals must [concrete deliverable, ≤12 words]"
  Include specific KPIs, TRLs, measurable targets, or milestones if stated.

key_focus_areas
  list[{{"area":str, "description":str, "why_it_matters":str}}]
  area = the focus area name as used in the document.
  description = what proposals in this area must address (quote the call where possible).
  why_it_matters = why the funder has prioritized this area (1 sentence).

key_phrases
  list[{{"phrase":str, "context":str, "significance":str}}] — 8-12 items.
  phrase = exact quoted text from the document (3-20 words).
  context = one sentence on where/how it appears.
  significance = why a proposal MUST echo or address this phrase.

requirements_overview
  list[string] — 6-10 MANDATORY requirements for a competitive proposal.
  Format: "\"[Requirement from call]\" — key for [section], [why it scores high, ≤10 words]"
  FOCUS ON: project plan, methodology, innovation, impact demonstration. NOT generic sections.

winning_factors
  list[string] — 5-8 bullets on what separates FUNDED from merely adequate proposals.
  Derived from scoring weights, call emphasis, evaluation criteria, and repeated language.
  Be specific: "Preliminary data demonstrating [exact X from call]" not "strong track record".
  Format: "[Specific factor per this call] — [concrete evidence or demonstration needed, ≤12 words]"

eligibility_checklist
  list[{{"item":str, "met":true/false/null, "notes":str, "critical":bool}}]
  Flag all hard eligibility criteria. critical=true for any that would disqualify the team.

required_sections
  list[string] — proposal sections explicitly required by the call (use exact names from the document).

section_requirements
  object mapping each required section name to:
  {{
    "requirements": str,           — one-sentence purpose of this section per the call
    "word_limit": int|null,
    "page_limit": str|null,
    "priority": "high"|"medium"|"low",
    "key_asks": [str],             — 3-6 bullets of what the funder explicitly asks for IN THIS SECTION
                                     (quote the call); focus on project plan and research proposal
    "questions_to_address": [str], — 3-5 strategic questions THIS SECTION must answer to score high
    "evidence_needed": [str],      — 2-4 specific data points, proof, or citations this section needs
    "critical_differentiator": str, — one sentence: what separates excellent from adequate IN THIS SECTION
    "direct_quote": str            — the exact phrase from the call that defines this section's purpose
  }}

deadlines
  object — {{"full_proposal":str|null, "loi":str|null, "concept_note":str|null, "questions_due":str|null}}

budget_constraints
  string — full description: total budget, per-year limit, indirect cost rules, eligible cost
  categories, sub-contracting limits, cost-sharing requirements. Quote specific figures.

evaluation_criteria
  list[string] — evaluation criteria EXACTLY as stated in the call, with weights/scores if given.

required_partners
  string — consortium, co-PI, sub-award, or institutional partner requirements. Minimum/maximum
  partner counts, required partner types (SME, university, LMIC, etc.).

risks
  list[string] — risks or concerns for our team: eligibility gaps, competitive landscape issues,
  technical challenges explicitly flagged in the call, or budget concerns.

missing_information
  list[string] — things not stated in the call that we need to find out before applying.

recommended_next_steps
  list[string] — numbered, time-ordered immediate actions the team should take.

thematic_areas    list[string]  — themes/topics this call addresses (use exact call language).
geographic_eligibility string   — geographic scope, country restrictions, or LMIC requirements.
award_amount      string        — exact funding amount, range, or description per the call.
project_duration  string        — project duration.
submission_portal string        — submission platform, system, or email address.
page_limit        string|null   — overall page limit if stated.
word_limit        string|null   — overall word limit if stated.
format_requirements string      — font, margins, file format, naming conventions if stated.
foa_number        string        — official solicitation, FOA, topic, or call reference number.
contact_info      string        — program officer name, email, questions deadline.

─── GRANT CALL DOCUMENT ────────────────────────────────────────────────────────
{chunk_text}
────────────────────────────────────────────────────────────────────────────────

Return the JSON object now. Fill every field from the document above. Use direct quotes wherever
possible. Do not wrap in a parent key. Do not add any text outside the JSON."""

    response = await chat_complete(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        agent_name="call_analyzer",
        json_mode=True,
    )
    parsed = _parse_llm_json(response)
    if parsed and _analysis_has_content(parsed):
        return parsed
    if parsed:
        logger.warning(
            "call_analyzer _analyze_chunk: content check failed — keys=%s response_len=%d",
            list(parsed.keys())[:20],
            len(response or ""),
        )
        return parsed
    logger.warning(
        "call_analyzer _analyze_chunk: JSON parse failed — response_len=%d preview=%.300s",
        len(response or ""),
        (response or "")[:300],
    )
    return {
        "error": "Failed to parse analysis response from the model",
        "raw_response": (response or "")[:2000],
    }


async def _simple_fallback_analyze(
    call_text: str,
    funder: str,
    call_url: str,
) -> dict:
    """Minimal-prompt fallback guaranteed to return at least the core fields.

    Used when the rich extraction produces no usable content. Focuses on the
    5 most critical fields only so the model can't return an empty response.
    """
    user_prompt = f"""You are analyzing a grant call document.
Return a JSON object with EXACTLY these fields:

summary          — 2-3 sentence overview of what this grant funds.
narrative_brief  — 3-4 paragraph synthesis for the proposal team covering:
                   (1) funder goal & problem, (2) what proposals must deliver,
                   (3) eligibility requirements, (4) key constraints & pitfalls.
requirements_overview — list of 5-8 bullet strings on key proposal requirements.
eligibility_checklist — list of eligibility items as {{"item":str,"critical":bool}}.
deadlines        — object with full_proposal, loi, concept_note (null if unknown).
call_background  — list of 4-6 bullets on why this call exists / funder context.
thematic_areas   — list of themes this call addresses.
award_amount     — funding amount or range.

FUNDER: {funder or "Unknown"}
URL: {call_url or "N/A"}

DOCUMENT:
{call_text[:60000]}

Return the JSON object now."""

    response = await chat_complete(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        agent_name="call_analyzer",
        json_mode=True,
        max_tokens=4000,
    )
    parsed = _parse_llm_json(response)
    if parsed:
        logger.info(
            "call_analyzer simple fallback succeeded — keys=%s",
            list(parsed.keys())[:10],
        )
    return parsed or {}


# ---------------------------------------------------------------------------
# Merge
# ---------------------------------------------------------------------------

def _merge_chunk_results(chunks: list[dict]) -> dict:
    """Merge results from multiple chunk analyses into a single coherent result."""
    if len(chunks) == 1:
        return chunks[0]

    # Concatenate narrative briefs
    briefs = [c.get("narrative_brief", "") for c in chunks if c.get("narrative_brief")]
    merged: dict = {"narrative_brief": "\n\n".join(briefs)}

    # Use first non-empty summary
    for c in chunks:
        if c.get("summary"):
            merged["summary"] = c["summary"]
            break

    # Simple list fields — deduplicate by string value
    list_fields = [
        "eligibility_checklist", "required_sections", "evaluation_criteria",
        "risks", "missing_information", "recommended_next_steps", "thematic_areas",
        "call_background", "funder_priorities", "strategic_objectives",
        "requirements_overview", "winning_factors", "key_phrases", "key_focus_areas",
    ]
    for field in list_fields:
        seen: set[str] = set()
        merged_list = []
        for c in chunks:
            for item in c.get(field) or []:
                key = json.dumps(item, sort_keys=True) if isinstance(item, dict) else str(item)
                if key not in seen:
                    seen.add(key)
                    merged_list.append(item)
        if merged_list:
            merged[field] = merged_list

    # Dict-list fields deduplicated by a unique key within each object
    dict_list_fields = [
        ("key_focus_areas", "area"),
        ("key_phrases", "phrase"),
    ]
    for field, key_attr in dict_list_fields:
        seen_keys: set[str] = set()
        merged_list2 = []
        for c in chunks:
            for item in c.get(field) or []:
                k = str(item.get(key_attr, json.dumps(item, sort_keys=True)))
                if k not in seen_keys:
                    seen_keys.add(k)
                    merged_list2.append(item)
        if merged_list2:
            merged[field] = merged_list2

    # Merge section_requirements dicts
    sec_reqs: dict = {}
    for c in chunks:
        sec_reqs.update(c.get("section_requirements") or {})
    if sec_reqs:
        merged["section_requirements"] = sec_reqs

    # Scalar fields — first non-null value wins
    scalar_fields = [
        "deadlines", "budget_constraints", "required_partners",
        "geographic_eligibility", "award_amount", "project_duration",
        "submission_portal", "page_limit", "word_limit", "format_requirements",
        "foa_number", "contact_info",
    ]
    for field in scalar_fields:
        for c in chunks:
            if val := c.get(field):
                merged[field] = val
                break

    return merged


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def analyze_call(
    call_text: str,
    call_url: str = "",
    funder: str = "",
    extra_instructions: str = "",
    skip_structure_scan: bool = False,
    on_step: Callable[[list[dict]], None] | None = None,
) -> dict:
    """
    Analyze a grant call document using a three-stage pipeline.

    Stage 0: _classify_grant_type — ultra-fast grant ecosystem identification (gpt-4o-mini, ~1s).
      Runs in parallel with Stage 1 for long documents; sequential for short ones.
      Produces a type context block injected into Stage 2.

    Stage 1 (skipped for short docs < SHORT_DOC_THRESHOLD chars, or when skip_structure_scan=True):
      _scan_document_structure — fast structural pass (gpt-4o-mini) identifying sections
      and extracting key text excerpts.

    Stage 2:
      _analyze_chunk — deep extraction guided by the Stage 1 structure map (if available)
      AND the Stage 0 type context. Produces a rich JSON with direct-quoted priorities,
      type-specific winning factors, and detailed section requirements.

    skip_structure_scan=True skips Stage 1 entirely (used on re-analyze for speed).
    on_step: optional sync callback(list[dict]) called at each progress milestone AND every
      3.5 seconds during extraction so the UI shows meaningful intermediate labels.
    """
    if not call_text:
        return {"error": "No call text provided"}

    run_stage1 = not skip_structure_scan and len(call_text) > SHORT_DOC_THRESHOLD

    # Stage 0: grant type classification (run concurrently with Stage 1 for long docs)
    classification: dict = {}
    grant_type_ctx: str = ""
    structure_map: dict | None = None
    if run_stage1:
        # For long docs: start Stage 0 and Stage 1 as concurrent tasks.
        # Stage 0 only reads the first 3k chars; Stage 1 reads first 60k. No session involved —
        # both are pure LLM calls, so concurrent use is safe here.
        if on_step:
            on_step([
                {"id": "parse",   "label": "Document text loaded",              "status": "done"},
                {"id": "classify","label": "Identifying grant type…",           "status": "active"},
                {"id": "scan",    "label": "Scanning document structure…",      "status": "pending"},
                {"id": "extract", "label": "Extracting requirements",           "status": "pending"},
                {"id": "save",    "label": "Saving Call Intelligence",          "status": "pending"},
            ])
        classify_task = asyncio.create_task(_classify_grant_type(call_text, funder))
        structure_map = await _scan_document_structure(call_text, funder)
        try:
            classification = await classify_task
        except Exception:
            classification = {"funder_type": "other"}
        grant_type_ctx = _build_grant_type_context(classification)
        if on_step:
            on_step([
                {"id": "parse",   "label": "Document text loaded",              "status": "done"},
                {"id": "classify","label": f"Grant type: {classification.get('program_name', classification.get('funder_type', 'identified'))}",
                 "status": "done"},
                {"id": "scan",    "label": "Document structure mapped",         "status": "done"},
                {"id": "extract", "label": "Extracting requirements and context…", "status": "active"},
                {"id": "save",    "label": "Saving Call Intelligence",          "status": "pending"},
            ])
    else:
        # Short doc or re-analyze: Stage 0 and skip Stage 1, sequential is fine
        if on_step:
            on_step([
                {"id": "parse",   "label": "Document text loaded",             "status": "done"},
                {"id": "classify","label": "Identifying grant type…",          "status": "active"},
                {"id": "extract", "label": "Extracting requirements",          "status": "pending"},
                {"id": "save",    "label": "Saving Call Intelligence",         "status": "pending"},
            ])
        try:
            classification = await _classify_grant_type(call_text, funder)
        except Exception:
            classification = {"funder_type": "other"}
        grant_type_ctx = _build_grant_type_context(classification)
        if on_step:
            on_step([
                {"id": "parse",   "label": "Document text loaded",             "status": "done"},
                {"id": "classify","label": f"Grant type: {classification.get('program_name', classification.get('funder_type', 'identified'))}",
                 "status": "done"},
                {"id": "extract", "label": "Extracting requirements and context…", "status": "active"},
                {"id": "save",    "label": "Saving Call Intelligence",         "status": "pending"},
            ])
    # structure_map is set in the run_stage1 branch; ensure None for short-doc path
    if not run_stage1:
        structure_map = None

    # Cap Stage 2 input for single-chunk docs to reduce latency
    text_for_stage2 = call_text[:STAGE2_INPUT_CAP] if len(call_text) > STAGE2_INPUT_CAP else call_text

    # Split into overlapping chunks if the document is very long
    if len(text_for_stage2) <= CHUNK_SIZE:
        chunks_text = [text_for_stage2]
    else:
        chunks_text = []
        start = 0
        while start < len(call_text):
            end = min(start + CHUNK_SIZE, len(call_text))
            chunks_text.append(text_for_stage2[start:end])
            if end == len(text_for_stage2):
                break
            start = end - CHUNK_OVERLAP

    total = len(chunks_text)

    # Stage 2: analyze chunks — progress ticker runs in parallel for single-chunk docs
    semaphore = asyncio.Semaphore(3)
    completed_chunks: list[int] = []

    # Build the "done so far" step list for the ticker's pre_steps
    _classify_label = f"Grant type: {classification.get('program_name', classification.get('funder_type', 'identified'))}"
    if run_stage1:
        _pre_steps_for_ticker: list[dict] = [
            {"id": "parse",    "label": "Document text loaded",   "status": "done"},
            {"id": "classify", "label": _classify_label,           "status": "done"},
            {"id": "scan",     "label": "Document structure mapped", "status": "done"},
        ]
    else:
        _pre_steps_for_ticker = [
            {"id": "parse",    "label": "Document text loaded",   "status": "done"},
            {"id": "classify", "label": _classify_label,           "status": "done"},
        ]

    async def analyze_with_sem(idx: int, text: str) -> dict:
        if on_step and total > 1:
            base: list[dict] = list(_pre_steps_for_ticker)
            base.append({
                "id": f"extract_{idx}",
                "label": f"Extracting chunk {idx + 1}/{total}…",
                "status": "active",
            })
            base.append({"id": "save", "label": "Saving Call Intelligence", "status": "pending"})
            on_step(base)
        async with semaphore:
            result = await _analyze_chunk(
                text, idx, total, call_url, funder, extra_instructions,
                structure_map, grant_type_ctx,
            )
        completed_chunks.append(idx)
        if on_step and total > 1:
            done_label = f"Chunk {idx + 1}/{total} extracted"
            base2: list[dict] = list(_pre_steps_for_ticker)
            base2.append({"id": f"extract_{idx}", "label": done_label, "status": "done"})
            base2.append({"id": "save", "label": "Saving Call Intelligence", "status": "pending"})
            on_step(base2)
        return result

    # For single-chunk (the common case), start a progress ticker alongside the LLM call
    ticker_task: asyncio.Task | None = None
    if on_step and total == 1:
        ticker_task = asyncio.create_task(
            _progress_ticker(on_step, _pre_steps_for_ticker)
        )

    try:
        results = await asyncio.gather(*[analyze_with_sem(i, t) for i, t in enumerate(chunks_text)])
    finally:
        if ticker_task is not None:
            ticker_task.cancel()
            try:
                await ticker_task
            except asyncio.CancelledError:
                pass
    merged = _merge_chunk_results(list(results))

    # Signal extraction complete before save
    if on_step:
        done_steps: list[dict] = list(_pre_steps_for_ticker)
        done_steps.append({"id": "extract", "label": "Requirements extracted", "status": "done"})
        done_steps.append({"id": "save", "label": "Saving Call Intelligence…", "status": "active"})
        on_step(done_steps)

    # If merge produced nothing useful, retry once without structure map
    if not _analysis_has_content(merged) and structure_map is not None:
        logger.warning(
            "call_analyzer: rich extraction produced no content — retrying without structure_map"
        )
        fallback = await _analyze_chunk(
            text_for_stage2, 0, 1, call_url, funder, extra_instructions,
            structure_map=None, grant_type_ctx=grant_type_ctx,
        )
        if _analysis_has_content(fallback):
            logger.info("call_analyzer: structure-map-less retry succeeded")
            return fallback
        merged = fallback  # carry forward even if it's still thin

    # Last resort: guaranteed minimal extraction with a short focused prompt
    if not _analysis_has_content(merged):
        logger.warning(
            "call_analyzer: all rich paths failed — running simple_fallback_analyze"
        )
        simple = await _simple_fallback_analyze(call_text, funder, call_url)
        if simple:
            for k, v in simple.items():
                if not merged.get(k):
                    merged[k] = v
            logger.info(
                "call_analyzer: simple fallback populated keys=%s",
                [k for k in simple if simple[k]],
            )

    return merged

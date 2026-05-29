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
import re
import asyncio
from collections.abc import Callable
from app.ai.client import chat_complete


def _parse_llm_json(response: str) -> dict:
    """Parse JSON from an LLM response, tolerating markdown fences and trailing text."""
    if not response or not response.strip():
        return {}
    text = response.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Extract ```json ... ``` or ``` ... ``` block
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.IGNORECASE)
    if fence:
        try:
            return json.loads(fence.group(1).strip())
        except json.JSONDecodeError:
            pass
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
                        return json.loads(text[start : i + 1])
                    except json.JSONDecodeError:
                        break
    return {}


def _analysis_has_content(result: dict) -> bool:
    """True if the analysis dict contains user-visible content."""
    if not result:
        return False
    if result.get("narrative_brief") or result.get("summary"):
        return True
    list_fields = (
        "call_background", "funder_priorities", "strategic_objectives",
        "requirements_overview", "required_sections", "evaluation_criteria",
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
    return any(result.get(f) for f in scalar_fields)

SYSTEM_PROMPT = """You are an expert grant analyst.
Your task is to analyze grant calls and produce a thorough, complete analysis that helps proposal teams
understand exactly what this grant is looking for and what a strong proposal must include.

Always respond with valid JSON matching the schema requested.
Be precise and factual. Capture every important requirement, no matter how minor it seems."""

CHUNK_SIZE = 400_000  # GPT-4o supports 128k tokens (~512k chars) — covers any real-world grant document
CHUNK_OVERLAP = 500
SHORT_DOC_THRESHOLD = 60_000   # chars — skip Stage 1 structure scan below this
SCAN_CAP = 60_000              # chars fed to Stage 1 structure scan
STAGE2_INPUT_CAP = 120_000     # max chars sent to Stage 2 for single-chunk docs


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
) -> dict:
    """Analyze a single chunk of a long call document, guided by the structure map."""
    chunk_note = (
        f"(This is chunk {chunk_index + 1} of {total_chunks} from a longer document. "
        "Extract everything present in this section; a merge pass will unify all chunks.)"
        if total_chunks > 1
        else ""
    )

    structure_context = ""
    if structure_map:
        structure_context = f"""
DOCUMENT STRUCTURE MAP (from Stage 1 scan — use this to locate and extract information more precisely):
{json.dumps(structure_map, indent=2)}

"""

    user_prompt = f"""Analyze the following grant call text and extract ALL relevant information.
{chunk_note}

FUNDER: {funder}
CALL URL: {call_url}
{f'ADDITIONAL CONTEXT: {extra_instructions}' if extra_instructions else ''}
{structure_context}
CALL TEXT:
{chunk_text}

Return a JSON object with these fields. Be THOROUGH and COMPLETE — do not summarize or skip details:

--- CONTEXT & FRAMING ---

- call_background: list of 5-8 detailed bullet strings describing the background and context of this call.
  Cover: the problem or challenge being addressed, why this call exists now, relevant program history,
  the funder's strategic motivation, and the landscape/sector context. Each bullet should be a
  complete, informative sentence — not a fragment.

- funder_priorities: ordered list of 4-6 strings stating what the funder cares most about,
  derived from emphasis, repetition, and weighting in the call. First item = highest priority.

- strategic_objectives: list of 4-8 strings, each describing a specific outcome or goal the funder
  wants to achieve through this funding. These are what "success" looks like from the funder's
  perspective — concrete and measurable where possible.

- key_focus_areas: list of objects, one per major thematic area or topic the call is centered on:
    {{"area": str, "description": str, "why_it_matters": str}}
  description = what proposals in this area should address.
  why_it_matters = why the funder has prioritized this area.

- key_phrases: list of objects — exact quoted language from the call that signals reviewer priorities:
    {{"phrase": str, "context": str, "significance": str}}
  phrase = the exact quoted text (keep it short, 3-15 words).
  context = one sentence explaining where/how it appears in the call.
  significance = why a proposal team should pay attention to this phrase.
  Aim for 5-10 phrases.

--- PROPOSAL REQUIREMENTS ---

- requirements_overview: list of 6-10 detailed bullet strings — a comprehensive "what this
  proposal must include and demonstrate." More expansive than key_asks; each bullet covers
  a distinct requirement with enough detail to act on.

- narrative_brief: A focused 3-4 paragraph plain-English synthesis for the proposal team:
    (1) What the funder wants to achieve and the specific problem they are funding a solution for
    (2) What a winning proposal MUST contain, demonstrate, and deliver — be concrete and specific
    (3) Team composition, eligibility, and consortium requirements
    (4) Critical constraints, budget rules, and common pitfalls that disqualify proposals
  Write as tight, actionable prose only. No generic policy background. No repetition.
  Each paragraph must give the team something concrete to act on.

- summary: 2-3 sentence executive summary (for UI display and downstream agents)

- eligibility_checklist: list of ALL eligibility requirements, each as:
    {{"item": str, "met": true/false/null, "notes": str, "critical": true/false}}
  Flag critical blockers (e.g. institution type, geography, prior award restrictions).

- required_sections: list of proposal sections required by the call

- section_requirements: object mapping section name to:
    {{
      "requirements": str,          (one-sentence description of this section's purpose)
      "word_limit": int|null,
      "page_limit": str|null,
      "priority": "high"|"medium"|"low",
      "key_asks": [str],            (3–6 bullet points of what the funder explicitly asks for in this section — pull from the call text)
      "questions_to_address": [str], (3–5 strategic questions this section must answer to satisfy reviewers)
      "evidence_needed": [str]      (2–4 specific data points, proof, or citations the section should include)
    }}

- deadlines: object with fields: full_proposal, loi, concept_note, questions_due (null if not applicable)

- budget_constraints: full description of budget rules, limits, cost categories, indirect costs, sub-award rules

- evaluation_criteria: complete list of evaluation criteria exactly as stated in the call

- required_partners: description of consortium, co-PI, sub-award, or institutional partner requirements

- risks: list of potential risks or concerns for our team (eligibility gaps, competitive issues, etc.)

- missing_information: things not stated in the call that we need to find out before applying

- recommended_next_steps: numbered list of immediate actions the team should take

- thematic_areas: list of themes, topics, and focus areas the call addresses

- geographic_eligibility: geographic scope and restrictions in full detail

- award_amount: funding amount, range, or description

- project_duration: project duration

- submission_portal: where and how to submit

- page_limit: page limit (null if not stated)

- word_limit: word limit (null if not stated)

- format_requirements: font, margins, spacing, file format, naming conventions if stated

- foa_number: official solicitation, FOA, or call reference number if present

- contact_info: program officer name, email, questions deadline if stated
"""
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
        return parsed
    return {
        "error": "Failed to parse analysis response from the model",
        "raw_response": (response or "")[:2000],
    }


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
        # new fields
        "call_background", "funder_priorities", "strategic_objectives", "requirements_overview",
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
    Analyze a grant call document using a two-stage pipeline.

    Stage 1 (skipped for short docs < SHORT_DOC_THRESHOLD chars, or when skip_structure_scan=True):
      _scan_document_structure — fast structural pass (gpt-4o-mini) identifying sections
      and extracting key text excerpts.

    Stage 2:
      _analyze_chunk — deep extraction guided by the Stage 1 structure map (if available),
      producing a rich JSON with call_background, funder_priorities, strategic_objectives,
      key_focus_areas, key_phrases, requirements_overview, and all existing fields.

    skip_structure_scan=True skips Stage 1 entirely (used on re-analyze for speed).
    on_step: optional sync callback(list[dict]) called at each progress milestone so
      the Celery task can push granular step updates to the DB without waiting for the
      full LLM call to return.
    """
    if not call_text:
        return {"error": "No call text provided"}

    run_stage1 = not skip_structure_scan and len(call_text) > SHORT_DOC_THRESHOLD

    # Stage 1: structure scan
    structure_map: dict | None = None
    if run_stage1:
        if on_step:
            on_step([
                {"id": "parse",   "label": "Document text loaded",             "status": "done"},
                {"id": "scan",    "label": "Scanning document structure…",     "status": "active"},
                {"id": "extract", "label": "Extracting requirements",          "status": "pending"},
                {"id": "save",    "label": "Saving Call Intelligence",         "status": "pending"},
            ])
        structure_map = await _scan_document_structure(call_text, funder)
        if on_step:
            on_step([
                {"id": "parse",   "label": "Document text loaded",             "status": "done"},
                {"id": "scan",    "label": "Document structure mapped",        "status": "done"},
                {"id": "extract", "label": "Extracting requirements and context…", "status": "active"},
                {"id": "save",    "label": "Saving Call Intelligence",         "status": "pending"},
            ])
    else:
        # Short doc or re-analyze — skip straight to extraction
        if on_step:
            on_step([
                {"id": "parse",   "label": "Document text loaded",             "status": "done"},
                {"id": "extract", "label": "Extracting requirements and context…", "status": "active"},
                {"id": "save",    "label": "Saving Call Intelligence",         "status": "pending"},
            ])

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

    # Stage 2: analyze chunks concurrently (cap at 3 in parallel to avoid rate limits)
    # For multi-chunk docs fire per-chunk progress updates so the UI doesn't appear frozen.
    semaphore = asyncio.Semaphore(3)
    completed_chunks: list[int] = []

    async def analyze_with_sem(idx: int, text: str) -> dict:
        if on_step and total > 1:
            scan_status = "done" if run_stage1 else None
            base: list[dict] = [{"id": "parse", "label": "Document text loaded", "status": "done"}]
            if scan_status:
                base.append({"id": "scan", "label": "Document structure mapped", "status": "done"})
            base.append({
                "id": f"extract_{idx}",
                "label": f"Extracting chunk {idx + 1}/{total}…",
                "status": "active",
            })
            base.append({"id": "save", "label": "Saving Call Intelligence", "status": "pending"})
            on_step(base)
        async with semaphore:
            result = await _analyze_chunk(
                text, idx, total, call_url, funder, extra_instructions, structure_map
            )
        completed_chunks.append(idx)
        if on_step and total > 1:
            done_label = f"Chunk {idx + 1}/{total} extracted"
            base2: list[dict] = [{"id": "parse", "label": "Document text loaded", "status": "done"}]
            if run_stage1:
                base2.append({"id": "scan", "label": "Document structure mapped", "status": "done"})
            base2.append({"id": f"extract_{idx}", "label": done_label, "status": "done"})
            base2.append({"id": "save", "label": "Saving Call Intelligence", "status": "pending"})
            on_step(base2)
        return result

    results = await asyncio.gather(*[analyze_with_sem(i, t) for i, t in enumerate(chunks_text)])
    merged = _merge_chunk_results(list(results))

    # Signal extraction complete before save
    if on_step:
        base3: list[dict] = [{"id": "parse", "label": "Document text loaded", "status": "done"}]
        if run_stage1:
            base3.append({"id": "scan", "label": "Document structure mapped", "status": "done"})
        base3.append({"id": "extract", "label": "Requirements extracted", "status": "done"})
        base3.append({"id": "save", "label": "Saving Call Intelligence…", "status": "active"})
        on_step(base3)

    # If merge produced nothing useful, retry once without structure map (simpler prompt path)
    if not _analysis_has_content(merged) and structure_map is not None:
        fallback = await _analyze_chunk(
            text_for_stage2,
            0,
            1,
            call_url,
            funder,
            extra_instructions,
            structure_map=None,
        )
        if _analysis_has_content(fallback):
            return fallback

    return merged

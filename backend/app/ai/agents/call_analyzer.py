"""
Agent 1: Call Analyzer
Analyzes a grant call document and extracts a comprehensive narrative brief plus
structured information for downstream agents (skeleton, drafter, compliance checker).

For long documents (> 10,000 chars) uses multi-pass chunking: each chunk is analyzed
independently and the results are merged into a single coherent output.
"""
import json
import asyncio
from app.ai.client import chat_complete

SYSTEM_PROMPT = """You are an expert grant analyst for a global health AI research team (LiGHT at EPFL).
Your task is to analyze grant calls and produce a thorough, complete analysis that helps the team
understand exactly what this grant is looking for and what a strong proposal must include.

Always respond with valid JSON matching the schema requested.
Be precise and factual. Capture every important requirement, no matter how minor it seems."""

CHUNK_SIZE = 10_000
CHUNK_OVERLAP = 500


async def _analyze_chunk(
    chunk_text: str,
    chunk_index: int,
    total_chunks: int,
    call_url: str,
    funder: str,
    extra_instructions: str = "",
) -> dict:
    """Analyze a single chunk of a long call document."""
    chunk_note = (
        f"(This is chunk {chunk_index + 1} of {total_chunks} from a longer document. "
        "Extract everything present in this section; a merge pass will unify all chunks.)"
        if total_chunks > 1
        else ""
    )
    user_prompt = f"""Analyze the following grant call text and extract ALL relevant information.
{chunk_note}

FUNDER: {funder}
CALL URL: {call_url}
{f'ADDITIONAL CONTEXT: {extra_instructions}' if extra_instructions else ''}

CALL TEXT:
{chunk_text}

Return a JSON object with these fields. Be THOROUGH and COMPLETE — do not summarize or skip details:

- narrative_brief: A comprehensive multi-paragraph plain-English summary covering:
    (1) What the funder is trying to accomplish and the problem they want to solve
    (2) Who they want to fund and what kind of team/institution is a good fit
    (3) What the project must include, deliver, and demonstrate
    (4) What a strong proposal looks like — themes, approach, evidence they want to see
    (5) Key constraints, eligibility conditions, and anything applicants often miss
  Write this as flowing prose (4-8 paragraphs), not bullet points. Be detailed.

- summary: 2-3 sentence executive summary (for UI display and downstream agents)

- eligibility_checklist: list of ALL eligibility requirements, each as:
    {{"item": str, "met": true/false/null, "notes": str, "critical": true/false}}
  Flag critical blockers (e.g. institution type, geography, prior award restrictions).

- required_sections: list of proposal sections required by the call

- section_requirements: object mapping section name to:
    {{"requirements": str, "word_limit": int|null, "page_limit": str|null, "priority": "high"|"medium"|"low"}}

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
    try:
        return json.loads(response)
    except json.JSONDecodeError:
        return {"raw_response": response, "error": "Failed to parse JSON"}


def _merge_chunk_results(chunks: list[dict]) -> dict:
    """Merge results from multiple chunk analyses into a single coherent result."""
    if len(chunks) == 1:
        return chunks[0]

    # Concatenate narrative briefs
    briefs = [c.get("narrative_brief", "") for c in chunks if c.get("narrative_brief")]
    merged: dict = {"narrative_brief": "\n\n".join(briefs)}

    # Use first non-empty summary or combine
    for c in chunks:
        if c.get("summary"):
            merged["summary"] = c["summary"]
            break

    # Merge lists (deduplicate by string value)
    list_fields = [
        "eligibility_checklist", "required_sections", "evaluation_criteria",
        "risks", "missing_information", "recommended_next_steps", "thematic_areas",
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

    # Merge section_requirements dicts
    sec_reqs: dict = {}
    for c in chunks:
        sec_reqs.update(c.get("section_requirements") or {})
    if sec_reqs:
        merged["section_requirements"] = sec_reqs

    # For scalar fields, use the first non-null/non-empty value across chunks
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


async def analyze_call(
    call_text: str,
    call_url: str = "",
    funder: str = "",
    extra_instructions: str = "",
) -> dict:
    """
    Analyze a grant call and return structured output with a rich narrative brief.

    Handles long documents by splitting into overlapping chunks, analyzing each,
    then merging the results.

    Returns a dict including:
      - narrative_brief: multi-paragraph plain-English description (primary UI field)
      - summary: short executive summary
      - eligibility_checklist, required_sections, section_requirements
      - deadlines, budget_constraints, evaluation_criteria, required_partners
      - risks, missing_information, recommended_next_steps
      - thematic_areas, geographic_eligibility, award_amount, project_duration
      - submission_portal, page_limit, word_limit, format_requirements
      - foa_number, contact_info
    """
    if not call_text:
        return {"error": "No call text provided"}

    # Split into overlapping chunks if the document is long
    if len(call_text) <= CHUNK_SIZE:
        chunks_text = [call_text]
    else:
        chunks_text = []
        start = 0
        while start < len(call_text):
            end = min(start + CHUNK_SIZE, len(call_text))
            chunks_text.append(call_text[start:end])
            if end == len(call_text):
                break
            start = end - CHUNK_OVERLAP

    total = len(chunks_text)

    # Analyze chunks concurrently (cap at 3 in parallel to avoid rate limits)
    semaphore = asyncio.Semaphore(3)

    async def analyze_with_sem(idx: int, text: str) -> dict:
        async with semaphore:
            return await _analyze_chunk(text, idx, total, call_url, funder, extra_instructions)

    results = await asyncio.gather(*[analyze_with_sem(i, t) for i, t in enumerate(chunks_text)])
    return _merge_chunk_results(list(results))

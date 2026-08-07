"""Expert reviewer — strict funder-panel review of a full grant draft.

Reads the WHOLE draft against the funder's real priorities + evaluation criteria
(from the stored call analysis plus a fresh web search) and produces:
  * macro comments  — per section: structure, strategy, missing criteria, coherence
  * targeted comments — sentence-level, each quoting the exact offending passage

Grounded and demanding: it flags what a tough reviewer would deduct points for,
never invents requirements the call doesn't state. Output feeds `Comment` rows.
"""
import asyncio
import json
import re

import structlog

from app.ai.client import chat_complete
from app.services.web_search import search_web_multi

logger = structlog.get_logger()

SEVERITIES = {"critical", "major", "minor", "suggestion"}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def _verbatim_anchor(section_text: str, anchor: str | None) -> str | None:
    """Return an anchor that actually occurs in the section text, else None.

    Prefers an exact substring (so the editor can highlight it); falls back to a
    whitespace-normalized match. Anything that can't be located is dropped so we
    never create a dangling comment anchor.
    """
    if not anchor:
        return None
    anchor = anchor.strip().strip('"').strip("“”")
    if not anchor:
        return None
    if anchor in section_text:
        return anchor
    nt, na = _norm(section_text).lower(), _norm(anchor).lower()
    if na and na in nt:
        return _norm(anchor)
    return None


# ── Funder priorities brief ──────────────────────────────────────────────────

async def gather_funder_priorities(
    funder: str, program: str, call_url: str, call_analysis: dict | None
) -> str:
    """Compress stored call intelligence + a fresh web search into a tight brief."""
    ca = call_analysis or {}
    parts: list[str] = []
    if ca.get("funder_priorities"):
        parts.append("Funder priorities (from the call):\n" + "\n".join(f"- {p}" for p in ca["funder_priorities"][:10]))
    if ca.get("evaluation_criteria"):
        parts.append("Evaluation criteria:\n" + "\n".join(f"- {c}" for c in ca["evaluation_criteria"][:12]))
    rb = ca.get("reviewer_brief") or {}
    for key, label in (
        ("scoring_rubric", "Scoring rubric"),
        ("winning_factors", "Winning factors"),
        ("losing_factors", "Losing factors"),
        ("eligibility_red_flags", "Eligibility red flags"),
        ("common_rejection_reasons", "Common rejection reasons"),
    ):
        if rb.get(key):
            parts.append(f"{label}:\n{json.dumps(rb[key])[:1500]}")

    web_snips = ""
    if funder:
        try:
            queries = [
                f"{funder} {program or ''} funding priorities".strip(),
                f"{funder} strategic plan research priorities",
                f"{funder} {program or ''} evaluation criteria reviewer guidance".strip(),
            ]
            results = await search_web_multi(queries, max_results_per_query=3)
            web_snips = "\n".join(
                f"- {r.get('title', '')}: {(r.get('content') or '')[:300]}" for r in results[:6]
            )
        except Exception as exc:
            logger.warning("expert_reviewer web search failed", error=str(exc))

    context = "\n\n".join(parts)
    if web_snips:
        context += f"\n\nRecent web results on the funder:\n{web_snips}"
    if not context.strip():
        return ""

    try:
        brief = await chat_complete(
            messages=[
                {"role": "system", "content": (
                    "You compress funder intelligence into a tight brief a grant reviewer uses to "
                    "judge a proposal. Be specific and factual; ground ONLY in the material given; "
                    "do not invent."
                )},
                {"role": "user", "content": (
                    f"FUNDER: {funder or 'unknown'} / PROGRAM: {program or 'n/a'}\n\n{context[:8000]}\n\n"
                    "Write a concise bullet brief of this funder's priorities, what they reward, and "
                    "what gets proposals rejected."
                )},
            ],
            agent_name="expert_reviewer", temperature=0.2, max_tokens=1000,
        )
        return (brief or "").strip() or context[:4000]
    except Exception as exc:
        logger.warning("expert_reviewer brief failed", error=str(exc))
        return context[:4000]


# ── Pass 1: macro (whole document) ───────────────────────────────────────────

_MACRO_SYSTEM = (
    "You are a senior grant reviewer and evaluation-panel chair — demanding, specific, and fair. "
    "You have scored hundreds of proposals for this funder. Read the ENTIRE draft and judge it as a "
    "reviewer who is looking for reasons to deduct points. Ground every critique in the funder's "
    "priorities and evaluation criteria provided; do NOT invent requirements the call doesn't state. "
    "Return STRICT JSON only."
)

_MACRO_SCHEMA = """Return JSON:
{
  "overall": {
    "verdict": "fund | revise | reject",
    "score": 0-100,
    "readiness": "not ready | needs work | strong",
    "summary": "3-5 sentences in a reviewer's voice",
    "strengths": ["..."],
    "risks": ["..."]
  },
  "macro_comments": [
    {"section": "exact section title", "severity": "critical|major|minor|suggestion",
     "comment": "section-level problem: structure, strategy, a missing evaluation criterion, weak framing, or cross-section incoherence",
     "suggestion": "concrete fix", "criterion": "which funder priority / evaluation criterion this maps to (or empty)"}
  ]
}
Be strict. Give 1-4 macro comments for each weak section; note strong sections in `overall.strengths`."""


async def review_document_macro(sections: list[dict], funder_brief: str, reviewer_brief: dict) -> dict:
    section_blocks = "\n\n".join(
        f"## {s['title']} ({s.get('word_count', 0)} words)\n{(s.get('plain_text') or '')[:4000]}"
        for s in sections
    )
    user = (
        f"FUNDER PRIORITIES BRIEF:\n{funder_brief or 'n/a'}\n\n"
        f"REVIEWER BRIEF (rubric / red flags):\n{json.dumps(reviewer_brief or {})[:3000]}\n\n"
        f"FULL DRAFT (all sections):\n{section_blocks[:40000]}\n\n{_MACRO_SCHEMA}"
    )
    try:
        content = await chat_complete(
            messages=[{"role": "system", "content": _MACRO_SYSTEM}, {"role": "user", "content": user}],
            agent_name="expert_reviewer", json_mode=True, temperature=0.2, max_tokens=4000,
        )
        data = json.loads(content)
        return data if isinstance(data, dict) else {}
    except Exception as exc:
        logger.warning("expert_reviewer macro failed", error=str(exc))
        return {}


# ── Pass 2: targeted (per section) ───────────────────────────────────────────

_TARGETED_SYSTEM = (
    "You are a strict grant reviewer doing a close, line-level read of ONE section. "
    "Quote the exact offending sentence or phrase verbatim and say precisely how to fix it. "
    "Ground critiques in the funder's priorities/criteria; do not invent requirements. "
    "Return STRICT JSON only."
)

_TARGETED_SCHEMA = """Return JSON:
{"targeted_comments": [
  {"anchor_text": "EXACT verbatim quote copied character-for-character from the section (one sentence or phrase, <= 240 chars)",
   "severity": "critical|major|minor|suggestion",
   "comment": "the specific problem with this passage",
   "suggestion": "a concrete rewrite or fix",
   "criterion": "mapped funder priority/criterion or empty"}
]}
Copy anchor_text EXACTLY as it appears in the section text (verbatim). Give 3-10 targeted comments for a weak section, fewer if strong. Only comment where there is a real, specific problem."""


async def review_section_targeted(title: str, text: str, expectations: str, funder_brief: str) -> list[dict]:
    user = (
        f"SECTION: {title}\n\n"
        f"WHAT A REVIEWER WANTS HERE:\n{expectations or 'n/a'}\n\n"
        f"FUNDER PRIORITIES:\n{funder_brief or 'n/a'}\n\n"
        f"SECTION TEXT:\n{text[:8000]}\n\n{_TARGETED_SCHEMA}"
    )
    try:
        content = await chat_complete(
            messages=[{"role": "system", "content": _TARGETED_SYSTEM}, {"role": "user", "content": user}],
            agent_name="expert_reviewer", json_mode=True, temperature=0.2, max_tokens=3000,
        )
        data = json.loads(content)
        comments = data.get("targeted_comments", []) if isinstance(data, dict) else []
    except Exception as exc:
        logger.warning("expert_reviewer targeted failed", section=title, error=str(exc))
        return []

    out: list[dict] = []
    for c in comments:
        if not isinstance(c, dict) or not c.get("comment"):
            continue
        anchor = _verbatim_anchor(text, c.get("anchor_text"))
        sev = c.get("severity") if c.get("severity") in SEVERITIES else "minor"
        out.append({
            "anchor_text": anchor,  # None if it couldn't be located verbatim
            "severity": sev,
            "comment": c.get("comment", "").strip(),
            "suggestion": (c.get("suggestion") or "").strip(),
            "criterion": (c.get("criterion") or "").strip(),
        })
    return out


def _fmt_section_req(req: dict | None) -> str:
    if not isinstance(req, dict):
        return ""
    bits = []
    for key in ("key_asks", "questions_to_address", "evidence_needed"):
        if req.get(key):
            bits.append(f"{key.replace('_', ' ')}: " + "; ".join(str(x) for x in req[key][:6]))
    if req.get("critical_differentiator"):
        bits.append(f"critical differentiator: {req['critical_differentiator']}")
    return "\n".join(bits)


# ── Orchestration ────────────────────────────────────────────────────────────

async def run_expert_review(
    sections: list[dict], funder: str, program: str, call_url: str, call_analysis: dict | None
) -> dict:
    """Full two-pass review. `sections` = [{title, plain_text, word_count}, …]."""
    call_analysis = call_analysis or {}
    funder_brief = await gather_funder_priorities(funder, program, call_url, call_analysis)
    reviewer_brief = call_analysis.get("reviewer_brief") or {}
    per_section_exp = reviewer_brief.get("per_section_expectations") or {}
    section_reqs = call_analysis.get("section_requirements") or {}

    macro = await review_document_macro(sections, funder_brief, reviewer_brief)

    async def _targeted(s: dict):
        exp = per_section_exp.get(s["title"]) or _fmt_section_req(section_reqs.get(s["title"]))
        comments = await review_section_targeted(s["title"], s.get("plain_text") or "", exp, funder_brief)
        return s["title"], comments

    live = [s for s in sections if (s.get("plain_text") or "").strip()]
    results = await asyncio.gather(*[_targeted(s) for s in live], return_exceptions=True)

    targeted: list[dict] = []
    for r in results:
        if isinstance(r, Exception):
            logger.warning("expert_reviewer targeted section raised", error=str(r))
            continue
        title, comments = r
        for c in comments:
            c["section"] = title
            targeted.append(c)

    # Normalize macro comment severities.
    macro_comments = []
    for c in (macro.get("macro_comments") or []):
        if not isinstance(c, dict) or not c.get("comment"):
            continue
        c["severity"] = c.get("severity") if c.get("severity") in SEVERITIES else "major"
        macro_comments.append(c)

    return {
        "overall": macro.get("overall", {}),
        "macro_comments": macro_comments,
        "targeted_comments": targeted,
        "funder_brief": funder_brief,
    }

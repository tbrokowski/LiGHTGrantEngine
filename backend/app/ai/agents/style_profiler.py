"""Style Profiler — extract voice fingerprint from archive exemplars."""
import json
from app.ai.client import chat_complete

SYSTEM_PROMPT = """You are a linguistic analyst specializing in academic grant writing style.
Analyze exemplar grant sections and produce a style fingerprint for guiding new drafts.
Respond with valid JSON."""


async def build_style_profile(
    grant_title: str,
    funder: str,
    grant_idea: str,
    retrieved_sections: list[dict] | None = None,
) -> dict:
    exemplars = ""
    if retrieved_sections:
        for s in retrieved_sections[:6]:
            exemplars += (
                f"\n--- {s.get('section_type', '?')} from {s.get('grant_title', '?')} "
                f"({s.get('funder', '?')}, {s.get('outcome', '?')}) ---\n"
                f"{s.get('full_text', '')[:2000]}\n"
            )

    user_prompt = f"""Build a style profile for writing a new grant proposal.

NEW GRANT: {grant_title}
FUNDER: {funder}
GRANT IDEA: {grant_idea[:1500]}

ARCHIVE EXEMPLARS:
{exemplars or 'No archive exemplars available — use default LiGHT/EPFL academic global health AI voice.'}

Return JSON with:
- voice_summary: 2-3 sentence description of the writing voice
- sentence_patterns: list of typical sentence structures
- opening_patterns: list of how sections typically open
- terminology: list of domain terms and phrases used
- hedging_style: how uncertainty is expressed
- citation_density: low/medium/high
- tone: list of tone descriptors
- avoid: list of patterns to avoid
- intro_arc_notes: guidance for the 6-beat intro structure
- exemplar_sources: list of {{title, funder, outcome, section_type}} used
"""

    response = await chat_complete(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        agent_name="style_profiler",
        json_mode=True,
    )
    try:
        return json.loads(response)
    except json.JSONDecodeError:
        return {
            "voice_summary": "Clear academic global health AI voice for EPFL LiGHT group.",
            "error": "Failed to parse style profile",
            "raw": response,
        }

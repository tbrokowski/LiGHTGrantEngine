"""Plan subsections for hierarchical section expansion."""
from __future__ import annotations
import json
from app.ai.client import chat_complete

SYSTEM = "You plan subsections for a long grant proposal section. Return valid JSON only."

async def plan_subsections(
    section_name: str,
    target_words: int,
    skeleton_content: str,
    section_brief: dict,
    grant_idea: str = "",
) -> list[dict]:
    prompt = f"""Plan 3-8 subsections for "{section_name}" totaling ~{target_words} words.

SKELETON:
{skeleton_content[:3000]}

IDEA: {grant_idea[:1500]}
BRIEF: {json.dumps(section_brief)[:1000]}

Return JSON:
{{"subsections": [{{"title": str, "target_words": int, "focus": str}}]}}"""
    resp = await chat_complete(
        messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}],
        agent_name="subsection_planner",
        json_mode=True,
    )
    try:
        data = json.loads(resp)
        subs = data.get("subsections") or []
        if subs:
            return subs
    except Exception:
        pass
    per = max(400, target_words // 4)
    return [
        {"title": f"{section_name} — Part {i+1}", "target_words": per, "focus": ""}
        for i in range(min(4, max(2, target_words // per)))
    ]

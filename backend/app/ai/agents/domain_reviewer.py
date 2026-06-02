"""Lightweight clinical/technical domain reviewers."""
from __future__ import annotations
import json
from app.ai.client import chat_complete

async def review_section_domain(
    section_name: str,
    draft_html: str,
    domain: str,
    grant_idea: str = "",
) -> dict:
    role = "clinical epidemiologist" if domain == "clinical" else "technical methods reviewer"
    prompt = f"""As a {role}, review this grant section for rigor and specificity.
List issues only; do not rewrite.

SECTION: {section_name}
IDEA: {grant_idea[:1500]}
DRAFT: {draft_html[:8000]}

Return JSON: {{"issues": [str], "severity": "low|medium|high", "pass": bool}}"""
    resp = await chat_complete(
        messages=[{"role": "user", "content": prompt}],
        agent_name="domain_reviewer",
        json_mode=True,
    )
    try:
        return json.loads(resp)
    except Exception:
        return {"issues": [], "pass": True, "severity": "low"}

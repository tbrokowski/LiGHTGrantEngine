"""Route section drafting to the agentic drafter, selecting the right specialized prompt addendum."""
from __future__ import annotations

import re
from typing import Any, TYPE_CHECKING

from app.ai.agents.section_drafter_agentic import draft_section_agentic

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

INTRO_KEYWORDS = ("intro", "background", "problem", "executive", "rationale", "summary")

_FENCE_RE = re.compile(r"^\s*```(?:html)?\s*\n?|\n?```\s*$", re.IGNORECASE)


def _strip_markdown_fence(html: str) -> str:
    """Strip a stray ```html / ``` code-fence the model sometimes wraps the
    draft in despite tool-calling + explicit "NO markdown" instructions — the
    submit_draft tool schema doesn't fully prevent this quirk in the field value."""
    if not html or "```" not in html:
        return html
    return _FENCE_RE.sub("", html).strip()


def _sanitize(result: dict) -> dict:
    if isinstance(result, dict) and result.get("draft"):
        result["draft"] = _strip_markdown_fence(result["draft"])
    return result


async def draft_section_routed(
    agent: str,
    section_name: str,
    db: "AsyncSession",
    is_intro: bool = False,
    **kwargs: Any,
) -> dict:
    """Dispatch to the agentic drafter (section_drafter_agentic.draft_section_agentic),
    selecting the right specialized system-prompt addendum (intro/methods/work_packages/
    impact/default) via the `agent` argument."""
    return _sanitize(await draft_section_agentic(
        agent=agent,
        section_name=section_name,
        db=db,
        is_intro=is_intro,
        **kwargs,
    ))

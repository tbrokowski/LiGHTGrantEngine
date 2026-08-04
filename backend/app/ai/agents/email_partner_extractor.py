"""Extract a partner contact from a pasted email thread.

Given raw email-thread text, pull the primary external contact's name, email,
organization, and title (the person you'd want to add as a partner — not
yourself). LLM extraction, strict JSON.
"""
import json

import structlog

from app.ai.client import chat_complete

logger = structlog.get_logger()

_SYSTEM = (
    "You extract a single external contact from an email thread to add as a research/"
    "grant partner. Identify the most relevant OTHER person (not the account holder). "
    "Return STRICT JSON only, no prose."
)

_SCHEMA = """Return JSON:
{"name": "...", "email": "...", "organization": "...", "title": "...", "confidence": 0-1}
Use empty strings for anything not clearly present. Do NOT invent an email."""


async def extract_partner_from_email(thread_text: str) -> dict:
    if not (thread_text or "").strip():
        return {}
    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": f"EMAIL THREAD:\n{thread_text[:20000]}\n\n{_SCHEMA}"},
    ]
    try:
        content = await chat_complete(
            messages, agent_name="email_partner_extractor", json_mode=True,
            max_tokens=500, temperature=0.0,
        )
        data = json.loads(content)
        return data if isinstance(data, dict) else {}
    except Exception as exc:
        logger.warning("email_partner_extractor failed", error=str(exc))
        return {}

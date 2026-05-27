"""Async email sending service via Resend HTTP API."""
import logging

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


async def send_email(
    to: str,
    subject: str,
    html: str,
    text: str | None = None,
) -> None:
    """Send an HTML email via Resend HTTP API. Logs and swallows errors gracefully."""
    settings = get_settings()

    if not settings.resend_api_key:
        logger.info("Resend not configured — skipping email to %s: %s", to, subject)
        return

    payload: dict = {
        "from": settings.smtp_from,
        "to": [to],
        "subject": subject,
        "html": html,
    }
    if text:
        payload["text"] = text

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {settings.resend_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            resp.raise_for_status()
        logger.info("Email sent to %s: %s", to, subject)
    except Exception as e:
        logger.error("Failed to send email to %s: %s", to, e)

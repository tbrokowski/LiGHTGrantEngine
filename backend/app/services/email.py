"""Async email sending service via SMTP (Resend-compatible)."""
import asyncio
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from functools import partial

from app.config import get_settings

logger = logging.getLogger(__name__)


async def send_email(
    to: str,
    subject: str,
    html: str,
    text: str | None = None,
) -> None:
    """Send an HTML email asynchronously. Logs and swallows errors gracefully."""
    settings = get_settings()

    if not settings.smtp_password:
        logger.info("SMTP not configured — skipping email to %s: %s", to, subject)
        return

    def _send() -> None:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = settings.smtp_from
        msg["To"] = to

        if text:
            msg.attach(MIMEText(text, "plain"))
        msg.attach(MIMEText(html, "html"))

        with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
            server.ehlo()
            server.starttls()
            server.login(settings.smtp_from, settings.smtp_password)
            server.sendmail(settings.smtp_from, to, msg.as_string())

    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(None, _send)
        logger.info("Email sent to %s: %s", to, subject)
    except Exception as e:
        logger.error("Failed to send email to %s: %s", to, e)

"""Slack Web API client for fund request Block Kit messages."""
from __future__ import annotations

import hashlib
import hmac
import time
from typing import Any

import httpx
import structlog

from app.config import get_settings

logger = structlog.get_logger()
SLACK_API = "https://slack.com/api"


def verify_slack_signature(
    signing_secret: str,
    timestamp: str,
    body: bytes,
    signature: str,
) -> bool:
    """Verify Slack request signature (v0)."""
    if abs(time.time() - int(timestamp)) > 60 * 5:
        return False
    sig_basestring = f"v0:{timestamp}:{body.decode('utf-8')}"
    computed = "v0=" + hmac.new(
        signing_secret.encode(),
        sig_basestring.encode(),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(computed, signature)


def _bot_token(override: str | None = None) -> str:
    settings = get_settings()
    token = override or settings.slack_bot_token
    if not token:
        raise ValueError("Slack bot token not configured")
    return token


async def post_message(
    channel: str,
    blocks: list[dict],
    text: str,
    bot_token: str | None = None,
) -> dict[str, Any]:
    """Post a Block Kit message; returns Slack API response including ts."""
    token = _bot_token(bot_token)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{SLACK_API}/chat.postMessage",
            headers={"Authorization": f"Bearer {token}"},
            json={"channel": channel, "blocks": blocks, "text": text},
        )
        data = resp.json()
        if not data.get("ok"):
            logger.warning("Slack post failed", error=data.get("error"))
            raise RuntimeError(data.get("error", "Slack API error"))
        return data


async def update_message(
    channel: str,
    ts: str,
    blocks: list[dict],
    text: str,
    bot_token: str | None = None,
) -> dict[str, Any]:
    token = _bot_token(bot_token)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{SLACK_API}/chat.update",
            headers={"Authorization": f"Bearer {token}"},
            json={"channel": channel, "ts": ts, "blocks": blocks, "text": text},
        )
        data = resp.json()
        if not data.get("ok"):
            logger.warning("Slack update failed", error=data.get("error"))
        return data


def build_fund_request_blocks(
    request_id: str,
    title: str,
    amount: float,
    currency: str,
    category_name: str | None,
    vendor: str | None,
    description: str | None,
    requester_name: str,
    status: str,
    grant_title: str,
    app_base_url: str,
    grant_id: str,
) -> list[dict]:
    """Build Block Kit blocks for a fund request message."""
    amt_str = f"{currency} {amount:,.2f}"
    cat = category_name or "Uncategorized"
    vendor_line = f"*Vendor:* {vendor}\n" if vendor else ""
    desc_line = (description[:200] + "…") if description and len(description) > 200 else (description or "")

    header = {
        "type": "header",
        "text": {"type": "plain_text", "text": f"Fund Request — {grant_title}", "emoji": True},
    }
    section = {
        "type": "section",
        "fields": [
            {"type": "mrkdwn", "text": f"*Title:*\n{title}"},
            {"type": "mrkdwn", "text": f"*Amount:*\n{amt_str}"},
            {"type": "mrkdwn", "text": f"*Category:*\n{cat}"},
            {"type": "mrkdwn", "text": f"*Requested by:*\n{requester_name}"},
            {"type": "mrkdwn", "text": f"*Status:*\n{status.replace('_', ' ').title()}"},
        ],
    }
    blocks: list[dict] = [header, section]
    if vendor_line or desc_line:
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"{vendor_line}{desc_line}".strip() or "—"},
        })

    finance_url = f"{app_base_url}/grants/{grant_id}/workspace?tab=finance"
    blocks.append({
        "type": "actions",
        "block_id": f"fund_request_{request_id}",
        "elements": [
            {
                "type": "button",
                "text": {"type": "plain_text", "text": "Approve", "emoji": True},
                "style": "primary",
                "action_id": "fund_approve",
                "value": request_id,
            },
            {
                "type": "button",
                "text": {"type": "plain_text", "text": "Reject", "emoji": True},
                "style": "danger",
                "action_id": "fund_reject",
                "value": request_id,
            },
            {
                "type": "button",
                "text": {"type": "plain_text", "text": "Open in App", "emoji": True},
                "url": finance_url,
                "action_id": "fund_open_app",
            },
        ],
    })
    return blocks


def build_fund_request_text(title: str, amount: float, currency: str, status: str) -> str:
    return f"Fund request: {title} — {currency} {amount:,.2f} ({status})"

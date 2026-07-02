"""Slack interactive component callbacks for fund request approvals."""
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Request, HTTPException
from sqlalchemy import select, create_engine
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.grant_ledger import FundRequest, FundRequestStatus
from app.models.active_grant import ActiveGrant
from app.models.user import User
from app.services.slack_client import verify_slack_signature

logger = logging.getLogger(__name__)
router = APIRouter()


def _sync_session():
    settings = get_settings()
    engine = create_engine(settings.database_url)
    return Session(engine)


@router.post("/interactive")
async def slack_interactive(request: Request):
    """Handle Slack button clicks for fund request approve/reject."""
    settings = get_settings()
    signing_secret = settings.slack_signing_secret
    if not signing_secret:
        raise HTTPException(503, "Slack signing secret not configured")

    body_bytes = await request.body()
    timestamp = request.headers.get("X-Slack-Request-Timestamp", "")
    signature = request.headers.get("X-Slack-Signature", "")
    if not verify_slack_signature(signing_secret, timestamp, body_bytes, signature):
        raise HTTPException(403, "Invalid Slack signature")

    from urllib.parse import parse_qs
    parsed = parse_qs(body_bytes.decode("utf-8"))
    payload_list = parsed.get("payload")
    payload_raw = payload_list[0] if payload_list else None
    if not payload_raw:
        raise HTTPException(400, "Missing payload")
    payload = json.loads(payload_raw)

    if payload.get("type") != "block_actions":
        return {"ok": True}

    actions = payload.get("actions") or []
    if not actions:
        return {"ok": True}

    action = actions[0]
    action_id = action.get("action_id")
    request_id = action.get("value")
    slack_user_id = payload.get("user", {}).get("id", "slack")

    if action_id not in ("fund_approve", "fund_reject") or not request_id:
        return {"ok": True}

    new_status = (
        FundRequestStatus.APPROVED.value
        if action_id == "fund_approve"
        else FundRequestStatus.REJECTED.value
    )

    db = _sync_session()
    try:
        fr = db.execute(select(FundRequest).where(FundRequest.id == request_id)).scalar_one_or_none()
        if not fr:
            logger.warning("Fund request not found for Slack action", request_id=request_id)
            return {"ok": True}

        if fr.status in (
            FundRequestStatus.APPROVED.value,
            FundRequestStatus.REJECTED.value,
            FundRequestStatus.PAID.value,
            FundRequestStatus.CANCELLED.value,
        ):
            return {"ok": True}

        grant = db.execute(select(ActiveGrant).where(ActiveGrant.id == fr.grant_id)).scalar_one_or_none()
        if not grant:
            return {"ok": True}

        # Resolve approver: first org admin or grant lead
        approver = db.execute(
            select(User).where(User.institution_id == grant.institution_id).limit(1)
        ).scalar_one_or_none()
        approver_id = approver.id if approver else fr.requested_by_id

        if new_status == FundRequestStatus.APPROVED.value:
            fr.approved_by_id = approver_id
            fr.approved_at = datetime.now(timezone.utc)
            fr.rejection_reason = None
        else:
            fr.rejection_reason = f"Rejected via Slack by {slack_user_id}"
            fr.approved_by_id = None
            fr.approved_at = None

        fr.status = new_status

        if new_status == FundRequestStatus.APPROVED.value:
            # Optionally auto-create expenditure when marked paid later; approval only commits budget
            pass

        db.commit()

        # Update Slack message
        if fr.slack_message_ts and fr.slack_channel_id and approver:
            import asyncio
            from app.models.slack_config import SlackGrantConfig
            from app.models.grant_ledger import LedgerCategory
            from app.services.slack_client import build_fund_request_blocks, build_fund_request_text, update_message

            cfg = db.execute(
                select(SlackGrantConfig).where(SlackGrantConfig.grant_id == grant.id)
            ).scalar_one_or_none()
            cat_name = None
            if fr.category_id:
                cat = db.execute(select(LedgerCategory).where(LedgerCategory.id == fr.category_id)).scalar_one_or_none()
                cat_name = cat.name if cat else None
            token = (cfg.slack_bot_token if cfg else None) or settings.slack_bot_token
            blocks = build_fund_request_blocks(
                fr.id, fr.title, fr.amount, fr.currency, cat_name, fr.vendor, fr.description,
                approver.name or approver.email, fr.status, grant.title, settings.base_url, grant.id,
            )
            blocks = [b for b in blocks if b.get("type") != "actions"]
            text = build_fund_request_text(fr.title, fr.amount, fr.currency, fr.status)
            try:
                asyncio.get_event_loop().run_until_complete(
                    update_message(fr.slack_channel_id, fr.slack_message_ts, blocks, text, bot_token=token)
                )
            except Exception:
                asyncio.run(update_message(fr.slack_channel_id, fr.slack_message_ts, blocks, text, bot_token=token))
    finally:
        db.close()

    return {"ok": True}

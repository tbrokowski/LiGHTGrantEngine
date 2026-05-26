"""AI billing utilities — cost accumulation and limit enforcement."""
import uuid
import logging
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.institution import Institution
from app.models.ai_run import AIRun, AIRunStatus

logger = logging.getLogger(__name__)


async def check_ai_limit(user: User, db: AsyncSession) -> None:
    """
    Raise HTTP 402 if the user has exceeded their AI usage limit.
    Only enforces for personal institutions; org accounts with ai_budget_cents=None
    are unlimited.
    """
    if not user.institution_id:
        return

    inst_result = await db.execute(select(Institution).where(Institution.id == user.institution_id))
    inst = inst_result.scalar_one_or_none()
    if not inst:
        return

    # Personal institutions: enforce user-level limit
    if inst.is_personal:
        limit = user.ai_usage_limit_cents
        if limit > 0 and user.ai_usage_cents >= limit:
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "ai_limit_exceeded",
                    "message": f"You have reached your AI usage limit of ${limit/100:.2f}. "
                               "Contact support to increase your limit.",
                    "usage_cents": user.ai_usage_cents,
                    "limit_cents": limit,
                },
            )
    else:
        # Org institution: check org-level budget if set
        if inst.ai_budget_cents is not None and inst.ai_budget_cents > 0:
            if user.ai_usage_cents >= inst.ai_budget_cents:
                raise HTTPException(
                    status_code=402,
                    detail={
                        "error": "org_ai_limit_exceeded",
                        "message": "Organization AI budget limit reached.",
                        "usage_cents": user.ai_usage_cents,
                        "limit_cents": inst.ai_budget_cents,
                    },
                )


async def accumulate_ai_usage(
    user: User,
    db: AsyncSession,
    agent_type: str,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    output: Optional[str] = None,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    cost_cents: int = 0,
    model_used: Optional[str] = None,
) -> None:
    """
    Record an AI run and accumulate usage against the user's account.
    For org-funded calls, still record the run but attribute to user for transparency.
    """
    try:
        run = AIRun(
            id=str(uuid.uuid4()),
            user_id=user.id,
            entity_type=entity_type,
            entity_id=entity_id,
            agent_type=agent_type,
            output=output[:10000] if output else None,
            status=AIRunStatus.COMPLETED,
            model_used=model_used,
            tokens_used=prompt_tokens + completion_tokens,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cost_cents=cost_cents,
            completed_at=datetime.utcnow(),
        )
        db.add(run)
        # Accumulate usage on personal accounts
        if cost_cents > 0:
            user.ai_usage_cents = (user.ai_usage_cents or 0) + cost_cents
        await db.commit()
    except Exception as exc:
        logger.warning("Failed to record AI run: %s", exc)
        try:
            await db.rollback()
        except Exception:
            pass

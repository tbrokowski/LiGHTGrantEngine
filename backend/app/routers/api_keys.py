"""Per-user LLM API keys + grant-writing usage.

Keys are stored encrypted; the raw value is never returned. The running user's
key for a provider is preferred over the system key during grant writing.
"""
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.models.user_api_key import UserApiKey
from app.models.llm_usage import LLMUsage
from app.routers.auth import get_current_user
from app.services.crypto import encrypt, decrypt

router = APIRouter()

_PROVIDERS = {"openai", "anthropic", "google"}

# Suggested models per provider for the Settings dropdowns.
MODEL_CATALOG = {
    "openai": ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-5", "o3"],
    "anthropic": ["claude-opus-4", "claude-sonnet-4", "claude-3-5-sonnet", "claude-3-5-haiku"],
    "google": ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-1.5-pro"],
}


class ApiKeyCreate(BaseModel):
    provider: str
    key: str
    label: str | None = None


def _mask(raw: str) -> str:
    if not raw:
        return ""
    return (raw[:4] + "…" + raw[-4:]) if len(raw) > 10 else "••••"


async def load_user_provider_keys(db: AsyncSession, user_id: str) -> dict:
    """Decrypted {provider: key} map for a user — used to route calls to the
    user's own keys during grant writing."""
    rows = (await db.execute(
        select(UserApiKey).where(UserApiKey.user_id == user_id)
    )).scalars().all()
    out: dict = {}
    for r in rows:
        k = decrypt(r.encrypted_key)
        if k:
            out[r.provider] = k
    return out


@router.get("")
async def list_keys(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = (await db.execute(
        select(UserApiKey).where(UserApiKey.user_id == current_user.id)
    )).scalars().all()
    return [
        {"provider": r.provider, "label": r.label, "masked": _mask(decrypt(r.encrypted_key)),
         "created_at": r.created_at.isoformat() if r.created_at else None}
        for r in rows
    ]


@router.put("")
async def upsert_key(data: ApiKeyCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    if data.provider not in _PROVIDERS:
        raise HTTPException(400, f"provider must be one of {sorted(_PROVIDERS)}")
    if not data.key.strip():
        raise HTTPException(400, "key is required")
    existing = (await db.execute(
        select(UserApiKey).where(UserApiKey.user_id == current_user.id, UserApiKey.provider == data.provider)
    )).scalar_one_or_none()
    if existing:
        existing.encrypted_key = encrypt(data.key.strip())
        existing.label = data.label
    else:
        db.add(UserApiKey(user_id=current_user.id, provider=data.provider,
                          encrypted_key=encrypt(data.key.strip()), label=data.label))
    await db.commit()
    return {"provider": data.provider, "saved": True}


@router.delete("/{provider}", status_code=204)
async def delete_key(provider: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await db.execute(sa_delete(UserApiKey).where(
        UserApiKey.user_id == current_user.id, UserApiKey.provider == provider))
    await db.commit()


@router.get("/catalog")
async def models_catalog(current_user: User = Depends(get_current_user)):
    """Providers + suggested models for the Settings dropdowns."""
    return {"providers": sorted(_PROVIDERS), "models": MODEL_CATALOG}


@router.get("/usage")
async def usage_summary(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """The user's grant-writing LLM usage (last 30 days), grouped by provider/model."""
    since = datetime.now(timezone.utc) - timedelta(days=30)
    rows = (await db.execute(
        select(
            LLMUsage.provider, LLMUsage.model,
            func.sum(LLMUsage.prompt_tokens), func.sum(LLMUsage.completion_tokens),
            func.sum(LLMUsage.cost_cents), func.count(),
        ).where(LLMUsage.user_id == current_user.id, LLMUsage.created_at >= since)
        .group_by(LLMUsage.provider, LLMUsage.model)
    )).all()
    by_model = [
        {"provider": r[0], "model": r[1], "prompt_tokens": int(r[2] or 0),
         "completion_tokens": int(r[3] or 0), "cost_cents": int(r[4] or 0), "calls": int(r[5] or 0)}
        for r in rows
    ]
    total_cents = sum(m["cost_cents"] for m in by_model)
    return {
        "by_model": sorted(by_model, key=lambda m: -m["cost_cents"]),
        "total_cents": total_cents,
        "budget_cents": current_user.ai_usage_limit_cents,
        "used_cents": current_user.ai_usage_cents,
    }

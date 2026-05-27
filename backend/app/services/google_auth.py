"""Google OAuth token management.

Provides a helper to return a valid access token for a user, refreshing it
automatically when it has expired.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

import httpx

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession
    from app.models.user import User


async def get_valid_google_token(user: "User", db: "AsyncSession") -> str:
    """Return a valid Google access token for the user, refreshing if expired.

    Raises ValueError if the user has no Google tokens connected.
    """
    from app.config import get_settings
    settings = get_settings()

    if not user.google_access_token or not user.google_refresh_token:
        raise ValueError("Google account not connected.")

    now = datetime.now(timezone.utc)
    # Refresh if expiry is unknown or within 60 seconds of expiring
    expiry = user.google_token_expiry
    if expiry is not None and expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)

    if expiry is None or now >= (expiry - timedelta(seconds=60)):
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "refresh_token": user.google_refresh_token,
                    "grant_type": "refresh_token",
                },
            )
            resp.raise_for_status()
            token_data = resp.json()

        user.google_access_token = token_data["access_token"]
        user.google_token_expiry = now + timedelta(seconds=token_data.get("expires_in", 3600))
        await db.commit()

    return user.google_access_token

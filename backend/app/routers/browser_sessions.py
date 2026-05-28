"""
Steel Browser session management endpoints.

The frontend creates a session when the web browser pane mounts, embeds the
returned debugUrl in an iframe (WebRTC stream), and releases the session on
unmount. Navigation is driven via the navigate endpoint which sends a CDP
Page.navigate command through Steel.
"""
import os
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.routers.auth import get_current_user
from app.models.user import User

router = APIRouter()

# Steel API is reachable on the internal Docker network at port 3000.
# For local dev without Docker, fall back to localhost:3001.
_STEEL_API = os.getenv("STEEL_API_URL", "http://steel-browser:3000")

# The session viewer (WebRTC stream) must be reachable by the *user's browser*,
# not by the backend. Default to localhost:5173 for local dev.
_STEEL_PUBLIC_URL = os.getenv("STEEL_PUBLIC_URL", "http://localhost:5173")


def _rewrite_debug_url(raw_url: str) -> str:
    """
    Steel returns debugUrl with whatever host the service thinks it's on
    (e.g. steel-browser:5173 inside Docker). We rewrite the host/port to the
    public address the user's browser can actually reach.
    """
    if not raw_url:
        return raw_url
    try:
        from urllib.parse import urlparse, urlunparse
        parsed = urlparse(raw_url)
        public = urlparse(_STEEL_PUBLIC_URL)
        rewritten = parsed._replace(scheme=public.scheme, netloc=public.netloc)
        return urlunparse(rewritten)
    except Exception:
        return raw_url


class SessionResponse(BaseModel):
    session_id: str
    debug_url: str


class NavigateRequest(BaseModel):
    url: str


@router.post("", response_model=SessionResponse)
async def create_session(
    current_user: User = Depends(get_current_user),
):
    """Spin up a new Steel Browser session and return its live-view URL."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{_STEEL_API}/v1/sessions",
                json={"sessionTimeout": 3600000},  # 1 hour max
            )
            resp.raise_for_status()
    except httpx.TimeoutException:
        raise HTTPException(504, "Steel Browser did not respond in time — is it running?")
    except httpx.RequestError as exc:
        raise HTTPException(502, f"Could not reach Steel Browser: {exc}")
    except httpx.HTTPStatusError as exc:
        raise HTTPException(502, f"Steel Browser returned {exc.response.status_code}")

    data = resp.json()
    session_id = data.get("id") or data.get("sessionId") or data.get("session_id")
    raw_debug_url = data.get("debugUrl") or data.get("debug_url") or ""

    if not session_id:
        raise HTTPException(502, "Steel Browser response missing session id")

    debug_url = _rewrite_debug_url(raw_debug_url)
    return SessionResponse(session_id=session_id, debug_url=debug_url)


@router.delete("/{session_id}")
async def release_session(
    session_id: str,
    current_user: User = Depends(get_current_user),
):
    """Release a Steel Browser session."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.delete(f"{_STEEL_API}/v1/sessions/{session_id}")
            resp.raise_for_status()
    except Exception:  # noqa: BLE001
        pass  # Best-effort cleanup — don't raise if Steel is unreachable
    return {"released": session_id}


@router.post("/{session_id}/navigate")
async def navigate_session(
    session_id: str,
    body: NavigateRequest,
    current_user: User = Depends(get_current_user),
):
    """Navigate the Steel session to a new URL via the Steel API."""
    url = body.url.strip()
    if not url.startswith(("http://", "https://")):
        url = f"https://{url}"

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{_STEEL_API}/v1/sessions/{session_id}/navigate",
                json={"url": url},
            )
            resp.raise_for_status()
    except httpx.TimeoutException:
        raise HTTPException(504, "Navigation request timed out")
    except httpx.RequestError as exc:
        raise HTTPException(502, f"Steel Browser unreachable: {exc}")
    except httpx.HTTPStatusError as exc:
        raise HTTPException(502, f"Steel Browser returned {exc.response.status_code}")

    return {"navigated": url}

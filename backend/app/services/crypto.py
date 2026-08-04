"""Symmetric encryption for secrets at rest (per-user API keys).

Uses Fernet with a key derived from settings.secret_key. cryptography is imported
lazily so this module compiles without it; it's present in the deploy image.
"""
import base64
import hashlib

from app.config import get_settings


def _fernet():
    from cryptography.fernet import Fernet  # lazy
    secret = (get_settings().secret_key or "CHANGE_ME").encode("utf-8")
    key = base64.urlsafe_b64encode(hashlib.sha256(secret).digest())
    return Fernet(key)


def encrypt(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode("utf-8")).decode("utf-8")
    except Exception:
        return ""

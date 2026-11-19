"""Salted slow password hashes (scrypt). Every code point counts; nothing is trimmed or truncated."""

import asyncio
import base64
import hashlib
import hmac
import secrets

_N, _R, _P, _LENGTH = 2**14, 8, 1, 32


def _derive(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=_N, r=_R, p=_P, dklen=_LENGTH)


def _encode(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def hash_password_sync(password: str) -> str:
    salt = secrets.token_bytes(16)
    return f"scrypt${_N}${_R}${_P}${_encode(salt)}${_encode(_derive(password, salt))}"


def _verify_sync(password: str, stored: str) -> bool:
    _, _, _, _, salt, digest = stored.split("$")
    return hmac.compare_digest(_derive(password, base64.b64decode(salt)), base64.b64decode(digest))


async def hash_password(password: str) -> str:
    return await asyncio.to_thread(hash_password_sync, password)


async def verify_password(password: str, stored: str) -> bool:
    return await asyncio.to_thread(_verify_sync, password, stored)


# Checked when an email has no account, so unknown emails cost the same work as known ones.
UNKNOWN_ACCOUNT_HASH = hash_password_sync(secrets.token_urlsafe(16))

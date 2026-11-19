"""Password protection, session tokens, secret redaction and signed opaque cursors."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from typing import Any

import asyncpg

from .errors import ApiError

_PBKDF2_ROUNDS = 120_000
_MASTER_KEY_NAME = "master_key"

_master_key: bytes | None = None


async def load_master_key(conn: asyncpg.Connection) -> None:
    """Load (or create once) the key that protects stored secrets and signs cursors."""
    global _master_key
    stored = await conn.fetchval("SELECT value FROM app_secrets WHERE name = $1", _MASTER_KEY_NAME)
    if stored is None:
        stored = base64.b64encode(secrets.token_bytes(32)).decode()
        await conn.execute(
            "INSERT INTO app_secrets (name, value) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING",
            _MASTER_KEY_NAME,
            stored,
        )
        stored = await conn.fetchval("SELECT value FROM app_secrets WHERE name = $1", _MASTER_KEY_NAME)
    _master_key = base64.b64decode(stored)


def _subkey(label: bytes) -> bytes:
    assert _master_key is not None
    return hmac.new(_master_key, label, hashlib.sha256).digest()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PBKDF2_ROUNDS)
    return f"pbkdf2${_PBKDF2_ROUNDS}${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def verify_password(password: str, stored: str) -> bool:
    _, rounds, salt_b64, digest_b64 = stored.split("$")
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), base64.b64decode(salt_b64), int(rounds))
    return hmac.compare_digest(digest, base64.b64decode(digest_b64))


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_fingerprint(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def protect_secret(plaintext: str) -> str:
    """Store a source API key as unreadable text: an HMAC-SHA256 keystream plus a tag."""
    nonce = secrets.token_bytes(16)
    key = _subkey(b"wayline-secretbox")
    data = plaintext.encode()
    stream = _keystream(key, nonce, len(data))
    cipher = bytes(a ^ b for a, b in zip(data, stream))
    tag = hmac.new(key, nonce + cipher, hashlib.sha256).digest()[:16]
    return base64.urlsafe_b64encode(nonce + tag + cipher).decode()


def reveal_secret(stored: str) -> str:
    raw = base64.urlsafe_b64decode(stored)
    nonce, tag, cipher = raw[:16], raw[16:32], raw[32:]
    key = _subkey(b"wayline-secretbox")
    expected = hmac.new(key, nonce + cipher, hashlib.sha256).digest()[:16]
    if not hmac.compare_digest(tag, expected):
        raise ValueError("secret tag mismatch")
    stream = _keystream(key, nonce, len(cipher))
    return bytes(a ^ b for a, b in zip(cipher, stream)).decode()


def _keystream(key: bytes, nonce: bytes, length: int) -> bytes:
    out = bytearray()
    counter = 0
    while len(out) < length:
        out += hmac.new(key, nonce + counter.to_bytes(4, "big"), hashlib.sha256).digest()
        counter += 1
    return bytes(out[:length])


def sign_cursor(payload: dict[str, Any]) -> str:
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    tag = hmac.new(_subkey(b"wayline-cursor"), body, hashlib.sha256).digest()[:16]
    return base64.urlsafe_b64encode(body + b"." + base64.urlsafe_b64encode(tag)).decode().rstrip("=")


def read_cursor(cursor: str) -> dict[str, Any]:
    """Decode an opaque cursor, refusing anything foreign, edited or truncated."""
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        raw = base64.urlsafe_b64decode(padded)
        body, tag_b64 = raw.rsplit(b".", 1)
        tag = base64.urlsafe_b64decode(tag_b64)
        expected = hmac.new(_subkey(b"wayline-cursor"), body, hashlib.sha256).digest()[:16]
        if not hmac.compare_digest(tag, expected):
            raise ValueError("cursor tag mismatch")
        payload = json.loads(body)
    except Exception as exc:
        raise ApiError("invalid_cursor") from exc
    if not isinstance(payload, dict):
        raise ApiError("invalid_cursor")
    return payload

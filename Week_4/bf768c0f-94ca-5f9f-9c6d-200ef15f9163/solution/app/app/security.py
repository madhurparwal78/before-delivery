"""Passwords, session tokens and opaque cursors. Nothing bought in from a third party."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import uuid

PBKDF2_ROUNDS = 120_000
_CURSOR_SECRET = secrets.token_bytes(32)


def new_id() -> str:
    return str(uuid.uuid4())


def stable_id(*parts: str) -> str:
    return str(uuid.uuid5(uuid.UUID("3f2504e0-4f89-11d3-9a0c-0305e82c3301"), "|".join(parts)))


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${PBKDF2_ROUNDS}${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, rounds, salt_b64, digest_b64 = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), base64.b64decode(salt_b64), int(rounds)
        )
        return hmac.compare_digest(digest, base64.b64decode(digest_b64))
    except Exception:  # noqa: BLE001
        return False


def new_token() -> tuple[str, str]:
    token = secrets.token_urlsafe(36)
    return token, token_hash(token)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class BadCursor(Exception):
    pass


def _keystream(nonce: bytes, length: int) -> bytes:
    out = b""
    counter = 0
    while len(out) < length:
        out += hmac.new(_CURSOR_SECRET, nonce + counter.to_bytes(4, "big"), hashlib.sha256).digest()
        counter += 1
    return out[:length]


def encode_cursor(payload: dict) -> str:
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    nonce = os.urandom(8)
    cipher = bytes(a ^ b for a, b in zip(raw, _keystream(nonce, len(raw))))
    tag = hmac.new(_CURSOR_SECRET, nonce + cipher, hashlib.sha256).digest()[:10]
    return base64.urlsafe_b64encode(nonce + tag + cipher).decode().rstrip("=")


def decode_cursor(cursor: str) -> dict:
    try:
        blob = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        nonce, tag, cipher = blob[:8], blob[8:18], blob[18:]
        if not hmac.compare_digest(
            tag, hmac.new(_CURSOR_SECRET, nonce + cipher, hashlib.sha256).digest()[:10]
        ):
            raise BadCursor("that cursor was never issued")
        raw = bytes(a ^ b for a, b in zip(cipher, _keystream(nonce, len(cipher))))
        return json.loads(raw.decode())
    except BadCursor:
        raise
    except Exception as exc:  # noqa: BLE001
        raise BadCursor("that cursor was never issued") from exc

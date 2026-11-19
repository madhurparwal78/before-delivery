"""Secret handling: a source API key is sealed before it is stored and never leaves the server.

The seal is an encrypt-then-MAC construction from the standard library: an HMAC-SHA256 keystream with a random
nonce, followed by an HMAC-SHA256 tag. The key lives in PostgreSQL (`app_secrets`), so a restart can still read
the key a custom source has to replay to the sandbox."""

import hashlib
import hmac
import secrets
from typing import Any

from .db import db

NONCE = 16
TAG = 32


def _stream(key: bytes, nonce: bytes, length: int) -> bytes:
    blocks = (hmac.new(key, nonce + counter.to_bytes(8, "big"), hashlib.sha256).digest()
              for counter in range(length // 32 + 1))
    return b"".join(blocks)[:length]


def seal(api_key: str) -> bytes:
    key = db.keys["seal"]
    nonce = secrets.token_bytes(NONCE)
    plain = api_key.encode()
    body = bytes(a ^ b for a, b in zip(plain, _stream(key, nonce, len(plain))))
    return nonce + body + hmac.new(key, nonce + body, hashlib.sha256).digest()


def unseal(sealed: bytes) -> str:
    key = db.keys["seal"]
    nonce, body, tag = sealed[:NONCE], sealed[NONCE:-TAG], sealed[-TAG:]
    if not hmac.compare_digest(tag, hmac.new(key, nonce + body, hashlib.sha256).digest()):
        raise ValueError("sealed key was altered")
    return bytes(a ^ b for a, b in zip(body, _stream(key, nonce, len(body)))).decode()


def public_config(config: dict[str, Any]) -> dict[str, Any]:
    """A source's settings as every response shows them: never the key, only that one is set."""
    return {**config, "api_key_set": True}

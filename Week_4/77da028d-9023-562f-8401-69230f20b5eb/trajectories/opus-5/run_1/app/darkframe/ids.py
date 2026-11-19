"""Server-generated record ids and tokens."""

from __future__ import annotations

import secrets

SHARE_TOKEN_BYTES = 32
WORKSPACE_KEY_PREFIX = "dfk_"


def record_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(12)}"


def share_token() -> str:
    return secrets.token_urlsafe(SHARE_TOKEN_BYTES)


def workspace_key() -> str:
    return WORKSPACE_KEY_PREFIX + secrets.token_hex(16)


def lock_token() -> str:
    return secrets.token_urlsafe(18)

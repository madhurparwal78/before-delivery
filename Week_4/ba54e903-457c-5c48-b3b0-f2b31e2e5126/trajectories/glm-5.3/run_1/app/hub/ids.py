"""Id generation helpers."""
from __future__ import annotations

import secrets
import string

ALPHABET = string.ascii_letters + string.digits


def new_token() -> str:
    """Bearer token of letters, digits, - and _ (base64url of random bytes)."""
    raw = secrets.token_bytes(32)
    return raw.hex() + "-" + secrets.token_urlsafe(24).replace("-", "a").replace("_", "b")


def new_invite_code() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(8))


def new_nonce() -> str:
    return secrets.token_hex(16)


def new_slug() -> str:
    return "x" + secrets.token_hex(8)

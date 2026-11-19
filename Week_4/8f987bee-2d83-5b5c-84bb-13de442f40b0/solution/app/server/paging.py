"""Opaque position cursors, signed and bound to the listing that issued them."""

import base64
import binascii
import hashlib
import hmac
import json
from typing import Any

from .db import db
from .errors import ApiError, validation

LIMIT_MAX = 100


def limit_of(raw: str | None, default: int) -> int:
    if raw is None:
        return default
    if not raw.isdigit() or not 1 <= int(raw) <= LIMIT_MAX:
        raise validation({"limit": "Choose a whole number from 1 to 100."})
    return int(raw)


def _sign(payload: bytes) -> str:
    return hmac.new(db.keys["cursor"], payload, hashlib.sha256).hexdigest()[:32]


def encode(scope: dict[str, Any], position: dict[str, Any]) -> str:
    payload = json.dumps({"s": scope, "p": position}, separators=(",", ":"), sort_keys=True).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=") + "." + _sign(payload)


def decode(cursor: str, scope: dict[str, Any]) -> dict[str, Any]:
    """The position a cursor carries, when it was issued for exactly this listing."""
    refused = ApiError(400, "invalid_cursor")
    text, _, signature = cursor.partition(".")
    try:
        payload = base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    except (binascii.Error, ValueError):
        raise refused from None
    if not hmac.compare_digest(signature, _sign(payload)):
        raise refused
    body = json.loads(payload)
    if body["s"] != scope:
        raise refused
    return body["p"]

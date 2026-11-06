"""Idempotency-Key answers, JSON body equality and the key lifetime."""
from __future__ import annotations

import datetime as dt
import re
from typing import Any

from . import config

KEY_PATTERN = re.compile(r"^[\x21-\x7e]{1,255}$")

ERR_INVALID_KEY = "invalid_idempotency_key"
ERR_REUSED = "idempotency_key_reused"
ERR_IN_PROGRESS = "request_in_progress"


def valid_key(key: str) -> bool:
    """1 to 255 visible ASCII characters, `!` through `~`."""
    return bool(KEY_PATTERN.match(key))


def expires_at(first_used: dt.datetime) -> dt.datetime:
    return first_used + dt.timedelta(seconds=config.IDEMPOTENCY_KEY_TTL_SECONDS)


def request_hash(payload: Any) -> str:
    """The identity of a request body for the idempotency store."""
    import hashlib
    import json

    canonical = json.dumps(
        canonical_form(payload), ensure_ascii=True, sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def canonical_form(value: Any) -> Any:
    """The value under the published equality rule: member order never
    matters, strings compare code point by code point, 1 equals 1.0, and
    booleans and null never equal numbers."""
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return value
    if isinstance(value, float):
        # 1 and 1.0 are the same number, whatever literal wrote them.
        return int(value) if value.is_integer() else value
    if isinstance(value, dict):
        return {key: canonical_form(entry) for key, entry in value.items()}
    if isinstance(value, list):
        return [canonical_form(entry) for entry in value]
    return value


# Answers that are stored together with the key and its body.
STORABLE_STATUS = {201, 409}
STORABLE_CONFLICT = {"duplicate_application"}
# A 422 is stored as well: a replayed 422 stays a 422 with an equal body.
STORABLE_ERROR_CODES = {"validation_failed"}


def is_storable(status: int, error_code: str | None) -> bool:
    if status == 201:
        return True
    if status == 409 and error_code in STORABLE_CONFLICT:
        return True
    if status == 422 and error_code in STORABLE_ERROR_CODES:
        return True
    return False

"""Opaque keyset cursor over (start time, id): unpadded base64url of a two-item JSON list."""

import base64
import binascii
import json
import re
from datetime import datetime

from .errors import validation

BIGINT_MAX = 2**63 - 1


def encode_cursor(started: datetime, id_: int) -> str:
    return base64.urlsafe_b64encode(json.dumps([started.isoformat(), id_], separators=(",", ":")).encode()).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, int]:
    """(start time, id) of a cursor; a malformed cursor answers 400 before any query."""
    if re.fullmatch(r"[A-Za-z0-9_-]+", cursor):
        try:
            started, id_ = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
            moment = datetime.fromisoformat(started)
            if moment.tzinfo is not None and isinstance(id_, int) and not isinstance(id_, bool) and 0 <= id_ <= BIGINT_MAX:
                return moment, id_
        except (binascii.Error, ValueError, TypeError):
            pass
    raise validation({"cursor": "cursor is not one this API returned"})

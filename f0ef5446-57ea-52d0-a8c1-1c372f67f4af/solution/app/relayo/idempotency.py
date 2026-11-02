"""Idempotency-Key on application create: key format, body equality, lifetime and stored answers."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from werkzeug.wrappers import Response

from . import db
from .config import settings
from .http import JSON_TYPE, ApiError

KEY_FORMAT = re.compile(r"[!-~]{1,255}")


def check_key(value: str) -> str:
    if not KEY_FORMAT.fullmatch(value):
        raise ApiError(400, "invalid_idempotency_key")
    return value


def _canonical(value: Any) -> str:
    """One text per JSON value under the brief's equality: member order and number spelling ignored,
    strings compared code point by code point, true/false/null never equal to a number."""
    if isinstance(value, dict):
        return "{" + ",".join(f"{json.dumps(k)}:{_canonical(v)}" for k, v in sorted(value.items())) + "}"
    if isinstance(value, list):
        return "[" + ",".join(_canonical(item) for item in value) + "]"
    if isinstance(value, Decimal):
        return "n:0" if value == 0 else "n:" + str(value.normalize())
    return json.dumps(value)


def body_hash(body: dict[str, Any]) -> str:
    return hashlib.sha256(_canonical(body).encode("utf-8", "surrogatepass")).hexdigest()


@dataclass(frozen=True, slots=True)
class Claim:
    id: int


CLAIM = """
INSERT INTO idempotency_keys AS k (key, body_hash, state, first_used_at, expires_at)
SELECT :key, :digest, 'in_progress', t.now, t.now + make_interval(secs => :ttl)
FROM (SELECT clock_timestamp() AS now) t
ON CONFLICT (key) DO UPDATE SET body_hash = EXCLUDED.body_hash, state = 'in_progress', response_status = NULL,
    response_body = NULL, first_used_at = EXCLUDED.first_used_at, expires_at = EXCLUDED.expires_at
WHERE k.expires_at <= clock_timestamp()
RETURNING k.id
"""
HELD = """
SELECT body_hash, state, response_status, response_body FROM idempotency_keys
WHERE key = :key AND expires_at > clock_timestamp()
"""


def claim(key: str, digest: str) -> Claim | Response:
    """Take the key for processing (fresh or expired), or answer from what it already holds."""
    with db.connection() as conn:
        for _ in range(3):
            won = db.one(conn, CLAIM, key=key, digest=digest, ttl=float(settings.idempotency_key_ttl_seconds))
            if won:
                return Claim(won["id"])
            held = db.one(conn, HELD, key=key)
            if held is None:
                continue
            if held["body_hash"] != digest:
                raise ApiError(422, "idempotency_key_reused")
            if held["state"] == "in_progress":
                raise ApiError(409, "request_in_progress")
            return Response(held["response_body"], status=held["response_status"],
                            headers={"Idempotent-Replayed": "true"}, content_type=JSON_TYPE)
    raise ApiError(409, "request_in_progress")


def store(conn: db.Connection, taken: Claim, status: int, text: str) -> None:
    conn.run("UPDATE idempotency_keys SET state = 'done', response_status = :status, response_body = :text "
             "WHERE id = :id", status=status, text=text, id=taken.id)


def release(taken: Claim) -> None:
    """A failed (5xx) attempt gives the key back so a retry is processed fresh."""
    with db.connection() as conn:
        conn.run("DELETE FROM idempotency_keys WHERE id = :id AND state = 'in_progress'", id=taken.id)

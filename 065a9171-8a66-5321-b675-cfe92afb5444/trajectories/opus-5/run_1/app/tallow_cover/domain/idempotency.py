"""The one idempotency-key rule, shared by punches and cover claims."""

from __future__ import annotations

import hashlib

from ..config import CONFIG
from ..db import Unique, execute, row
from ..errors import ApiError

KEY_MAX_LENGTH = 100


def read_key(header: str | None) -> str | None:
    """The key, or None when it is missing or outside 1 to 100 characters."""
    if not header or not 1 <= len(header) <= KEY_MAX_LENGTH:
        return None
    return header


def _fingerprint(body_text: str) -> str:
    return hashlib.sha256(body_text.encode("utf-8")).hexdigest()


def _judge(existing: dict, method: str, path: str, body_hash: str) -> tuple[int, str]:
    if (
        existing["method"] != method
        or existing["path"] != path
        or existing["body_hash"] != body_hash
    ):
        raise ApiError("idempotency_key_reused")
    return existing["status"], existing["response_body"]


def _lookup(conn, person_id: str, key: str) -> dict | None:
    return row(
        conn,
        """SELECT method, path, body_hash, status, response_body
           FROM idempotency_records
           WHERE person_id = %s AND idem_key = %s
             AND created_at > now() - make_interval(secs => %s)""",
        (person_id, key, CONFIG.idempotency_ttl_seconds),
    )


def start(conn, person_id: str, key: str, method: str, path: str, body_text: str):
    """Claim the key for this request, or hand back the response to replay.

    A duplicate that arrives while the first request is still running blocks on
    the key's unique index, so the action runs at most once.
    """
    body_hash = _fingerprint(body_text)
    existing = _lookup(conn, person_id, key)
    if existing:
        return _judge(existing, method, path, body_hash)
    execute(conn, "SAVEPOINT claim_key")
    try:
        execute(
            conn,
            """INSERT INTO idempotency_records (person_id, idem_key, method, path, body_hash)
               VALUES (%s, %s, %s, %s, %s)""",
            (person_id, key, method, path, body_hash),
        )
    except Unique:
        execute(conn, "ROLLBACK TO SAVEPOINT claim_key")
        return _judge(_lookup(conn, person_id, key), method, path, body_hash)
    execute(conn, "RELEASE SAVEPOINT claim_key")
    return None


def finish(conn, person_id: str, key: str, status: int, response_body: str) -> None:
    execute(
        conn,
        """UPDATE idempotency_records SET status = %s, response_body = %s
           WHERE person_id = %s AND idem_key = %s""",
        (status, response_body, person_id, key),
    )

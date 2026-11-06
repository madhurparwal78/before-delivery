"""Idempotency keys, scoped to a person and an endpoint rather than a session."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from . import db
from .errors import ApiError, ValidationFailed
from .http import Context
from .ledger import canonical_json
from .validation import IDEMPOTENCY_UNUSABLE, is_unstorable

REPLAY_HEADER = {"Idempotent-Replay": "true"}


def key_of(ctx: Context) -> str | None:
    raw = ctx.headers.get("idempotency-key")
    if raw is None:
        return None
    if len(raw) < 1 or len(raw) > 128 or is_unstorable(raw):
        raise ValidationFailed({"idempotency_key": IDEMPOTENCY_UNUSABLE})
    return raw


def fingerprint(payload: str) -> str:
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def body_fingerprint(ctx: Context) -> str:
    return fingerprint(canonical_json(ctx.body))


def _lookup(cur: Any, user_id: str, endpoint: str, key: str) -> dict | None:
    cur.execute(
        """
        SELECT * FROM idempotency_keys
        WHERE user_id = %s AND endpoint = %s AND key = %s
        """,
        (user_id, endpoint, key),
    )
    row = cur.fetchone()
    return dict(row) if row else None


def _matched(row: dict, mark: str) -> tuple[int, Any, dict]:
    if row["fingerprint"] != mark:
        raise ApiError("idempotency_conflict")
    return row["status"], row["body"], dict(REPLAY_HEADER)


def replay_or_claim(
    ctx: Context, endpoint: str, mark: str | None = None
) -> tuple[int, Any, dict] | None:
    key = key_of(ctx)
    if key is None:
        return None
    mark = mark or body_fingerprint(ctx)
    with db.tx() as cur:
        row = _lookup(cur, ctx.user["id"], endpoint, key)
    if row is None:
        return None
    return _matched(row, mark)


def replay_inside(
    cur: Any, ctx: Context, endpoint: str, mark: str | None = None
) -> tuple[int, Any, dict] | None:
    """Serialises concurrent requests carrying one key, so exactly one takes effect."""
    key = key_of(ctx)
    if key is None:
        return None
    db.take_lock(cur, 7, f"{ctx.user['id']}:{endpoint}:{key}")
    row = _lookup(cur, ctx.user["id"], endpoint, key)
    if row is None:
        return None
    return _matched(row, mark or body_fingerprint(ctx))


def store_response(
    cur: Any,
    ctx: Context,
    endpoint: str,
    status: int,
    body: Any,
    mark: str | None = None,
) -> None:
    key = key_of(ctx)
    if key is None:
        return
    cur.execute(
        """
        INSERT INTO idempotency_keys
            (id, user_id, endpoint, key, fingerprint, status, body, created_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            db.next_id(cur, "IDM", width=8),
            ctx.user["id"],
            endpoint,
            key,
            mark or body_fingerprint(ctx),
            status,
            json.dumps(body),
            datetime.now(timezone.utc),
        ),
    )

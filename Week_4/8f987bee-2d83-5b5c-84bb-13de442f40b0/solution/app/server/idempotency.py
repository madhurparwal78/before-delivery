"""Idempotency keys: a live key replays its first connection or job; the key's lifetime is decided here."""

import hashlib
import json
import re
import uuid
from datetime import timedelta
from typing import Any

import asyncpg
from fastapi import Request

from .config import settings
from .db import utcnow
from .errors import ApiError, validation

KEY = re.compile(r"[\x21-\x7e]{1,255}")


def key_of(request: Request) -> str | None:
    key = request.headers.get("idempotency-key")
    if key is None:
        return None
    if not KEY.fullmatch(key):
        raise validation({"Idempotency-Key": "Send 1 to 255 visible ASCII characters."})
    return key


def fingerprint(method: str, path: str, body: Any) -> str:
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(f"{method}\n{path}\n{canonical}".encode()).hexdigest()


async def replayed(conn: asyncpg.Connection, workspace_id: uuid.UUID, key: str, request_print: str) -> uuid.UUID | None:
    """Hold the key for this transaction (simultaneous replays wait here), then answer with the resource a live
    key recorded, refuse a live key reused for another request, or None for a new request."""
    await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", f"{workspace_id}:{key}")
    stored = await conn.fetchrow("SELECT fingerprint, resource_id FROM idempotency_keys "
                                 "WHERE workspace_id = $1 AND key = $2 AND expires_at > $3", workspace_id, key, utcnow())
    if stored is None:
        return None
    if stored["fingerprint"] != request_print:
        raise ApiError(422, "idempotency_key_reused")
    return stored["resource_id"]


async def record(conn: asyncpg.Connection, workspace_id: uuid.UUID, key: str, request_print: str, kind: str,
                 resource_id: uuid.UUID) -> None:
    now = utcnow()
    await conn.execute(
        """INSERT INTO idempotency_keys (workspace_id, key, fingerprint, resource_kind, resource_id, recorded_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (workspace_id, key) DO UPDATE SET fingerprint = EXCLUDED.fingerprint,
               resource_kind = EXCLUDED.resource_kind, resource_id = EXCLUDED.resource_id,
               recorded_at = EXCLUDED.recorded_at, expires_at = EXCLUDED.expires_at""",
        workspace_id, key, request_print, kind, resource_id, now, now + timedelta(seconds=settings.idempotency_ttl_seconds))

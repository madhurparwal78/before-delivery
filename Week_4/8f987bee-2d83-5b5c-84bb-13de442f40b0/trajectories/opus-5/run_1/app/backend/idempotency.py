"""Idempotency keys: one recorded outcome per key, live until its `expires_at`."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from .config import settings
from .db import database
from .errors import ApiError


@dataclass(frozen=True)
class Replay:
    resource_kind: str
    resource_id: str


async def claim(
    workspace_id: uuid.UUID, key: str, method: str, path: str, body: dict[str, Any]
) -> Replay | None:
    """Claim a key for this request, or answer with the outcome a live key already holds."""
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=settings.idempotency_ttl_seconds)
    async with database.transaction() as conn:
        claimed = await conn.fetchval(
            """
            INSERT INTO idempotency_keys
                (workspace_id, key, method, path, body, state, resource_kind, resource_id, created_at, expires_at)
            VALUES ($1, $2, $3, $4, $5, 'in_flight', NULL, NULL, $6, $7)
            ON CONFLICT (workspace_id, key) DO UPDATE
                SET method = $3, path = $4, body = $5, state = 'in_flight',
                    resource_kind = NULL, resource_id = NULL, created_at = $6, expires_at = $7
                WHERE idempotency_keys.expires_at <= $6
            RETURNING true
            """,
            workspace_id,
            key,
            method,
            path,
            body,
            now,
            expires_at,
        )
        if claimed:
            return None
        stored = await conn.fetchrow(
            "SELECT * FROM idempotency_keys WHERE workspace_id = $1 AND key = $2",
            workspace_id,
            key,
        )
        if stored["state"] == "in_flight":
            raise ApiError("idempotency_key_in_flight")
        if stored["method"] != method or stored["path"] != path or stored["body"] != body:
            raise ApiError("idempotency_key_reused")
        return Replay(stored["resource_kind"], stored["resource_id"])


async def record(workspace_id: uuid.UUID, key: str, resource_kind: str, resource_id: str) -> None:
    now = datetime.now(timezone.utc)
    await database.execute(
        """
        UPDATE idempotency_keys
        SET state = 'recorded', resource_kind = $3, resource_id = $4, created_at = $5, expires_at = $6
        WHERE workspace_id = $1 AND key = $2
        """,
        workspace_id,
        key,
        resource_kind,
        resource_id,
        now,
        now + timedelta(seconds=settings.idempotency_ttl_seconds),
    )


async def release(workspace_id: uuid.UUID, key: str) -> None:
    """A refused request leaves its key unused."""
    await database.execute(
        "DELETE FROM idempotency_keys WHERE workspace_id = $1 AND key = $2 AND state = 'in_flight'",
        workspace_id,
        key,
    )


async def clear_in_flight(pool: Any) -> None:
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM idempotency_keys WHERE state = 'in_flight'")

"""The Idempotency-Key store: one processing per key, with replay and lifetime."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

import asyncpg

from .config import CONFIG

KEY_PATTERN = re.compile(r"\A[!-~]{1,255}\Z")

STORABLE_STATUSES = (201, 409, 422)


def is_valid_key(key: str) -> bool:
    return KEY_PATTERN.match(key) is not None


@dataclass(frozen=True)
class Processing:
    """This request is the one processing the key."""


@dataclass(frozen=True)
class Replay:
    status: int
    body: dict[str, Any]


@dataclass(frozen=True)
class InProgress:
    """Another request holds the key and is still being processed."""


@dataclass(frozen=True)
class KeyReused:
    """The key was first used with a different body."""


Claim = Processing | Replay | InProgress | KeyReused


async def claim_key(connection: asyncpg.Connection, key: str, fingerprint: str) -> Claim:
    """Take the key for processing, or report the answer that the store already holds."""
    taken = await connection.fetchval(
        """
        INSERT INTO idempotency_records
            (idempotency_key, body_fingerprint, state, first_used_at)
        VALUES ($1, $2, 'in_progress', now())
        ON CONFLICT (idempotency_key) DO UPDATE
        SET body_fingerprint = EXCLUDED.body_fingerprint,
            state = 'in_progress',
            response_status = NULL,
            response_body = NULL,
            first_used_at = now()
        WHERE idempotency_records.first_used_at
              + make_interval(secs => $3) <= now()
        RETURNING id
        """,
        key,
        fingerprint,
        float(CONFIG.idempotency_key_ttl_seconds),
    )
    if taken is not None:
        return Processing()

    record = await connection.fetchrow(
        """
        SELECT body_fingerprint, state, response_status, response_body
        FROM idempotency_records
        WHERE idempotency_key = $1
        """,
        key,
    )
    if record is None:
        return InProgress()
    if record["body_fingerprint"] != fingerprint:
        return KeyReused()
    if record["state"] == "done" and record["response_status"] is not None:
        return Replay(
            status=int(record["response_status"]),
            body=json.loads(record["response_body"]),
        )
    return InProgress()


async def store_answer(
    connection: asyncpg.Connection,
    key: str,
    status: int,
    body: dict[str, Any],
) -> None:
    await connection.execute(
        """
        UPDATE idempotency_records
        SET state = 'done', response_status = $2, response_body = $3
        WHERE idempotency_key = $1
        """,
        key,
        status,
        json.dumps(body, ensure_ascii=True),
    )


async def release_key(connection: asyncpg.Connection, key: str) -> None:
    await connection.execute(
        "DELETE FROM idempotency_records WHERE idempotency_key = $1",
        key,
    )

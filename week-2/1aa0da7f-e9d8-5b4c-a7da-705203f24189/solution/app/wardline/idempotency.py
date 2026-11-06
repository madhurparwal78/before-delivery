"""Stored successful responses for repeated keys, scoped to person and endpoint."""

from __future__ import annotations

import hashlib
import json
from typing import Any

import asyncpg

from wardline.db import DB
from wardline.errors import ApiError
from wardline.fields import BAD_KEY
from wardline.web import Reply, Request, encode_json


def key_of(request: Request) -> str | None:
    return request.headers.get("idempotency-key")


def key_error(key: str | None) -> str | None:
    return BAD_KEY if key is not None and not 1 <= len(key) <= 128 else None


def fingerprint(*parts: Any) -> str:
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False, sort_keys=True).encode("utf-8", "surrogatepass")).hexdigest()


def _replay(stored: asyncpg.Record, expected: str) -> Reply:
    if stored["fingerprint"] != expected:
        raise ApiError("idempotency_conflict")
    return Reply(stored["status"], json.loads(stored["body"]), {"idempotent-replay": "true"})


async def find_replay(request: Request, endpoint: str, key: str | None, expected: str) -> Reply | None:
    if key is None or key_error(key):
        return None
    async with DB.connection() as conn:
        stored = await conn.fetchrow(
            "SELECT * FROM idempotency_keys WHERE user_id = $1 AND endpoint = $2 AND key = $3",
            request.person.id, endpoint, key,
        )
    return _replay(stored, expected) if stored else None


async def claim_key(conn: asyncpg.Connection, request: Request, endpoint: str, key: str | None, expected: str) -> Reply | None:
    """Serialise one key inside the writing transaction. Returns the winner's reply if another request got there first."""
    if key is None:
        return None
    await conn.execute(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", f"{request.person.id}\n{endpoint}\n{key}"
    )
    stored = await conn.fetchrow(
        "SELECT * FROM idempotency_keys WHERE user_id = $1 AND endpoint = $2 AND key = $3",
        request.person.id, endpoint, key,
    )
    return _replay(stored, expected) if stored else None


async def store_reply(conn: asyncpg.Connection, request: Request, endpoint: str, key: str | None, expected: str, reply: Reply) -> None:
    if key is not None:
        await conn.execute(
            "INSERT INTO idempotency_keys (user_id, endpoint, key, fingerprint, status, body) VALUES ($1, $2, $3, $4, $5, $6)",
            request.person.id, endpoint, key, expected, reply.status, encode_json(reply.body).decode("utf-8", "surrogatepass"),
        )

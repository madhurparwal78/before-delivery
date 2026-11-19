"""The console's two idempotent creations, keyed by `Idempotency-Key`."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import Request

from .. import idempotency
from ..connections import connection_payload
from ..context import Caller
from ..db import database
from ..sync import job_payload
from ..validation import read_json_object

Creator = Callable[[], Awaitable[tuple[dict[str, Any], str]]]
Replayer = Callable[[Caller, str], Awaitable[dict[str, Any]]]


async def run_with_key(
    caller: Caller,
    key: str | None,
    request: Request,
    raw: bytes,
    *,
    resource_kind: str,
    create: Creator,
    replay: Replayer,
    success_status: int,
) -> tuple[dict[str, Any], int]:
    if key is None:
        payload, _ = await create()
        return payload, success_status
    body = read_json_object(raw)
    held = await idempotency.claim(caller.workspace_id, key, request.method, request.url.path, body)
    if held is not None:
        return await replay(caller, held.resource_id), 200
    try:
        payload, resource_id = await create()
    except BaseException:
        await idempotency.release(caller.workspace_id, key)
        raise
    await idempotency.record(caller.workspace_id, key, resource_kind, resource_id)
    return payload, success_status


async def replay_connection(caller: Caller, resource_id: str) -> dict[str, Any]:
    row = await database.fetchrow(
        "SELECT * FROM connections WHERE id = $1 AND workspace_id = $2",
        uuid.UUID(resource_id),
        caller.workspace_id,
    )
    return {"connection": connection_payload(row)}


async def replay_job(caller: Caller, resource_id: str) -> dict[str, Any]:
    row = await database.fetchrow(
        "SELECT * FROM jobs WHERE id = $1 AND workspace_id = $2",
        uuid.UUID(resource_id),
        caller.workspace_id,
    )
    return {"job": job_payload(row)}

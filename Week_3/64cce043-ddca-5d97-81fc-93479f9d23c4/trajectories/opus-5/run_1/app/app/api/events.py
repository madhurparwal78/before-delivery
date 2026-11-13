"""Live streams: database notifications relayed to one caller's open screen."""
from __future__ import annotations

import asyncio
import json
import time
from typing import AsyncIterator

from starlette.responses import Response, StreamingResponse

from ..config import KEEPALIVE_SECONDS
from ..grants import contact_grant
from .base import Ctx

EXPIRY_RECHECK_SECONDS = 0.25
STREAM_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


async def events(ctx: Ctx) -> Response:
    return StreamingResponse(
        _stream(ctx), media_type="text/event-stream", headers=STREAM_HEADERS
    )


def _frame(event: str, data: dict[str, object]) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n".encode("utf-8")


async def _stream(ctx: Ctx) -> AsyncIterator[bytes]:
    caller = ctx.caller
    queue = ctx.db.subscribe(caller.vault_id)
    try:
        yield b": open\n\n"
        expiry_at = await _expiry_deadline(ctx) if caller.is_contact else None
        while True:
            timeout = float(KEEPALIVE_SECONDS)
            if expiry_at is not None:
                timeout = max(min(timeout, expiry_at - time.monotonic()), 0.0)
            try:
                change = await asyncio.wait_for(queue.get(), timeout)
            except asyncio.TimeoutError:
                change = None

            if change is None:
                if caller.is_contact and not await _still_granted(ctx):
                    yield _frame("access-ended", {})
                    return
                if expiry_at is not None and expiry_at - time.monotonic() <= 0:
                    expiry_at = time.monotonic() + EXPIRY_RECHECK_SECONDS
                    continue
                if not await _session_alive(ctx):
                    return
                yield b": keep-alive\n\n"
                continue

            if not caller.is_contact:
                yield _frame("change", {"type": change["type"], "id": change["id"]})
                continue
            if change["type"] == "grant.updated":
                if not await _still_granted(ctx):
                    yield _frame("access-ended", {})
                    return
                yield _frame("change", {"type": "grant.updated", "id": change["id"]})
                continue
            yield _frame("change", {"type": "view.changed", "id": None})
    finally:
        ctx.db.unsubscribe(caller.vault_id, queue)


async def _expiry_deadline(ctx: Ctx) -> float:
    """Schedule the contact's access-ended against the database clock."""
    async with ctx.db.pool.acquire() as connection:
        grant = await contact_grant(connection, ctx.vault_id, ctx.caller.account_id)
        db_now = await connection.fetchval("select now()")
    remaining = grant.remaining_seconds(db_now) if grant is not None else 0
    return time.monotonic() + remaining


async def _still_granted(ctx: Ctx) -> bool:
    async with ctx.db.pool.acquire() as connection:
        grant = await contact_grant(connection, ctx.vault_id, ctx.caller.account_id)
        db_now = await connection.fetchval("select now()")
    return grant is not None and grant.is_active(db_now)


async def _session_alive(ctx: Ctx) -> bool:
    return bool(
        await ctx.db.fetchval(
            """select 1 from sessions
               where id = $1 and now() - last_seen_at < ($2 * interval '1 second')""",
            ctx.caller.session_id,
            ctx.state.settings.session_idle_seconds,
        )
    )

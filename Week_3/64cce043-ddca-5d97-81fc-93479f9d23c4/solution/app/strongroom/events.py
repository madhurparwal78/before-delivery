"""`GET /api/events`: the live stream. Each stream holds its own Postgres LISTEN session, closed with the stream."""
from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator

from starlette.requests import Request
from starlette.responses import Response, StreamingResponse

from . import auth, db, domain
from .auth import Caller, Grant
from .state import State

KEEPALIVE_S = 15


def _event(name: str, data: dict) -> str:
    return f"event: {name}\ndata: {json.dumps(data)}\n\n"


async def events(request: Request) -> Response:
    state: State = request.app.state.strongroom
    async with state.pool.acquire() as conn:
        who = await auth.caller(request, conn)
    listener = await db.listen(state.config, who.vault_id)
    # A contact's stream is scheduled against the grant's end instant by the database clock.
    deadline = None if who.grant is None else time.monotonic() + domain.seconds_left(who.grant.ends_at, who.now)
    return StreamingResponse(_relay(state, who, listener, deadline), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


async def _relay(state: State, who: Caller, listener: db.Listener, deadline: float | None) -> AsyncIterator[str]:
    try:
        yield ": open\n\n"
        while True:
            wait = KEEPALIVE_S if deadline is None else max(0.0, min(KEEPALIVE_S, deadline - time.monotonic()))
            try:
                change = await asyncio.wait_for(listener.notifications.get(), wait)
            except TimeoutError:
                if deadline is not None and time.monotonic() >= deadline:
                    if await _grant_ended(state, who, wait_for_end=True):
                        yield _event("access-ended", {})
                        return
                yield ": keep-alive\n\n"
                if not await _session_alive(state, who):
                    return
                continue
            if who.is_owner:
                yield _event("change", {"type": change["type"], "id": change["id"]})
                continue
            if await _grant_ended(state, who, wait_for_end=False):
                yield _event("access-ended", {})
                return
            if not await _session_alive(state, who):
                return
            if change["type"] == "grant.updated":
                yield _event("change", {"type": "grant.updated", "id": change["id"]})
            else:
                yield _event("change", {"type": "view.changed", "id": None})
    finally:
        await listener.close()


async def _session_alive(state: State, who: Caller) -> bool:
    async with state.pool.acquire() as conn:
        return await auth.session_of(state, conn, who.session_id, touch=False) is not None


async def _grant_ended(state: State, who: Caller, *, wait_for_end: bool) -> bool:
    """Reads the contact's grant status by the database clock; at the scheduled instant it waits out any drift."""
    while True:
        async with state.pool.acquire() as conn:
            row = await conn.fetchrow("SELECT *, clock_timestamp() AS now FROM access_grant WHERE id = $1", who.grant.id)
        grant = Grant.from_row(row, row["now"])
        if grant.status != "active":
            return True
        if not wait_for_end:
            return False
        await asyncio.sleep(domain.seconds_left(grant.ends_at, row["now"]) + 0.01)

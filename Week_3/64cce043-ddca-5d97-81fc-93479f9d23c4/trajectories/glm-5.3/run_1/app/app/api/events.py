"""The live event stream: database notifications relayed to open screens.

Every committed change sends one database notification on channel
strongroom_events. This stream relays those notifications to the caller within
two seconds, keeping each stream's database resources held only while the
client is connected.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Optional

import asyncpg
from aiohttp import web
from aiohttp.web_response import StreamResponse

from ..auth.store import Context, SESSION_COOKIE
from ..core.grant_state import GrantView, grant_status
from ..db.base import NOTIFY_CHANNEL
from ..errors import ApiError, access_ended, signed_out

log = logging.getLogger("strongroom.events")

KEEPALIVE_SECONDS = 15
EXPIRY_WINDOW = 2.0


def _sse(event: str, data: Any) -> bytes:
    payload = json.dumps(data, separators=(",", ":"))
    return f"event: {event}\ndata: {payload}\n\n".encode("utf-8")


class EventHub:
    """One shared listener connection feeding per-stream queues."""

    def __init__(self, db) -> None:
        self.db = db
        self._listener_conn: Optional[asyncpg.Connection] = None
        self._lock = asyncio.Lock()
        self._subscribers: dict[str, set[asyncio.Queue]] = {}
        self._started = False

    async def start(self) -> None:
        if self._started:
            return
        self._started = True
        asyncio.create_task(self._listen_forever())

    async def stop(self) -> None:
        self._started = False
        if self._listener_conn is not None:
            with contextlib.suppress(Exception):
                await self._listener_conn.close()
            self._listener_conn = None

    async def _listen_forever(self) -> None:
        """Hold one dedicated listener connection and fan out notifications."""
        while self._started:
            conn = None
            try:
                conn = await self.db.create_pool_conn_for_listen()
                await conn.add_listener(NOTIFY_CHANNEL, self._on_notification)
                self._listener_conn = conn
                while self._started:
                    await asyncio.sleep(0.25)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.warning("listener reconnecting: %s", exc)
            finally:
                if conn is not None:
                    with contextlib.suppress(Exception):
                        await conn.remove_listener(NOTIFY_CHANNEL, self._on_notification)
                        await conn.close()
                self._listener_conn = None
            await asyncio.sleep(1.0)

    def _on_notification(self, conn, pid, channel: str, payload: str) -> None:
        try:
            data = json.loads(payload)
        except Exception:
            return
        vault_id = data.get("vault_id")
        queues = self._subscribers.get(vault_id)
        if not queues:
            return
        message = {"type": data.get("type"), "id": data.get("id")}
        for q in list(queues):
            q.put_nowait(message)

    def subscribe(self, vault_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._subscribers.setdefault(vault_id, set()).add(q)
        return q

    def unsubscribe(self, vault_id: str, queue: asyncio.Queue) -> None:
        queues = self._subscribers.get(vault_id)
        if queues is not None:
            queues.discard(queue)
            if not queues:
                self._subscribers.pop(vault_id, None)

    def push(self, vault_id: str, message: dict) -> None:
        """Deliver a message directly to every subscriber of the vault."""
        queues = self._subscribers.get(vault_id)
        if not queues:
            return
        for q in list(queues):
            q.put_nowait(message)


def _owner_event(message: dict) -> bytes:
    return _sse("change", {"type": message["type"], "id": message["id"]})


def _contact_event(message: dict) -> bytes:
    """Contacts never receive record types or ids, except grant.updated."""
    if message["type"] == "grant.updated":
        return _sse("change", {"type": "grant.updated", "id": message["id"]})
    return _sse("change", {"type": "view.changed", "id": None})


async def events_stream(request: web.Request) -> web.Response:
    """The live stream for one caller, holding resources only while connected."""
    ctx: Context = request["ctx"]
    hub: EventHub = request.app["hub"]
    db = request.app["db"]
    session_id = request.cookies.get(SESSION_COOKIE)
    role = ctx.account.role
    vault_id = ctx.account.vault_id

    response = StreamResponse(
        status=200,
        headers={
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
    await response.prepare(request)

    queue = hub.subscribe(vault_id) if vault_id else asyncio.Queue()

    # Grant state, decided from the database on every event.
    async def grant_state() -> Optional[tuple[str, int, datetime]]:
        reader = request.app["reader"]
        grant = await reader.grant_for_vault(vault_id)
        if grant is None:
            return None
        db_now = await db.fetchval("SELECT now()")
        status, remaining = grant_status(grant, db_now)
        return status, remaining, grant.ends_at

    async def session_alive() -> bool:
        if session_id is None:
            return False
        row = await db.fetchrow(
            "SELECT last_activity, now() AS db_now FROM sessions WHERE id = $1", session_id
        )
        if row is None:
            return False
        return (row["db_now"] - row["last_activity"]).total_seconds() <= request.app["cfg"].session_idle_seconds

    ends_at: Optional[datetime] = None
    if role == "contact":
        state = await grant_state()
        if state is None or state[0] != "active":
            await response.write(_sse("access-ended", {}))
            await response.write(b": closing\n\n")
            await response.write_eof()
            hub.unsubscribe(vault_id, queue) if vault_id else None
            return response
        ends_at = state[2]

    try:
        keepalive_at = time.monotonic() + KEEPALIVE_SECONDS
        while True:
            # Expiry is scheduled against ends_at by the database clock: the
            # stream pushes access-ended between the end instant and two
            # seconds after it, then closes.
            if role == "contact":
                db_now = await db.fetchval("SELECT now()")
                if ends_at is not None and db_now >= ends_at:
                    await response.write(_sse("access-ended", {}))
                    await response.write_eof()
                    break
                if not await session_alive():
                    break

            try:
                message = await asyncio.wait_for(queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                if time.monotonic() >= keepalive_at:
                    # A comment line every 15 seconds keeps the stream alive
                    # and detects disconnects by the next keep-alive write.
                    await response.write(b": keep-alive\n\n")
                    keepalive_at = time.monotonic() + KEEPALIVE_SECONDS
                continue
            if role == "owner":
                await response.write(_owner_event(message))
            else:
                # A revoke pushes exactly one access-ended, then the stream closes.
                if message.get("_access_ended"):
                    await response.write(_sse("access-ended", {}))
                    await response.write_eof()
                    break
                await response.write(_contact_event(message))
    except (asyncio.CancelledError, ConnectionResetError, ConnectionError):
        pass
    finally:
        if vault_id:
            hub.unsubscribe(vault_id, queue)
    return response

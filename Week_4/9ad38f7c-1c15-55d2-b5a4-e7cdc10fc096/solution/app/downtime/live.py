"""Live events through PostgreSQL: NOTIFY inside the writing transaction, one LISTEN connection per instance,
fanned out to every open /api/stream. Streams close when the database is lost."""

import asyncio
import json
import logging
from collections.abc import AsyncIterator

import asyncpg
from starlette.responses import StreamingResponse

from .config import SETTINGS
from .db import CONNECT_TIMEOUT, DB, DRIVER_ERRORS, Unavailable
from .errors import NO_STORE

log = logging.getLogger("downtime.live")

CHANNEL = "downtime_events"
HEARTBEAT_SECONDS = 10
PROBE_SECONDS = 1.5
RECONNECT_SECONDS = 0.5


async def publish_score(conn: asyncpg.Connection, team_id: int, team_name: str, scenario_slug: str,
                        points: int, team_score: int) -> None:
    await _notify(conn, "score", {"team_id": team_id, "team_name": team_name, "scenario_slug": scenario_slug,
                                  "points": points, "team_score": team_score})


async def publish_team(conn: asyncpg.Connection, team_id: int) -> None:
    await _notify(conn, "team", {"team_id": team_id})


async def _notify(conn: asyncpg.Connection, event: str, data: dict[str, object]) -> None:
    await conn.execute("SELECT pg_notify($1, $2)", CHANNEL, json.dumps({"event": event, "data": data}))


class Broadcaster:
    def __init__(self) -> None:
        self.listening = asyncio.Event()
        self.streams: set[asyncio.Queue[tuple[str, str] | None]] = set()

    async def run(self) -> None:
        """Keep one LISTEN connection open, reconnecting after every loss."""
        while True:
            if DB.ready:
                try:
                    await self._listen()
                except DRIVER_ERRORS as error:
                    log.warning("listener lost: %s", type(error).__name__)
                finally:
                    self.listening.clear()
                    for stream in self.streams:
                        stream.put_nowait(None)
            await asyncio.sleep(RECONNECT_SECONDS)

    async def _listen(self) -> None:
        conn = await asyncpg.connect(SETTINGS.database_url, timeout=CONNECT_TIMEOUT)
        try:
            lost = asyncio.Event()
            conn.add_termination_listener(lambda _: lost.set())
            await conn.add_listener(CHANNEL, self._deliver)
            self.listening.set()
            while not lost.is_set():
                try:
                    await asyncio.wait_for(lost.wait(), PROBE_SECONDS)
                except TimeoutError:
                    await conn.fetchval("SELECT 1", timeout=PROBE_SECONDS)
        finally:
            conn.terminate()

    def _deliver(self, _conn: object, _pid: int, _channel: str, payload: str) -> None:
        message = json.loads(payload)
        item = (message["event"], json.dumps(message["data"]))
        for stream in self.streams:
            stream.put_nowait(item)

    async def stream(self) -> StreamingResponse:
        try:
            await asyncio.wait_for(self.listening.wait(), CONNECT_TIMEOUT)
        except TimeoutError:
            raise Unavailable from None
        queue: asyncio.Queue[tuple[str, str] | None] = asyncio.Queue()
        self.streams.add(queue)
        return StreamingResponse(self._events(queue), media_type="text/event-stream",
                                 headers={**NO_STORE, "X-Accel-Buffering": "no"})

    async def _events(self, queue: asyncio.Queue[tuple[str, str] | None]) -> AsyncIterator[str]:
        try:
            yield "retry: 1000\n: connected\n\n"
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), HEARTBEAT_SECONDS)
                except TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                if item is None:
                    return
                event, data = item
                yield f"event: {event}\ndata: {data}\n\n"
        finally:
            self.streams.discard(queue)


LIVE = Broadcaster()

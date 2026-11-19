"""The live board feed: Postgres LISTEN/NOTIFY fanned out to every signed-in board as server-sent events."""

import asyncio
import json
import logging
import time

import asyncpg

from . import db
from .config import settings

COMMENT_SECONDS = 15
log = logging.getLogger("tailboard.events")
listeners: set[asyncio.Queue] = set()


def _deliver(_conn, _pid, _channel, payload: str) -> None:
    for queue in list(listeners):
        if not queue.full():
            queue.put_nowait(payload)


async def listen_forever() -> None:
    """Hold one LISTEN connection, reconnecting whenever it drops."""
    while True:
        try:
            conn = await asyncpg.connect(settings.database_url)
            await conn.add_listener(db.CHANNEL, _deliver)
            while not conn.is_closed():
                await asyncio.sleep(2)
                await conn.execute("SELECT 1")
        except (OSError, asyncpg.PostgresError, asyncpg.InterfaceError) as error:
            log.warning("live feed listener reconnecting (%s)", type(error).__name__)
            await asyncio.sleep(1)


async def stream(still_signed_in):
    """Yield SSE frames: one per change, and a comment line at least every 15 seconds."""
    queue: asyncio.Queue = asyncio.Queue(maxsize=500)
    listeners.add(queue)
    try:
        yield ": connected\n\n"
        last_comment = time.monotonic()
        while True:
            wait = COMMENT_SECONDS - (time.monotonic() - last_comment)
            try:
                payload = await asyncio.wait_for(queue.get(), timeout=max(0.1, wait))
            except TimeoutError:
                payload = None
            if time.monotonic() - last_comment >= COMMENT_SECONDS:
                if not await still_signed_in():
                    return
                yield ": keep-alive\n\n"
                last_comment = time.monotonic()
            if payload is None:
                continue
            message = json.loads(payload)
            yield f"event: {message['event']}\ndata: {json.dumps(message['data'], separators=(',', ':'))}\n\n"
    finally:
        listeners.discard(queue)

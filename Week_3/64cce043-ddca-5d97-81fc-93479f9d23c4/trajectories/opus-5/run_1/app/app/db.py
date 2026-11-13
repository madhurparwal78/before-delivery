"""Postgres: the system of record, the clock and the change channel."""
from __future__ import annotations

import asyncio
import json
import logging
import secrets
from datetime import datetime
from pathlib import Path
from typing import Any, Awaitable, Callable

import asyncpg

from .config import APPLICATION_NAME, EVENT_CHANNEL, POOL_SIZE, Settings

log = logging.getLogger("strongroom.db")

SCHEMA_SQL = Path(__file__).with_name("schema.sql").read_text(encoding="utf-8")
SCHEMA_LOCK_KEY = 0x53_54_52_4F  # "STRO": one installer at a time


def new_id() -> str:
    return secrets.token_urlsafe(12)


class Database:
    """A fixed-size pool plus one listening connection, so the server's database
    session count never drifts with traffic or live streams."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._pool: asyncpg.Pool | None = None
        self._listener: asyncpg.Connection | None = None
        self._subscribers: dict[str, set[asyncio.Queue[dict[str, Any]]]] = {}
        self._ready = asyncio.Event()
        self._tasks: list[asyncio.Task[None]] = []

    @property
    def ready(self) -> bool:
        return self._ready.is_set()

    @property
    def pool(self) -> asyncpg.Pool:
        if self._pool is None:
            raise RuntimeError("database is not connected")
        return self._pool

    async def start(self, on_ready: Callable[[], Awaitable[None]] | None = None) -> None:
        """Connect, install the schema, then listen. Retries every 2 seconds."""
        while self._pool is None:
            try:
                self._pool = await asyncpg.create_pool(
                    self._settings.database_url,
                    min_size=POOL_SIZE,
                    max_size=POOL_SIZE,
                    server_settings={"application_name": APPLICATION_NAME},
                )
            except Exception as exc:  # the database may not be up yet
                log.warning("database unreachable (%s); retrying", exc)
                await asyncio.sleep(2)
        await self._install_schema()
        self._tasks.append(asyncio.create_task(self._listen_forever()))
        self._ready.set()
        if on_ready is not None:
            await on_ready()

    async def stop(self) -> None:
        for task in self._tasks:
            task.cancel()
        if self._listener is not None:
            await self._listener.close()
        if self._pool is not None:
            await self._pool.close()

    async def _install_schema(self) -> None:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                await connection.execute("select pg_advisory_xact_lock($1)", SCHEMA_LOCK_KEY)
                await connection.execute(SCHEMA_SQL)
                from .seed import apply_seed

                await apply_seed(connection, self._settings)

    # -- queries -------------------------------------------------------------

    async def fetch(self, query: str, *args: Any) -> list[asyncpg.Record]:
        async with self.pool.acquire() as connection:
            return await connection.fetch(query, *args)

    async def fetchrow(self, query: str, *args: Any) -> asyncpg.Record | None:
        async with self.pool.acquire() as connection:
            return await connection.fetchrow(query, *args)

    async def fetchval(self, query: str, *args: Any) -> Any:
        async with self.pool.acquire() as connection:
            return await connection.fetchval(query, *args)

    async def execute(self, query: str, *args: Any) -> str:
        async with self.pool.acquire() as connection:
            return await connection.execute(query, *args)

    async def now(self) -> datetime:
        return await self.fetchval("select now()")

    def transaction(self) -> "_TransactionContext":
        return _TransactionContext(self.pool)

    # -- change events -------------------------------------------------------

    async def notify(self, connection: asyncpg.Connection, vault_id: str, type_: str, id_: str) -> None:
        """Send one change notification inside the caller's transaction."""
        payload = json.dumps({"vault_id": vault_id, "type": type_, "id": id_})
        await connection.execute("select pg_notify($1, $2)", EVENT_CHANNEL, payload)

    def subscribe(self, vault_id: str) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._subscribers.setdefault(vault_id, set()).add(queue)
        return queue

    def unsubscribe(self, vault_id: str, queue: asyncio.Queue[dict[str, Any]]) -> None:
        listeners = self._subscribers.get(vault_id)
        if listeners is None:
            return
        listeners.discard(queue)
        if not listeners:
            self._subscribers.pop(vault_id, None)

    def _dispatch(self, payload: str) -> None:
        event = json.loads(payload)
        for queue in self._subscribers.get(event["vault_id"], set()):
            queue.put_nowait(event)

    async def _listen_forever(self) -> None:
        while True:
            try:
                self._listener = await asyncpg.connect(
                    self._settings.database_url,
                    server_settings={"application_name": APPLICATION_NAME},
                )
                await self._listener.add_listener(
                    EVENT_CHANNEL, lambda _c, _p, _ch, payload: self._dispatch(payload)
                )
                while not self._listener.is_closed():
                    await asyncio.sleep(1)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.warning("change listener dropped (%s); reconnecting", exc)
                await asyncio.sleep(2)


class _TransactionContext:
    """`async with db.transaction() as connection:` — one pooled connection, one transaction."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool
        self._connection: asyncpg.Connection | None = None
        self._transaction: Any = None

    async def __aenter__(self) -> asyncpg.Connection:
        self._connection = await self._pool.acquire()
        self._transaction = self._connection.transaction()
        await self._transaction.start()
        return self._connection

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        assert self._connection is not None
        try:
            if exc_type is None:
                await self._transaction.commit()
            else:
                await self._transaction.rollback()
        finally:
            await self._pool.release(self._connection)

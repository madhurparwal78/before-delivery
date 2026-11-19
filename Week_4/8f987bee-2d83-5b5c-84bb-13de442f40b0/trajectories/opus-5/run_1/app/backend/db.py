"""The PostgreSQL pool, its readiness loop and the service_unavailable boundary."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

import asyncpg

from .config import settings
from .errors import ApiError

log = logging.getLogger("wayline.db")

RETRY_SECONDS = 5.0

_UNREACHABLE = (
    asyncpg.PostgresConnectionError,
    asyncpg.InterfaceError,
    asyncpg.CannotConnectNowError,
    ConnectionError,
    OSError,
    asyncio.TimeoutError,
)


class Database:
    """Holds the pool and reports whether the app is ready to answer."""

    def __init__(self) -> None:
        self._pool: asyncpg.Pool | None = None
        self._ready = False
        self._task: asyncio.Task[None] | None = None
        self._wake = asyncio.Event()
        self._prepare: Callable[[asyncpg.Pool], Awaitable[None]] | None = None

    @property
    def ready(self) -> bool:
        return self._ready

    def start(self, prepare: Callable[[asyncpg.Pool], Awaitable[None]]) -> None:
        self._prepare = prepare
        self._task = asyncio.create_task(self._readiness_loop(), name="wayline-readiness")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        if self._pool is not None:
            await self._pool.close()
            self._pool = None
        self._ready = False

    async def wait_ready(self, timeout: float) -> bool:
        deadline = asyncio.get_running_loop().time() + timeout
        while not self._ready:
            if asyncio.get_running_loop().time() >= deadline:
                return False
            await asyncio.sleep(0.05)
        return True

    def _lost(self) -> None:
        self._ready = False
        self._wake.set()

    async def _readiness_loop(self) -> None:
        assert self._prepare is not None
        while True:
            if not self._ready:
                try:
                    if self._pool is not None:
                        await self._pool.close()
                        self._pool = None
                    self._pool = await asyncpg.create_pool(
                        dsn=settings.database_url,
                        min_size=1,
                        max_size=16,
                        command_timeout=60,
                        init=_init_connection,
                    )
                    await self._prepare(self._pool)
                    self._ready = True
                    log.info(json.dumps({"event": "database_ready"}))
                except Exception as exc:  # the database is not reachable or not prepared yet
                    log.warning(json.dumps({"event": "database_unavailable", "detail": type(exc).__name__}))
                    if self._pool is not None:
                        with contextlib.suppress(Exception):
                            await self._pool.close()
                        self._pool = None
            self._wake.clear()
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(self._wake.wait(), timeout=RETRY_SECONDS)

    @contextlib.asynccontextmanager
    async def acquire(self) -> AsyncIterator[asyncpg.Connection]:
        if not self._ready or self._pool is None:
            raise ApiError("service_unavailable")
        try:
            async with self._pool.acquire() as conn:
                yield conn
        except _UNREACHABLE as exc:
            self._lost()
            raise ApiError("service_unavailable") from exc

    @contextlib.asynccontextmanager
    async def transaction(self, *, isolation: str = "read_committed") -> AsyncIterator[asyncpg.Connection]:
        async with self.acquire() as conn:
            try:
                async with conn.transaction(isolation=isolation):
                    yield conn
            except _UNREACHABLE as exc:
                self._lost()
                raise ApiError("service_unavailable") from exc

    async def fetch(self, query: str, *args: Any) -> list[asyncpg.Record]:
        async with self.acquire() as conn:
            return await conn.fetch(query, *args)

    async def fetchrow(self, query: str, *args: Any) -> asyncpg.Record | None:
        async with self.acquire() as conn:
            return await conn.fetchrow(query, *args)

    async def fetchval(self, query: str, *args: Any) -> Any:
        async with self.acquire() as conn:
            return await conn.fetchval(query, *args)

    async def execute(self, query: str, *args: Any) -> str:
        async with self.acquire() as conn:
            return await conn.execute(query, *args)


async def _init_connection(conn: asyncpg.Connection) -> None:
    await conn.set_type_codec(
        "jsonb",
        encoder=json.dumps,
        decoder=json.loads,
        schema="pg_catalog",
    )


database = Database()

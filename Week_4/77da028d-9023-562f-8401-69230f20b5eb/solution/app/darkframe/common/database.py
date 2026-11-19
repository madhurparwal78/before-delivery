"""A lazily connected asyncpg pool that migrates once and recovers when PostgreSQL returns."""
import asyncio
import json
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

import asyncpg

from darkframe.rules.errors import ApiFault, service_unavailable

CONNECTION_ERRORS = (asyncpg.PostgresConnectionError, asyncpg.InterfaceError, OSError, TimeoutError,
                     asyncpg.CannotConnectNowError)
CONNECT_TIMEOUT = 3
RETRY_SECONDS = 2


async def _prepare(connection: asyncpg.Connection) -> None:
    for kind in ("json", "jsonb"):
        await connection.set_type_codec(kind, encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


class Database:
    def __init__(self, url: str, service_label: str, migrate: Callable[[asyncpg.Connection], Awaitable[None]],
                 schema: str) -> None:
        self._url = url
        self._label = service_label
        self._migrate = migrate
        self._schema = schema
        self._pool: asyncpg.Pool | None = None
        self._lock = asyncio.Lock()

    async def _ensure(self) -> asyncpg.Pool:
        async with self._lock:
            if self._pool is None:
                pool = await asyncpg.create_pool(self._url, min_size=1, max_size=8, timeout=CONNECT_TIMEOUT,
                                                 command_timeout=20, init=_prepare)
                async with pool.acquire() as connection:
                    await connection.execute("SELECT pg_advisory_lock(hashtext($1))", self._schema)
                    try:
                        await self._migrate(connection)
                    finally:
                        await connection.execute("SELECT pg_advisory_unlock(hashtext($1))", self._schema)
                self._pool = pool
            return self._pool

    async def _reset(self) -> None:
        async with self._lock:
            pool, self._pool = self._pool, None
        if pool is not None:
            pool.terminate()

    async def keep_ready(self) -> None:
        """Background task: connect and migrate as soon as PostgreSQL answers, then stay out of the way."""
        while True:
            try:
                await self._ensure()
                return
            except CONNECTION_ERRORS:
                await asyncio.sleep(RETRY_SECONDS)

    @asynccontextmanager
    async def connection(self) -> AsyncIterator[asyncpg.Connection]:
        try:
            pool = await self._ensure()
            async with pool.acquire(timeout=CONNECT_TIMEOUT) as connection:
                yield connection
        except CONNECTION_ERRORS as error:
            await self._reset()
            raise service_unavailable(self._label) from error

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[asyncpg.Connection]:
        async with self.connection() as connection:
            async with connection.transaction():
                yield connection

    async def ping(self) -> bool:
        try:
            async with self.connection() as connection:
                await connection.fetchval("SELECT 1")
            return True
        except ApiFault:
            return False

    async def close(self) -> None:
        await self._reset()

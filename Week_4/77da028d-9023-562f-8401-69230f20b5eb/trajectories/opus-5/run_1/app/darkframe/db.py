"""PostgreSQL access. Each service opens its own pool and owns one schema."""

from __future__ import annotations

import asyncio
from typing import Any, Sequence

import asyncpg

from .config import CONFIG, SCHEMAS


class Database:
    """A lazily connected pool that survives PostgreSQL being down at boot."""

    def __init__(self, service: str, schema_sql: str) -> None:
        self.schema = SCHEMAS[service]
        self._schema_sql = schema_sql
        self._pool: asyncpg.Pool | None = None
        self._lock = asyncio.Lock()
        self._prepared = False

    async def pool(self) -> asyncpg.Pool:
        async with self._lock:
            if self._pool is None:
                self._pool = await asyncpg.create_pool(
                    CONFIG.database_url,
                    min_size=1,
                    max_size=8,
                    command_timeout=10,
                )
            if not self._prepared:
                async with self._pool.acquire() as connection:
                    await connection.execute(self._schema_sql)
                self._prepared = True
            return self._pool

    async def healthy(self) -> bool:
        try:
            pool = await asyncio.wait_for(self.pool(), 1.0)
            async with pool.acquire() as connection:
                await asyncio.wait_for(connection.execute("select 1"), 1.0)
            return True
        except (OSError, asyncio.TimeoutError, asyncpg.PostgresError):
            await self.forget()
            return False

    async def forget(self) -> None:
        async with self._lock:
            pool, self._pool, self._prepared = self._pool, None, False
        if pool is not None:
            await pool.close()

    async def fetch(self, sql: str, *args: Any) -> list[asyncpg.Record]:
        pool = await self.pool()
        async with pool.acquire() as connection:
            return list(await connection.fetch(sql, *args))

    async def fetchrow(self, sql: str, *args: Any) -> asyncpg.Record | None:
        pool = await self.pool()
        async with pool.acquire() as connection:
            return await connection.fetchrow(sql, *args)

    async def fetchval(self, sql: str, *args: Any) -> Any:
        pool = await self.pool()
        async with pool.acquire() as connection:
            return await connection.fetchval(sql, *args)

    async def execute(self, sql: str, *args: Any) -> str:
        pool = await self.pool()
        async with pool.acquire() as connection:
            return await connection.execute(sql, *args)

    async def executemany(self, sql: str, rows: Sequence[Sequence[Any]]) -> None:
        pool = await self.pool()
        async with pool.acquire() as connection:
            await connection.executemany(sql, rows)

    def transaction(self) -> "_Transaction":
        return _Transaction(self)


class _Transaction:
    def __init__(self, database: Database) -> None:
        self._database = database
        self._acquired: Any = None
        self._transaction: Any = None

    async def __aenter__(self) -> asyncpg.Connection:
        pool = await self._database.pool()
        self._acquired = pool.acquire()
        connection = await self._acquired.__aenter__()
        self._transaction = connection.transaction()
        await self._transaction.__aenter__()
        return connection

    async def __aexit__(self, *exc: Any) -> None:
        await self._transaction.__aexit__(*exc)
        await self._acquired.__aexit__(*exc)

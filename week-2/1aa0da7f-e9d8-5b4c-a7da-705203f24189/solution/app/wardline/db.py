"""The PostgreSQL pool and transactions."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import asyncpg

from wardline.config import CONFIG

SCHEMA = Path(__file__).with_name("schema.sql")
SCHEMA_LOCK = 7_204_101
SEED_LOCK = 7_204_102
LEDGER_LOCK = 7_204_103


class Database:
    def __init__(self) -> None:
        self.pool: asyncpg.Pool | None = None

    async def connect(self) -> None:
        self.pool = await asyncpg.create_pool(
            CONFIG.database_url,
            min_size=1,
            max_size=12,
            max_inactive_connection_lifetime=30,
            timeout=5,
            command_timeout=30,
            init=_init_connection,
        )

    @asynccontextmanager
    async def connection(self) -> AsyncIterator[asyncpg.Connection]:
        async with self.pool.acquire(timeout=10) as conn:
            yield conn

    @asynccontextmanager
    async def tx(self) -> AsyncIterator[asyncpg.Connection]:
        async with self.connection() as conn, conn.transaction():
            yield conn

    async def apply_schema(self) -> None:
        async with self.connection() as conn:
            await conn.execute("SELECT pg_advisory_lock($1)", SCHEMA_LOCK)
            try:
                await conn.execute(SCHEMA.read_text())
            finally:
                await conn.execute("SELECT pg_advisory_unlock($1)", SCHEMA_LOCK)


async def _init_connection(conn: asyncpg.Connection) -> None:
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


async def next_id(conn: asyncpg.Connection, prefix: str, sequence: str, width: int = 4) -> str:
    return f"{prefix}-{await conn.fetchval('SELECT nextval($1::regclass)', sequence):0{width}d}"


DB = Database()

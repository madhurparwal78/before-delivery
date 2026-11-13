"""Connection pool and schema."""

import json
from pathlib import Path

import asyncpg

from .config import Settings

SCHEMA = Path(__file__).with_name("schema.sql")
SCHEMA_LOCK = 4172001
POOL_SIZE = 16

pool: asyncpg.Pool | None = None


async def _prepare(conn: asyncpg.Connection) -> None:
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


async def open_pool(settings: Settings) -> asyncpg.Pool:
    global pool
    pool = await asyncpg.create_pool(settings.database_url, min_size=2, max_size=POOL_SIZE, init=_prepare)
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock($1)", SCHEMA_LOCK)
            await conn.execute(SCHEMA.read_text())
    return pool


async def close_pool() -> None:
    if pool is not None:
        await pool.close()

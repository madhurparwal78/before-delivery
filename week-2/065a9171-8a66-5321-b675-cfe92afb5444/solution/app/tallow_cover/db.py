"""The Postgres pool, the schema and the first-run seed (applied under an advisory lock on every serve)."""

import json
from pathlib import Path

import asyncpg

from .config import settings
from .seed import seed

SCHEMA = Path(__file__).with_name("schema.sql")
SETUP_LOCK = 7_301_113  # any constant shared by every instance of this app

pool: asyncpg.Pool


async def _codecs(conn: asyncpg.Connection) -> None:
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


async def connect() -> None:
    global pool
    pool = await asyncpg.create_pool(settings.database_url, min_size=2, max_size=20, init=_codecs)
    async with pool.acquire() as conn:
        await conn.execute("SELECT pg_advisory_lock($1)", SETUP_LOCK)
        try:
            await conn.execute(SCHEMA.read_text())
            if not await conn.fetchval("SELECT EXISTS (SELECT 1 FROM homes)"):
                async with conn.transaction():
                    await seed(conn)
        finally:
            await conn.execute("SELECT pg_advisory_unlock($1)", SETUP_LOCK)


async def close() -> None:
    await pool.close()

"""Postgres access: the pool, schema migration, ids, audit entries and change notifications."""

import asyncio
import json
import secrets
from decimal import Decimal
from pathlib import Path

import asyncpg

from . import clock
from .config import settings

SCHEMA = Path(__file__).with_name("schema.sql")
CHANNEL = "tailboard"
MIGRATION_LOCK = 7_310_142

pool: asyncpg.Pool | None = None


def _json_default(value):
    if isinstance(value, Decimal):
        return float(value)
    raise TypeError(f"not JSON serialisable: {type(value).__name__}")


def dumps(value) -> str:
    return json.dumps(value, default=_json_default, ensure_ascii=False, separators=(",", ":"))


async def _init(conn: asyncpg.Connection) -> None:
    await conn.set_type_codec("jsonb", encoder=dumps, decoder=json.loads, schema="pg_catalog")


async def connect() -> asyncpg.Pool:
    """Open the pool, retrying while Postgres is still starting."""
    global pool
    attempts = 60
    while pool is None:
        try:
            pool = await asyncpg.create_pool(settings.database_url, min_size=2, max_size=20, init=_init,
                                             command_timeout=30)
        except (OSError, asyncpg.PostgresError):
            attempts -= 1
            if not attempts:
                raise
            await asyncio.sleep(1)
    return pool


async def migrate(seed) -> None:
    """Apply the schema and the seed data in one transaction, serialised across processes."""
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT pg_advisory_xact_lock($1)", MIGRATION_LOCK)
        await conn.execute(SCHEMA.read_text())
        await seed(conn)


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


async def audit(conn, actor_id: str | None, action: str, detail: str, directive_id: str | None = None,
                thread_id: str | None = None) -> None:
    await conn.execute(
        "INSERT INTO audit (id, at, actor_id, action, directive_id, thread_id, detail) "
        "VALUES ($1, $2, $3, $4, $5, $6, $7)",
        new_id("aud"), clock.now(), actor_id, action, directive_id, thread_id, detail)


async def publish(conn, event: str, data: dict) -> None:
    """Queue a live-feed event; Postgres delivers it to every app process when the transaction commits."""
    await conn.execute("SELECT pg_notify($1, $2)", CHANNEL, dumps({"event": event, "data": data}))


async def changed_threads(conn, thread_ids: list[str]) -> None:
    """Announce changed threads, in chunks that fit a notification payload."""
    ids = sorted(set(thread_ids))
    for start in range(0, len(ids), 150):
        await publish(conn, "threads", {"thread_ids": ids[start:start + 150]})

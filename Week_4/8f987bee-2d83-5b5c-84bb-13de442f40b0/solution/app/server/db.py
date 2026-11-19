"""The PostgreSQL pool, readiness, and the two transaction shapes the server uses."""

import asyncio
import json
import secrets
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import asyncpg

from .config import settings

UNAVAILABLE = (OSError, ConnectionError, asyncio.TimeoutError, asyncpg.PostgresConnectionError,
               asyncpg.InterfaceError, asyncpg.CannotConnectNowError, asyncpg.exceptions.OperatorInterventionError)
RETRY_SECONDS = 2
SCHEMA = (Path(__file__).parent / "schema.sql").read_text()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(moment: datetime | None) -> str | None:
    """Every timestamp leaves the server as ISO 8601 in UTC ending in Z."""
    if moment is None:
        return None
    return moment.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


async def _codecs(conn: asyncpg.Connection) -> None:
    for kind in ("json", "jsonb"):
        await conn.set_type_codec(kind, encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


class Database:
    def __init__(self) -> None:
        self.pool: asyncpg.Pool | None = None
        self.ready = False
        self.keys: dict[str, bytes] = {}

    async def start(self, prepare) -> None:
        """Connect, migrate, seed and recover; retried every few seconds until the database answers."""
        while True:
            try:
                if self.pool is None:
                    self.pool = await asyncpg.create_pool(settings.database_url, min_size=1, max_size=30,
                                                          init=_codecs, timeout=5)
                async with self.pool.acquire() as conn:
                    async with conn.transaction():
                        await conn.execute("SELECT pg_advisory_xact_lock(7417001)")
                        await conn.execute(SCHEMA)
                        self.keys = await _load_keys(conn)
                await prepare(self)
                self.ready = True
                return
            except UNAVAILABLE:
                await asyncio.sleep(RETRY_SECONDS)

    async def alive(self) -> bool:
        if not self.ready or self.pool is None:
            return False
        try:
            async with self.pool.acquire(timeout=3) as conn:
                await conn.fetchval("SELECT 1", timeout=3)
            return True
        except UNAVAILABLE:
            return False

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[asyncpg.Connection]:
        assert self.pool is not None
        async with self.pool.acquire(timeout=10) as conn:
            async with conn.transaction():
                yield conn

    @asynccontextmanager
    async def snapshot(self) -> AsyncIterator[asyncpg.Connection]:
        """One consistent view of the stored data for a whole read."""
        assert self.pool is not None
        async with self.pool.acquire(timeout=10) as conn:
            async with conn.transaction(isolation="repeatable_read", readonly=True):
                yield conn


async def _load_keys(conn: asyncpg.Connection) -> dict[str, bytes]:
    for name in ("cursor", "seal"):
        await conn.execute("INSERT INTO app_secrets (name, value) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING",
                           name, secrets.token_bytes(32))
    return {row["name"]: bytes(row["value"]) for row in await conn.fetch("SELECT name, value FROM app_secrets")}


db = Database()

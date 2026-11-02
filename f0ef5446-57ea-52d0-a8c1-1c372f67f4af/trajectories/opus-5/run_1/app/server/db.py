"""PostgreSQL access: the pool, the schema and the shared unavailability rule."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import asyncpg

from .config import CONFIG

SCHEMA_STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS partner_applications (
        id serial PRIMARY KEY,
        first_name text NOT NULL,
        last_name text NOT NULL,
        work_email text NOT NULL,
        job_title text NOT NULL,
        company_name text NOT NULL,
        website text NOT NULL,
        company_type text NOT NULL,
        employee_band text NOT NULL,
        markets jsonb NOT NULL,
        customer_segment text NOT NULL,
        partnership_interests jsonb NOT NULL,
        goals text NOT NULL,
        consent boolean NOT NULL DEFAULT true,
        status text NOT NULL DEFAULT 'pending',
        reviewer text,
        decision_note text,
        created_at timestamptz NOT NULL DEFAULT now(),
        decided_at timestamptz
    )
    """,
    """
    CREATE UNIQUE INDEX IF NOT EXISTS partner_applications_work_email_unique
        ON partner_applications (work_email)
    """,
    """
    CREATE TABLE IF NOT EXISTS outbound_emails (
        id serial PRIMARY KEY,
        application_id integer NOT NULL REFERENCES partner_applications (id),
        kind text NOT NULL,
        recipient text NOT NULL,
        subject text NOT NULL,
        body text NOT NULL,
        status text NOT NULL DEFAULT 'queued',
        attempts integer NOT NULL DEFAULT 0,
        last_attempt_at timestamptz,
        next_attempt_at timestamptz NOT NULL DEFAULT now(),
        sent_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (application_id, kind)
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS outbound_emails_due
        ON outbound_emails (status, next_attempt_at)
    """,
    """
    CREATE TABLE IF NOT EXISTS sign_in_failures (
        id serial PRIMARY KEY,
        email_key text NOT NULL,
        failed_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS sign_in_failures_key
        ON sign_in_failures (email_key, failed_at)
    """,
    """
    CREATE TABLE IF NOT EXISTS idempotency_records (
        id serial PRIMARY KEY,
        idempotency_key text NOT NULL UNIQUE,
        body_fingerprint text NOT NULL,
        state text NOT NULL,
        response_status integer,
        response_body text,
        first_used_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS dead_tokens (
        id serial PRIMARY KEY,
        token_id text NOT NULL UNIQUE,
        noticed_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS integrations (
        id serial PRIMARY KEY,
        slug text NOT NULL UNIQUE,
        name text NOT NULL,
        description text NOT NULL,
        category text NOT NULL,
        icon_ref text NOT NULL,
        published boolean NOT NULL DEFAULT true
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS articles (
        id serial PRIMARY KEY,
        slug text NOT NULL UNIQUE,
        title text NOT NULL,
        category text NOT NULL,
        summary text NOT NULL,
        author text NOT NULL,
        read_time integer NOT NULL,
        cover_ref text NOT NULL,
        body text NOT NULL,
        published_at timestamptz NOT NULL,
        published boolean NOT NULL DEFAULT true
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS press_items (
        id serial PRIMARY KEY,
        date date NOT NULL,
        category text NOT NULL,
        headline text NOT NULL,
        link text NOT NULL,
        published boolean NOT NULL DEFAULT true
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS jobs (
        id serial PRIMARY KEY,
        title text NOT NULL,
        location text NOT NULL,
        is_open boolean NOT NULL DEFAULT true
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS resource_cards (
        id serial PRIMARY KEY,
        block text NOT NULL,
        category text NOT NULL,
        title text NOT NULL,
        date date NOT NULL,
        summary text NOT NULL,
        target_link text NOT NULL,
        published boolean NOT NULL DEFAULT true
    )
    """,
)

class DatabaseUnavailable(Exception):
    """PostgreSQL could not be reached."""


_UNAVAILABLE = (
    asyncpg.PostgresConnectionError,
    asyncpg.InterfaceError,
    asyncpg.exceptions.CannotConnectNowError,
    asyncpg.exceptions.TooManyConnectionsError,
    OSError,
    asyncio.TimeoutError,
)


class Database:
    """Owns the connection pool and turns connection trouble into one error."""

    def __init__(self) -> None:
        self._pool: asyncpg.Pool | None = None

    async def connect(self) -> None:
        if self._pool is not None:
            return
        self._pool = await asyncpg.create_pool(
            dsn=CONFIG.database_url,
            min_size=1,
            max_size=16,
            timeout=10,
            command_timeout=20,
            init=_init_connection,
        )

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    async def create_schema(self) -> None:
        async with self.acquire() as connection:
            for statement in SCHEMA_STATEMENTS:
                await connection.execute(statement)

    def acquire(self) -> "_PoolAcquire":
        return _PoolAcquire(self)

    @property
    def pool(self) -> asyncpg.Pool:
        if self._pool is None:
            raise DatabaseUnavailable("no connection pool")
        return self._pool

    async def fetch(self, query: str, *args: Any) -> list[asyncpg.Record]:
        async with self.acquire() as connection:
            return await connection.fetch(query, *args)

    async def fetchrow(self, query: str, *args: Any) -> asyncpg.Record | None:
        async with self.acquire() as connection:
            return await connection.fetchrow(query, *args)

    async def fetchval(self, query: str, *args: Any) -> Any:
        async with self.acquire() as connection:
            return await connection.fetchval(query, *args)

    async def execute(self, query: str, *args: Any) -> str:
        async with self.acquire() as connection:
            return await connection.execute(query, *args)


class _PoolAcquire:
    """An acquired connection whose connection trouble reads as unavailability."""

    def __init__(self, database: Database) -> None:
        self._database = database
        self._context: Any = None

    async def __aenter__(self) -> asyncpg.Connection:
        try:
            self._context = self._database.pool.acquire()
            return await self._context.__aenter__()
        except _UNAVAILABLE as exc:
            raise DatabaseUnavailable(str(exc)) from exc

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> bool:
        try:
            result = await self._context.__aexit__(exc_type, exc, tb)
        except _UNAVAILABLE as close_exc:
            raise DatabaseUnavailable(str(close_exc)) from close_exc
        if exc_type is not None and issubclass(exc_type, _UNAVAILABLE):
            raise DatabaseUnavailable(str(exc)) from exc
        return bool(result)


async def _init_connection(connection: asyncpg.Connection) -> None:
    await connection.set_type_codec(
        "jsonb",
        encoder=json.dumps,
        decoder=json.loads,
        schema="pg_catalog",
    )


DATABASE = Database()

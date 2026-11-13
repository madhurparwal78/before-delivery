"""Postgres access: pool, schema, and the database clock."""

from __future__ import annotations

import json
import logging
from typing import Any, Awaitable, Callable, Optional, TypeVar

import asyncpg

from ..config import Config, dsn_parts  # type: ignore[attr-defined]

log = logging.getLogger("strongroom.db")

NOTIFY_CHANNEL = "strongroom_events"

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS vaults (
    id          text PRIMARY KEY,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
    id           text PRIMARY KEY,
    realm_sub    text UNIQUE,
    email        text NOT NULL,
    name         text NOT NULL,
    vault_id     text,
    kind         text NOT NULL DEFAULT 'owner',
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
    id             text PRIMARY KEY,
    account_id     text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at     timestamptz NOT NULL DEFAULT now(),
    last_activity  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pending_signins (
    id           text PRIMARY KEY,
    state        text NOT NULL UNIQUE,
    nonce        text NOT NULL,
    verifier     text NOT NULL,
    return_path  text,
    expires_at   timestamptz NOT NULL,
    consumed     boolean NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rules (
    id                text PRIMARY KEY,
    vault_id          text NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    priority          int NOT NULL,
    data_kind         text NOT NULL,
    company_contains  text NOT NULL DEFAULT '',
    level             text NOT NULL,
    version           int NOT NULL DEFAULT 1,
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (vault_id, priority)
);

CREATE TABLE IF NOT EXISTS holdings (
    id          text PRIMARY KEY,
    vault_id    text NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    company     text NOT NULL,
    company_key text NOT NULL,
    data_kind   text NOT NULL,
    value       text NOT NULL,
    notes       text NOT NULL DEFAULT '',
    level       text NOT NULL,
    rule_id     text,
    version     int NOT NULL DEFAULT 1,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (vault_id, company_key, data_kind)
);

CREATE TABLE IF NOT EXISTS breaches (
    id            text PRIMARY KEY,
    vault_id      text NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    company       text NOT NULL,
    company_key   text NOT NULL,
    announced_on  date NOT NULL,
    version       int NOT NULL DEFAULT 1,
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (vault_id, company_key, announced_on)
);

CREATE TABLE IF NOT EXISTS breach_kinds (
    breach_id  text NOT NULL REFERENCES breaches(id) ON DELETE CASCADE,
    data_kind  text NOT NULL,
    PRIMARY KEY (breach_id, data_kind)
);

CREATE TABLE IF NOT EXISTS done_steps (
    id          text PRIMARY KEY,
    vault_id    text NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    holding_id  text NOT NULL,
    step_key    text NOT NULL,
    number      int NOT NULL,
    done        boolean NOT NULL DEFAULT false,
    UNIQUE (vault_id, step_key, number)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
    vault_id     text NOT NULL,
    key          text NOT NULL,
    request_hash text NOT NULL,
    status       int NOT NULL,
    response     jsonb NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (vault_id, key)
);

CREATE TABLE IF NOT EXISTS grants (
    id             text PRIMARY KEY,
    vault_id       text NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    status         text NOT NULL DEFAULT 'active',
    contact_name   text NOT NULL,
    contact_email  text NOT NULL,
    contact_sub    text,
    duration       text NOT NULL,
    levels         text[] NOT NULL,
    ends_at        timestamptz,
    revoked_at     timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS holdings_vault_idx ON holdings (vault_id, company_key, created_at);
CREATE INDEX IF NOT EXISTS rules_vault_idx ON rules (vault_id, priority);
CREATE INDEX IF NOT EXISTS breaches_vault_idx ON breaches (vault_id, announced_on DESC);
CREATE INDEX IF NOT EXISTS sessions_account_idx ON sessions (account_id);
CREATE INDEX IF NOT EXISTS grants_vault_idx ON grants (vault_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pending_expires_idx ON pending_signins (expires_at);
"""

T = TypeVar("T")


class Database:
    """The system of record. Every connection sets application_name to strongroom."""

    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        self._pool: Optional[asyncpg.Pool] = None
        self._dsn = cfg.database_url

    async def connect(self, timeout: float = 2.0) -> bool:
        try:
            pool = await self.create_pool()
            async with pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
            self._pool = pool
            return True
        except Exception as exc:  # pragma: no cover - startup path
            log.warning("database not reachable yet: %s", exc)
            if self._pool is not None:
                await self._pool.close()
                self._pool = None
            return False

    async def create_pool(self) -> asyncpg.Pool:
        host, port, user, password, database = dsn_parts(self._dsn)
        return await asyncpg.create_pool(
            host=host,
            port=port,
            user=user,
            password=password,
            database=database,
            server_settings={"application_name": "strongroom"},
            min_size=1,
            max_size=20,
            command_timeout=30.0,
        )

    async def create_pool_conn_for_listen(self) -> asyncpg.Connection:
        """A dedicated connection for LISTEN, released when the listener stops."""
        host, port, user, password, database = dsn_parts(self._dsn)
        return await asyncpg.connect(
            host=host,
            port=port,
            user=user,
            password=password,
            database=database,
            server_settings={"application_name": "strongroom"},
        )

    @property
    def pool(self) -> asyncpg.Pool:
        if self._pool is None:
            raise RuntimeError("database pool not started")
        return self._pool

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    async def execute(self, sql: str, *args: Any) -> str:
        async with self.pool.acquire() as conn:
            return await conn.execute(sql, *args)

    async def fetch(self, sql: str, *args: Any) -> list[asyncpg.Record]:
        async with self.pool.acquire() as conn:
            return await conn.fetch(sql, *args)

    async def fetchrow(self, sql: str, *args: Any) -> Optional[asyncpg.Record]:
        async with self.pool.acquire() as conn:
            return await conn.fetchrow(sql, *args)

    async def fetchval(self, sql: str, *args: Any) -> Any:
        async with self.pool.acquire() as conn:
            return await conn.fetchval(sql, *args)

    async def now(self) -> Any:
        return await self.fetchval("SELECT now()")

    async def run_in_transaction(self, fn: Callable[[asyncpg.Connection], Awaitable[T]]) -> T:
        """Run fn inside one transaction on one connection."""
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                return await fn(conn)


async def emit_notification(conn: asyncpg.Connection, vault_id: str, type_: str, record_id: str) -> None:
    """Send the id-only change notification on channel strongroom_events."""
    payload = json.dumps(
        {"vault_id": vault_id, "type": type_, "id": record_id},
        separators=(",", ":"),
    )
    await conn.execute("SELECT pg_notify($1, $2)", NOTIFY_CHANNEL, payload)


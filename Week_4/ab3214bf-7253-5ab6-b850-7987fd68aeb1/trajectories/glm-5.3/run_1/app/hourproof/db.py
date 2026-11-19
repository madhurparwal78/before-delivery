"""PostgreSQL access: an asyncpg pool and an idempotent schema, applied on serve.
"""
from __future__ import annotations

import asyncio
from typing import Any

import asyncpg

from . import config

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
    id text PRIMARY KEY,
    email text UNIQUE NOT NULL,
    name text NOT NULL,
    password_hash text NOT NULL,
    role text NOT NULL,
    firm_id text
);
CREATE TABLE IF NOT EXISTS sessions (
    token text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL,
    expires_at timestamptz
);
CREATE TABLE IF NOT EXISTS firms (
    id text PRIMARY KEY,
    name text NOT NULL,
    current_key_id text
);
CREATE TABLE IF NOT EXISTS firm_keys (
    key_id text PRIMARY KEY,
    firm_id text NOT NULL,
    private_key_pem text NOT NULL,
    public_key_b64 text NOT NULL,
    created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS sites (
    id text PRIMARY KEY,
    name text NOT NULL,
    code text NOT NULL,
    zone text NOT NULL,
    time_zone text NOT NULL,
    meter_id text NOT NULL,
    target_grain text NOT NULL,
    target_bp integer NOT NULL
);
CREATE TABLE IF NOT EXISTS windows (
    id text PRIMARY KEY,
    site_id text NOT NULL REFERENCES sites(id),
    month text NOT NULL,
    state text NOT NULL,
    revision integer NOT NULL DEFAULT 1,
    opens_at timestamptz NOT NULL,
    submitted_at timestamptz,
    review_deadline timestamptz,
    returned_reason text,
    verifier_firm_id text,
    seal_status text,
    statement_code text,
    allocation_digest text,
    last_writer_name text,
    wrote_at timestamptz,
    target_grain text,
    target_bp integer,
    frozen_target boolean NOT NULL DEFAULT false,
    predecessor_id text,
    successor_id text,
    base_window_id text NOT NULL,
    signatures_count integer NOT NULL DEFAULT 0,
    registry_reachable boolean,
    created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS hours (
    window_id text NOT NULL REFERENCES windows(id),
    hour_utc timestamptz NOT NULL,
    consumed_wh bigint,
    quality text NOT NULL,
    correction_version integer NOT NULL DEFAULT 0,
    substitution_reason text,
    grid_g_per_kwh text,
    PRIMARY KEY (window_id, hour_utc)
);
CREATE TABLE IF NOT EXISTS lots (
    id text PRIMARY KEY,
    window_id text NOT NULL REFERENCES windows(id),
    name text NOT NULL,
    technology text NOT NULL,
    zone text NOT NULL,
    rank integer NOT NULL,
    excluded boolean NOT NULL DEFAULT false,
    battery_shifted boolean NOT NULL DEFAULT false,
    production_month text NOT NULL,
    cancel_by timestamptz NOT NULL,
    created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS bundles (
    id text PRIMARY KEY,
    window_id text NOT NULL REFERENCES windows(id),
    lot_id text NOT NULL REFERENCES lots(id),
    bundle_id text NOT NULL,
    production_hour timestamptz,
    discharge_hour timestamptz,
    range_start_wh text NOT NULL,
    range_end_wh text NOT NULL,
    UNIQUE (window_id, bundle_id)
);
CREATE TABLE IF NOT EXISTS lines (
    line_id text PRIMARY KEY,
    window_id text NOT NULL REFERENCES windows(id),
    hour_utc timestamptz NOT NULL,
    lot_id text NOT NULL,
    bundle_id text NOT NULL,
    range_start_wh text NOT NULL,
    range_end_wh text NOT NULL,
    wh bigint NOT NULL,
    status text NOT NULL,
    reason text,
    created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS lines_window_idx ON lines (window_id, hour_utc);
CREATE TABLE IF NOT EXISTS sample_hours (
    window_id text NOT NULL REFERENCES windows(id),
    hour_utc timestamptz NOT NULL,
    draw_index integer NOT NULL,
    result text,
    note text,
    PRIMARY KEY (window_id, hour_utc)
);
CREATE TABLE IF NOT EXISTS ledger_entries (
    movement_id text NOT NULL,
    kind text NOT NULL,
    account text NOT NULL,
    wh bigint NOT NULL,
    window_id text,
    lot_id text,
    bundle_id text,
    line_id text,
    label text NOT NULL,
    at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_window_idx ON ledger_entries (window_id, at);
CREATE TABLE IF NOT EXISTS statements (
    code text PRIMARY KEY,
    window_id text NOT NULL REFERENCES windows(id),
    state text NOT NULL,
    signed_at timestamptz NOT NULL,
    key_id text NOT NULL,
    attestation_payload text NOT NULL,
    attestation_signature text NOT NULL,
    pdf_sha256 text,
    pdf_signature text,
    pdf_object_key text,
    successor_window_id text,
    successor_statement_code text
);
CREATE TABLE IF NOT EXISTS grid_factors (
    zone text NOT NULL,
    hour_utc timestamptz NOT NULL,
    g_per_kwh text NOT NULL,
    PRIMARY KEY (zone, hour_utc)
);
CREATE TABLE IF NOT EXISTS bundle_claims (
    bundle_id text PRIMARY KEY,
    window_id text NOT NULL,
    created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
    key text PRIMARY KEY,
    value text NOT NULL
);
"""

_POOL: asyncpg.Pool | None = None


async def wait_for_database(retries: int = 240, delay: float = 1.0) -> None:
    last: Exception | None = None
    for _ in range(retries):
        try:
            conn = await asyncpg.connect(config.DATABASE_URL, timeout=5)
            await conn.close()
            return
        except Exception as exc:  # noqa: BLE001
            last = exc
            await asyncio.sleep(delay)
    raise RuntimeError(f"PostgreSQL never became reachable: {last}")


async def start_pool(size: int = 10) -> asyncpg.Pool:
    global _POOL
    _POOL = await asyncpg.create_pool(config.DATABASE_URL, min_size=2, max_size=size,
                                      command_timeout=30)
    async with _POOL.acquire() as conn:
        await conn.execute(SCHEMA_SQL)
    return _POOL


async def close_pool() -> None:
    global _POOL
    if _POOL is not None:
        await _POOL.close()
        _POOL = None


def pool() -> asyncpg.Pool:
    if _POOL is None:
        raise RuntimeError("pool not started")
    return _POOL


async def fetch(conn: asyncpg.Connection, query: str, *args: Any) -> list[asyncpg.Record]:
    return list(await conn.fetch(query, *args))


async def one(conn: asyncpg.Connection, query: str, *args: Any) -> asyncpg.Record | None:
    return await conn.fetchrow(query, *args)


def record_to_dict(record: asyncpg.Record) -> dict[str, Any]:
    return dict(record)

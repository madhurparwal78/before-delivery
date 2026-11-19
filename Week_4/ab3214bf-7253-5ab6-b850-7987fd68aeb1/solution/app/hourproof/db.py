"""PostgreSQL: connection pool (waiting for the database at boot) and the idempotent schema."""

from __future__ import annotations

import asyncio

import asyncpg

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id text PRIMARY KEY, email text UNIQUE NOT NULL, name text NOT NULL, role text NOT NULL,
    firm_id text, password_hash text NOT NULL);
CREATE TABLE IF NOT EXISTS firms (id text PRIMARY KEY, name text NOT NULL);
CREATE TABLE IF NOT EXISTS firm_keys (
    seq bigserial PRIMARY KEY, key_id text UNIQUE NOT NULL, firm_id text NOT NULL, public_key text NOT NULL,
    private_key text NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY, user_id text NOT NULL);
CREATE TABLE IF NOT EXISTS sites (
    id text PRIMARY KEY, name text NOT NULL, code text NOT NULL, zone text NOT NULL, time_zone text NOT NULL,
    meter_id text NOT NULL, target_grain text NOT NULL, target_bp integer NOT NULL);
CREATE TABLE IF NOT EXISTS windows (
    id text PRIMARY KEY, site_id text NOT NULL, month text NOT NULL, base_id text NOT NULL, chain_index integer NOT NULL,
    state text NOT NULL, revision integer NOT NULL, last_writer_name text, last_wrote_at timestamptz,
    last_write_revision integer, firm_id text, returned_reason text, submitted_at timestamptz,
    predecessor_id text, successor_id text, statement_code text, seal_status text,
    frozen_grain text, frozen_bp integer, frozen_opinion text, sample_digest text, review_deadline timestamptz);
CREATE TABLE IF NOT EXISTS hours (
    window_id text NOT NULL, hour_utc timestamptz NOT NULL, consumed_wh bigint, quality text NOT NULL,
    version integer NOT NULL DEFAULT 0, reason text, PRIMARY KEY (window_id, hour_utc));
CREATE TABLE IF NOT EXISTS lots (
    window_id text NOT NULL, id text NOT NULL, name text NOT NULL, technology text NOT NULL, zone text NOT NULL,
    rank integer NOT NULL, excluded boolean NOT NULL DEFAULT false, battery_shifted boolean NOT NULL,
    production_month text NOT NULL, PRIMARY KEY (window_id, id));
CREATE TABLE IF NOT EXISTS bundles (
    window_id text NOT NULL, id text NOT NULL, lot_id text NOT NULL, production_hour timestamptz NOT NULL,
    discharge_hour timestamptz, battery_shifted boolean NOT NULL, range_start bigint NOT NULL,
    range_end bigint NOT NULL, loss_wh bigint NOT NULL DEFAULT 0, PRIMARY KEY (window_id, id));
CREATE TABLE IF NOT EXISTS lines (
    window_id text NOT NULL, id text NOT NULL, hour_utc timestamptz NOT NULL, lot_id text NOT NULL,
    bundle_id text NOT NULL, range_start bigint NOT NULL, range_end bigint NOT NULL, status text NOT NULL,
    reason text, PRIMARY KEY (window_id, id));
CREATE TABLE IF NOT EXISTS claims (bundle_id text PRIMARY KEY, base_id text NOT NULL, window_id text NOT NULL);
CREATE SEQUENCE IF NOT EXISTS movement_seq;
CREATE TABLE IF NOT EXISTS ledger_entries (
    seq bigserial PRIMARY KEY, movement_id text NOT NULL, kind text NOT NULL, account text NOT NULL, wh bigint NOT NULL,
    window_id text NOT NULL, lot_id text, bundle_id text, line_id text, label text NOT NULL, at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS ledger_by_window ON ledger_entries (window_id, seq);
CREATE TABLE IF NOT EXISTS samples (
    window_id text NOT NULL, hour_utc timestamptz NOT NULL, position integer NOT NULL, result text, note text,
    PRIMARY KEY (window_id, hour_utc));
CREATE TABLE IF NOT EXISTS grid_factors (
    zone text NOT NULL, hour_utc timestamptz NOT NULL, g_per_kwh_e4 bigint NOT NULL, PRIMARY KEY (zone, hour_utc));
CREATE TABLE IF NOT EXISTS statements (
    code text PRIMARY KEY, window_id text UNIQUE NOT NULL, site_id text NOT NULL, month text NOT NULL,
    firm_id text NOT NULL, attestation_payload text NOT NULL, attestation_signature text NOT NULL,
    key_id text NOT NULL, public_key text NOT NULL, pdf_sha256 text, pdf_signature text, signed_at timestamptz NOT NULL, sealed_at timestamptz);
CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text NOT NULL);
"""

CONNECT_RETRY_SECONDS = 2


async def connect(database_url: str) -> asyncpg.Pool:
    """Wait for PostgreSQL, retrying until it answers, then apply the schema."""
    while True:
        try:
            pool = await asyncpg.create_pool(database_url, min_size=2, max_size=16)
            break
        except (OSError, asyncpg.PostgresError):
            await asyncio.sleep(CONNECT_RETRY_SECONDS)
    async with pool.acquire() as connection:
        async with connection.transaction():
            await connection.execute("SELECT pg_advisory_xact_lock(7340001)")
            await connection.execute(SCHEMA)
    return pool

"""The one backing service: Postgres at DATABASE_URL.

The app creates its schema idempotently each time it starts and applies the
seed once per database, even with several workers starting together. A restart
never duplicates the seed, never restores a changed or removed record and never
resets the service clock.
"""

from __future__ import annotations

import os
import psycopg
import psycopg_pool
from psycopg.rows import dict_row

DATABASE_URL = os.environ["DATABASE_URL"]
SCHEMA = """
CREATE TABLE IF NOT EXISTS programme (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    default_locale TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS account (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    programme_id BIGINT NOT NULL REFERENCES programme(id)
);
CREATE TABLE IF NOT EXISTS reference_entry (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    programme_id BIGINT NOT NULL REFERENCES programme(id),
    slug TEXT NOT NULL,
    ordinal INTEGER,
    sector TEXT NOT NULL,
    customer TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    challenge TEXT NOT NULL,
    work TEXT NOT NULL,
    title_fi TEXT,
    body_fi TEXT,
    published BOOLEAN NOT NULL DEFAULT FALSE,
    retired_at TIMESTAMPTZ,
    version BIGINT NOT NULL DEFAULT 1,
    clearance_from DATE,
    clearance_until DATE,
    quote TEXT,
    quote_speaker TEXT,
    quote_role TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS reference_slug_live
    ON reference_entry (programme_id, slug);
CREATE TABLE IF NOT EXISTS figure (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    reference_id BIGINT NOT NULL REFERENCES reference_entry(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    value TEXT NOT NULL,
    position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS note (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    programme_id BIGINT NOT NULL REFERENCES programme(id),
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    preview TEXT NOT NULL,
    body TEXT NOT NULL,
    published_on DATE
);
CREATE TABLE IF NOT EXISTS enquiry (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    programme_id BIGINT NOT NULL REFERENCES programme(id),
    email TEXT NOT NULL,
    phone TEXT,
    reference TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    agreed BOOLEAN NOT NULL,
    open BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS preview_link (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    reference_id BIGINT NOT NULL REFERENCES reference_entry(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    retired BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS slug_redirect (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    programme_id BIGINT NOT NULL REFERENCES programme(id),
    slug TEXT NOT NULL,
    reference_id BIGINT NOT NULL REFERENCES reference_entry(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS redirect_slug
    ON slug_redirect (programme_id, slug);
CREATE TABLE IF NOT EXISTS service_clock (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    offset_seconds BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS session (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    account_id BIGINT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS seed_marker (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

_pool: psycopg_pool.ConnectionPool | None = None


def pool() -> psycopg_pool.ConnectionPool:
    global _pool
    if _pool is None:
        _pool = psycopg_pool.ConnectionPool(
            DATABASE_URL, min_size=1, max_size=16, timeout=2.0,
            max_idle=30.0, max_lifetime=600.0,
            kwargs={"row_factory": dict_row, "connect_timeout": 2},
            open=True)
    return _pool


def reset_pool() -> None:
    """Drop pooled connections so a returning Postgres needs no restart."""
    global _pool
    if _pool is not None:
        try:
            _pool.close()
        except Exception:
            pass
        _pool = None


class Unavailable(Exception):
    """Postgres is not answering."""


def run(fn, *args, **kwargs):
    """Run one unit of work on a pooled connection.

    Retries once on a broken connection so a request that lands on a dead
    socket after Postgres returns still succeeds. Any connection-level
    failure is reported as Unavailable, never as a 5xx stack trace.
    """
    try:
        with pool().connection() as conn:
            return fn(conn, *args, **kwargs)
    except Unavailable:
        raise
    except psycopg.OperationalError as exc:
        raise Unavailable() from exc
    except psycopg.errors.InterfaceError as exc:
        raise Unavailable() from exc

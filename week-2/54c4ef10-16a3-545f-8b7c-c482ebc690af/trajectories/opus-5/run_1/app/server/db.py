"""PostgreSQL access: a threaded pool, the schema and small helpers."""

from __future__ import annotations

import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import psycopg2
import psycopg2.extras
import psycopg2.pool

from .config import CONFIG

SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
    id uuid PRIMARY KEY,
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
    token text PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS rolls (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name text NOT NULL,
    stock text NOT NULL,
    format text NOT NULL,
    ei integer NOT NULL,
    push_pull integer NOT NULL,
    reciprocity_p numeric(3,2) NOT NULL,
    development_note text NOT NULL DEFAULT '',
    kind text NOT NULL,
    curve_roll_id uuid REFERENCES rolls(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rolls_account_idx ON rolls(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS entries (
    id uuid PRIMARY KEY,
    roll_id uuid NOT NULL REFERENCES rolls(id) ON DELETE CASCADE,
    counter integer NOT NULL,
    aperture text NOT NULL,
    shutter text NOT NULL,
    metered_ev numeric NOT NULL,
    note text NOT NULL DEFAULT '',
    misfire boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (roll_id, counter)
);

CREATE TABLE IF NOT EXISTS scans (
    id uuid PRIMARY KEY,
    roll_id uuid NOT NULL REFERENCES rolls(id) ON DELETE CASCADE,
    position integer NOT NULL,
    filename text NOT NULL,
    format text NOT NULL,
    size bigint NOT NULL,
    sha256 text NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    dpi integer NOT NULL,
    first_edge integer NOT NULL,
    transfer text NOT NULL,
    gamma numeric,
    state text NOT NULL,
    preview_slices integer NOT NULL,
    calibration_id uuid,
    base_fog numeric,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (roll_id, sha256)
);

CREATE TABLE IF NOT EXISTS calibrations (
    id uuid PRIMARY KEY,
    scan_id uuid NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    method text NOT NULL,
    area_x integer NOT NULL,
    area_y integer NOT NULL,
    area_w integer NOT NULL,
    area_h integer NOT NULL,
    reference double precision,
    steps jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS frames (
    id uuid PRIMARY KEY,
    scan_id uuid NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    slot_index integer NOT NULL,
    x0 integer NOT NULL,
    x1 integer NOT NULL,
    blank_slot boolean NOT NULL DEFAULT false,
    accepted boolean NOT NULL DEFAULT false,
    mean_density numeric,
    title text NOT NULL DEFAULT '',
    UNIQUE (scan_id, slot_index)
);

CREATE TABLE IF NOT EXISTS alignments (
    roll_id uuid PRIMARY KEY REFERENCES rolls(id) ON DELETE CASCADE,
    version integer NOT NULL DEFAULT 0,
    offset_frames integer,
    slip_after integer,
    source text,
    proposal jsonb,
    saved_at timestamptz
);

CREATE TABLE IF NOT EXISTS alignment_overrides (
    roll_id uuid NOT NULL REFERENCES rolls(id) ON DELETE CASCADE,
    entry_id uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    frame_id uuid REFERENCES frames(id) ON DELETE CASCADE,
    PRIMARY KEY (roll_id, entry_id)
);

CREATE TABLE IF NOT EXISTS readings (
    id uuid PRIMARY KEY,
    scan_id uuid NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    frame_id uuid NOT NULL REFERENCES frames(id) ON DELETE CASCADE,
    entry_id uuid REFERENCES entries(id) ON DELETE SET NULL,
    x integer NOT NULL,
    y integer NOT NULL,
    gross numeric NOT NULL,
    net numeric NOT NULL,
    calibration_id uuid NOT NULL REFERENCES calibrations(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);
"""

_pool: psycopg2.pool.ThreadedConnectionPool | None = None
_pool_lock = threading.Lock()
_ready = threading.Event()


def ready() -> bool:
    return _ready.is_set()


def _create_pool() -> psycopg2.pool.ThreadedConnectionPool:
    return psycopg2.pool.ThreadedConnectionPool(
        1, 16, dsn=CONFIG.database_url, connect_timeout=5
    )


def connect_and_migrate() -> None:
    """Open the pool and apply the schema; retried by the caller until it works."""
    global _pool
    with _pool_lock:
        if _pool is None:
            _pool = _create_pool()
    with transaction() as cur:
        cur.execute(SCHEMA)
    _ready.set()


def wait_for_database(stop: threading.Event) -> None:
    while not stop.is_set():
        try:
            connect_and_migrate()
            return
        except psycopg2.Error:
            stop.wait(1.0)


@contextmanager
def transaction() -> Iterator[psycopg2.extras.RealDictCursor]:
    assert _pool is not None
    conn = _pool.getconn()
    try:
        conn.autocommit = False
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            yield cur
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    finally:
        _pool.putconn(conn)


def fetch_one(sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
    with transaction() as cur:
        cur.execute(sql, params)
        row = cur.fetchone()
    return dict(row) if row else None


def fetch_all(sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    with transaction() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
    return [dict(r) for r in rows]


def execute(sql: str, params: tuple[Any, ...] = ()) -> None:
    with transaction() as cur:
        cur.execute(sql, params)


def now() -> float:
    return time.time()

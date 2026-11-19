"""PostgreSQL access layer for all four services.

Each service owns one schema. The gateway stores only workspace keys.
Migrations and seed data are applied idempotently at serve start.
"""
from __future__ import annotations

import threading
import time
from typing import Any, Optional

import psycopg
import psycopg.rows
import psycopg_pool

SCHEMA_SQL = {
    "gateway": """
    CREATE TABLE IF NOT EXISTS workspaces (
        imager_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
    );
    """,
    "sky_engine": """
    CREATE TABLE IF NOT EXISTS sites (
        imager_id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        latitude DOUBLE PRECISION NOT NULL,
        longitude DOUBLE PRECISION NOT NULL,
        elevation_m INTEGER NOT NULL,
        time_zone TEXT NOT NULL,
        min_altitude_deg INTEGER NOT NULL DEFAULT 20,
        push_topic TEXT,
        updated_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS horizons (
        imager_id TEXT PRIMARY KEY,
        altitudes JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plans (
        imager_id TEXT NOT NULL,
        date TEXT NOT NULL,
        project_id TEXT NOT NULL,
        added_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (imager_id, date, project_id)
    );
    CREATE TABLE IF NOT EXISTS conditions (
        imager_id TEXT NOT NULL,
        date TEXT NOT NULL,
        hour_start TIMESTAMPTZ NOT NULL,
        cloud_pct INTEGER NOT NULL,
        transparency INTEGER NOT NULL,
        seeing INTEGER NOT NULL,
        PRIMARY KEY (imager_id, date, hour_start)
    );
    CREATE TABLE IF NOT EXISTS condition_headers (
        imager_id TEXT NOT NULL,
        date TEXT NOT NULL,
        entered_at TIMESTAMPTZ,
        PRIMARY KEY (imager_id, date)
    );
    CREATE TABLE IF NOT EXISTS verdict_history (
        imager_id TEXT NOT NULL,
        date TEXT NOT NULL,
        verdict TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (imager_id, date)
    );
    CREATE TABLE IF NOT EXISTS verdict_outbox (
        id TEXT PRIMARY KEY,
        imager_id TEXT NOT NULL,
        date TEXT NOT NULL,
        verdict TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reminders (
        imager_id TEXT PRIMARY KEY,
        enabled BOOLEAN NOT NULL,
        local_time TEXT NOT NULL
    );
    """,
    "ledger": """
    CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        imager_id TEXT NOT NULL,
        name TEXT NOT NULL,
        target_name TEXT NOT NULL,
        ra_deg DOUBLE PRECISION NOT NULL,
        dec_deg DOUBLE PRECISION NOT NULL,
        state TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        movement_id TEXT NOT NULL,
        movement_kind TEXT NOT NULL,
        project_id TEXT NOT NULL,
        imager_id TEXT NOT NULL,
        filter TEXT NOT NULL,
        account TEXT NOT NULL,
        seconds BIGINT NOT NULL,
        session_id TEXT,
        batch_id TEXT,
        reverses_movement_id TEXT,
        created_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS entries_project ON entries (project_id, filter, account, created_at, id);
    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        imager_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        state TEXT NOT NULL,
        previous_state TEXT,
        observing_date TEXT NOT NULL,
        started_at TIMESTAMPTZ,
        logged_at TIMESTAMPTZ,
        notes TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS batches (
        id TEXT PRIMARY KEY,
        imager_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        filter TEXT NOT NULL,
        sub_count INTEGER NOT NULL,
        exposure_s INTEGER NOT NULL,
        camera TEXT NOT NULL,
        gain INTEGER NOT NULL,
        "offset" INTEGER NOT NULL,
        temperature_c DOUBLE PRECISION NOT NULL,
        binning INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS frames (
        id TEXT PRIMARY KEY,
        imager_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        name TEXT NOT NULL,
        size_bytes BIGINT NOT NULL,
        content_type TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        UNIQUE (batch_id, name)
    );
    CREATE TABLE IF NOT EXISTS idempotency (
        imager_id TEXT NOT NULL,
        key TEXT NOT NULL,
        body_hash TEXT NOT NULL,
        status INTEGER NOT NULL,
        response JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (imager_id, key)
    );
    CREATE TABLE IF NOT EXISTS locks (
        session_id TEXT PRIMARY KEY,
        lock_token TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS calibration_sets (
        id TEXT PRIMARY KEY,
        imager_id TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        camera TEXT NOT NULL,
        gain INTEGER NOT NULL,
        "offset" INTEGER NOT NULL,
        exposure_s INTEGER,
        temperature_c DOUBLE PRECISION NOT NULL,
        binning INTEGER NOT NULL,
        filter TEXT,
        frame_count INTEGER NOT NULL,
        captured_on TEXT NOT NULL,
        status TEXT NOT NULL,
        version INTEGER NOT NULL,
        current_master JSONB,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS calibration_versions (
        id TEXT PRIMARY KEY,
        set_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        fields JSONB NOT NULL,
        master JSONB,
        created_at TIMESTAMPTZ NOT NULL,
        UNIQUE (set_id, version)
    );
    CREATE TABLE IF NOT EXISTS calibration_links (
        batch_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        calibration_set_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (batch_id, kind)
    );
    CREATE TABLE IF NOT EXISTS share_links (
        project_id TEXT PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        imager_id TEXT NOT NULL,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS integration_cache (
        project_id TEXT PRIMARY KEY,
        logged_seconds BIGINT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL
    );
    """,
    "push_dispatcher": """
    CREATE TABLE IF NOT EXISTS pushes (
        id TEXT PRIMARY KEY,
        imager_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        date TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TIMESTAMPTZ,
        sent_at TIMESTAMPTZ,
        outbox_id TEXT,
        created_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS claimed (
        outbox_id TEXT PRIMARY KEY,
        claimed_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reminder_sent (
        imager_id TEXT NOT NULL,
        occurrence_key TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (imager_id, occurrence_key)
    );
    """,
}


class Database:
    """A per-service pooled connection to the database, resilient to outages."""

    def __init__(self, url: str, schema: str) -> None:
        self.url = url
        self.schema = schema
        self._pool: Optional[psycopg_pool.ConnectionPool] = None
        self._lock = threading.Lock()
        self._last_failure = 0.0

    def pool(self) -> psycopg_pool.ConnectionPool:
        if self._pool is None:
            with self._lock:
                if self._pool is None:
                    self._pool = psycopg_pool.ConnectionPool(
                        self.url, min_size=1, max_size=8, open=True, timeout=5.0,
                        kwargs={"options": f"-c search_path={self.schema},public"},
                    )
        return self._pool

    def close(self) -> None:
        if self._pool is not None:
            self._pool.close()

    def ensure_schema(self) -> None:
        """Create the schema and tables if missing; retried until the database answers."""
        ddl = SCHEMA_SQL[self.schema]
        for attempt in range(40):
            try:
                with psycopg.connect(self.url, autocommit=True) as conn:
                    conn.execute(f"CREATE SCHEMA IF NOT EXISTS {self.schema}")
                    conn.execute(f"SET search_path TO {self.schema}")
                    conn.execute(ddl)
                return
            except Exception:
                if attempt == 39:
                    raise
                time.sleep(0.5)

    def query(self, sql: str, params: tuple = ()) -> list[dict]:
        pool = self.pool()
        try:
            with pool.connection() as conn:
                rows = conn.execute(sql, params).fetchall()
                return [dict(row) for row in rows] if rows else []
        except psycopg_pool.PoolTimeout:
            raise RuntimeError("database_unavailable")
        except psycopg.OperationalError:
            self._pool = None
            raise RuntimeError("database_unavailable")

    def query_one(self, sql: str, params: tuple = ()) -> Optional[dict]:
        rows = self.query(sql, params)
        return rows[0] if rows else None

    def execute(self, sql: str, params: tuple = ()) -> None:
        self.query(sql, params)

    def run_in_transaction(self, fn) -> Any:
        """Run fn(cursor) inside a transaction; retry once after a connection loss."""
        pool = self.pool()
        last: Optional[Exception] = None
        for _ in range(2):
            try:
                with pool.connection() as conn:
                    with conn.transaction():
                        with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
                            return fn(cur)
            except psycopg_pool.PoolTimeout as exc:
                last = exc
                break
            except psycopg.OperationalError as exc:
                last = exc
                self._pool = None
                time.sleep(0.2)
        raise RuntimeError("database_unavailable") from last

"""Connection management and idempotent schema application for PostgreSQL."""
from __future__ import annotations

import threading
from typing import Iterator

import psycopg
from psycopg.rows import dict_row

from .config import CONFIG

_pool_lock = threading.Lock()
_pool: list[psycopg.Connection] = []
_unavailable = threading.Event()


def is_unavailable() -> bool:
    return _unavailable.is_set()


def mark_unavailable() -> None:
    _unavailable.set()


def mark_available() -> None:
    _unavailable.clear()


def _new_connection() -> psycopg.Connection:
    conn = psycopg.connect(CONFIG.database_url, autocommit=True, connect_timeout=3)
    conn.row_factory = dict_row
    return conn


def dedicated_connection() -> psycopg.Connection:
    """A connection for boot work; never pooled, so never shared across forks."""
    return _new_connection()


def get_conn() -> psycopg.Connection:
    """Borrow a pooled connection; raises psycopg errors when unreachable."""
    with _pool_lock:
        while _pool:
            conn = _pool.pop()
            try:
                conn.execute("SELECT 1")
                return conn
            except psycopg.Error:
                try:
                    conn.close()
                except psycopg.Error:
                    pass
        conn = _new_connection()
        mark_available()
        return conn


def put_conn(conn: psycopg.Connection) -> None:
    if conn.closed:
        return
    if is_unavailable():
        try:
            conn.close()
        except psycopg.Error:
            pass
        return
    with _pool_lock:
        if len(_pool) < 16:
            _pool.append(conn)
            return
    try:
        conn.close()
    except psycopg.Error:
        pass


def drop_conn(conn: psycopg.Connection) -> None:
    try:
        conn.close()
    except psycopg.Error:
        pass


def db_call(fn, *args, **kwargs):
    """Run fn(conn, ...) with a pooled connection, surfacing psycopg errors."""
    conn = get_conn()
    try:
        result = fn(conn, *args, **kwargs)
    except psycopg.Error:
        drop_conn(conn)
        raise
    else:
        put_conn(conn)
        return result


def db_transaction(fn, *args, **kwargs):
    """Run fn(conn, ...) in one transaction; commits on success, rolls back otherwise."""
    conn = get_conn()
    try:
        conn.execute("SET LOCAL lock_timeout = '2s'")
        with conn.transaction():
            result = fn(conn, *args, **kwargs)
    except psycopg.Error:
        drop_conn(conn)
        raise
    else:
        put_conn(conn)
        return result


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS studio_users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES studio_users(id),
    token_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS sign_in_attempts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email TEXT NOT NULL,
    succeeded BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cases (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    client TEXT NOT NULL,
    industry TEXT NOT NULL,
    theme TEXT NOT NULL,
    headline TEXT NOT NULL,
    body TEXT NOT NULL,
    awards TEXT,
    testimonial_quote TEXT NOT NULL,
    testimonial_name TEXT NOT NULL,
    testimonial_role TEXT NOT NULL,
    cover_seed BIGINT NOT NULL,
    position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 8)
);
CREATE TABLE IF NOT EXISTS inquiries (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    reference TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    company TEXT,
    services TEXT NOT NULL,
    budget TEXT NOT NULL,
    timeline TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL,
    call_at TIMESTAMPTZ,
    decline_reason TEXT,
    version INTEGER NOT NULL,
    status_token TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS status_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    inquiry_id BIGINT NOT NULL REFERENCES inquiries(id),
    action TEXT,
    from_status TEXT,
    to_status TEXT,
    call_at TIMESTAMPTZ,
    decline_reason TEXT,
    actor_id BIGINT REFERENCES studio_users(id),
    created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    inquiry_id BIGINT NOT NULL REFERENCES inquiries(id),
    author_id BIGINT NOT NULL REFERENCES studio_users(id),
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key TEXT PRIMARY KEY,
    request_body TEXT NOT NULL,
    response_body TEXT,
    inquiry_id BIGINT,
    created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS transition_keys (
    user_id BIGINT NOT NULL,
    inquiry_id BIGINT NOT NULL,
    key TEXT NOT NULL,
    request_body TEXT NOT NULL,
    response_body TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, inquiry_id, key)
);
CREATE TABLE IF NOT EXISTS outbox (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    inquiry_id BIGINT NOT NULL,
    to_address TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    calendar TEXT,
    calendar_method TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0,
    in_flight BOOLEAN NOT NULL DEFAULT FALSE,
    uncertain BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT outbox_no_successor UNIQUE (inquiry_id, id)
);
CREATE INDEX IF NOT EXISTS idx_inquiries_status_token ON inquiries(status_token);
CREATE INDEX IF NOT EXISTS idx_inquiries_email_created ON inquiries(lower(email), created_at);
CREATE INDEX IF NOT EXISTS idx_inquiries_call_at ON inquiries(call_at) WHERE status = 'call_booked';
CREATE INDEX IF NOT EXISTS idx_status_events_inquiry ON status_events(inquiry_id, id);
CREATE INDEX IF NOT EXISTS idx_notes_inquiry ON notes(inquiry_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_signin_email_time ON sign_in_attempts(email, created_at);
"""

EXTENSION_SQL = "CREATE EXTENSION IF NOT EXISTS citext"


SEED_LOCK_KEY = 872534190


def ensure_schema_and_seed(seed_fn) -> None:
    """Apply the schema and seed once, under an advisory lock, on one
    dedicated connection that is never pooled."""
    conn = dedicated_connection()
    try:
        conn.execute("SELECT pg_advisory_lock(%(k)s)", {"k": SEED_LOCK_KEY})
        try:
            ensure_schema_on(conn)
            with conn.transaction():
                seed_fn(conn)
        finally:
            conn.execute("SELECT pg_advisory_unlock(%(k)s)", {"k": SEED_LOCK_KEY})
    finally:
        conn.close()


def ensure_schema() -> None:
    conn = get_conn()
    try:
        ensure_schema_on(conn)
    except psycopg.Error:
        drop_conn(conn)
        raise
    else:
        put_conn(conn)


def ensure_schema_on(conn) -> None:
    try:
        with conn.transaction():
            try:
                conn.execute(EXTENSION_SQL)
            except psycopg.Error:
                pass
        conn.execute(SCHEMA_SQL)
        conn.execute(
            "ALTER TABLE outbox ADD COLUMN IF NOT EXISTS calendar_method TEXT"
        )
        conn.execute("ALTER TABLE idempotency_keys ALTER COLUMN inquiry_id DROP NOT NULL")
        conn.execute("ALTER TABLE idempotency_keys ALTER COLUMN response_body DROP NOT NULL")
        conn.execute("ALTER TABLE transition_keys ALTER COLUMN response_body DROP NOT NULL")
    except psycopg.Error:
        raise

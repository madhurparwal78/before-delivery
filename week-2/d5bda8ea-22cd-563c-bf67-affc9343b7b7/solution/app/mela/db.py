"""PostgreSQL access: one connection per request, schema and seed applied the first time the database answers."""
import threading
import time

import psycopg
from flask import g
from psycopg.rows import dict_row

from . import config, seed

SCHEMA = """
CREATE TABLE IF NOT EXISTS members (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calendars (
    id BIGSERIAL PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    city TEXT NOT NULL,
    tint TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS follows (
    member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    calendar_id BIGINT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (member_id, calendar_id)
);

CREATE TABLE IF NOT EXISTS events (
    id BIGSERIAL PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    host_id BIGINT NOT NULL REFERENCES members(id),
    calendar_id BIGINT REFERENCES calendars(id),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    timezone TEXT NOT NULL,
    location_type TEXT NOT NULL CHECK (location_type IN ('offline', 'virtual')),
    venue_name TEXT NOT NULL DEFAULT '',
    street_address TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    virtual_link TEXT NOT NULL DEFAULT '',
    visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
    require_approval BOOLEAN NOT NULL,
    capacity INTEGER CHECK (capacity BETWEEN 1 AND 10000),
    waitlist BOOLEAN NOT NULL,
    registration_status TEXT NOT NULL CHECK (registration_status IN ('open', 'closed', 'code_only')),
    access_code TEXT,
    theme TEXT NOT NULL CHECK (theme IN ('amber', 'harbor', 'moss', 'plum', 'ember', 'night')),
    categories TEXT[] NOT NULL DEFAULT '{}',
    show_guest_list BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_at > start_at)
);

CREATE TABLE IF NOT EXISTS registrations (
    id BIGSERIAL PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'declined', 'waitlisted', 'cancelled')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    queued_at TIMESTAMPTZ,
    moved_up BOOLEAN NOT NULL DEFAULT FALSE,
    celebrated_at TIMESTAMPTZ,
    UNIQUE (event_id, member_id)
);
CREATE INDEX IF NOT EXISTS registrations_queue ON registrations (event_id, status, queued_at, id);

CREATE TABLE IF NOT EXISTS access_code_failures (
    event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    failures INTEGER NOT NULL,
    first_failed_at TIMESTAMPTZ NOT NULL,
    locked_until TIMESTAMPTZ,
    PRIMARY KEY (event_id, member_id)
);

CREATE TABLE IF NOT EXISTS host_messages (
    id BIGSERIAL PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    idempotency_key TEXT,
    idempotency_body JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS host_messages_idempotency
    ON host_messages (member_id, event_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS event_reports (
    id BIGSERIAL PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    reason TEXT NOT NULL CHECK (reason IN ('spam', 'misleading', 'inappropriate', 'other')),
    details TEXT NOT NULL DEFAULT '',
    idempotency_key TEXT,
    idempotency_body JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS event_reports_idempotency
    ON event_reports (member_id, event_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
"""

# Any number of instances may boot together; this lock makes schema and seed run one at a time.
SETUP_LOCK = 7_302_115
CONNECT_OPTIONS = {"connect_timeout": 3, "tcp_user_timeout": 8000, "options": "-c statement_timeout=8000 -c lock_timeout=8000", "keepalives_idle": 5,
                   "keepalives_interval": 2, "keepalives_count": 2}

_ready = False
_ready_lock = threading.Lock()


def connect():
    """A fresh autocommit connection; raises psycopg.OperationalError when PostgreSQL is unreachable."""
    conn = psycopg.connect(config.DATABASE_URL, autocommit=True, row_factory=dict_row, **CONNECT_OPTIONS)
    ensure_ready(conn)
    return conn


def ensure_ready(conn):
    global _ready
    if _ready:
        return
    with _ready_lock:
        if _ready:
            return
        with conn.transaction():
            conn.execute("SELECT pg_advisory_xact_lock(%s)", (SETUP_LOCK,))
            conn.execute(SCHEMA)
            seed.apply(conn)
        _ready = True



def conn():
    """The request's connection, opened on first use and closed when the request ends."""
    if "db" not in g:
        g.db = connect()
    return g.db


def close(_exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def prepare_in_background():
    """Apply schema and seed as soon as the database answers, without waiting for a request."""
    def attempt():
        while not _ready:
            try:
                connect().close()
            except psycopg.OperationalError:
                time.sleep(1)
    threading.Thread(target=attempt, name="mela-setup", daemon=True).start()

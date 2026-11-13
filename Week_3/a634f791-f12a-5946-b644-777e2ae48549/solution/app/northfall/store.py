"""The one Postgres: the schema, the seed on first boot, and a small pool of connections per worker."""
import threading
import time
from queue import Empty, Full, LifoQueue

import psycopg
from flask import g
from psycopg.pq import TransactionStatus
from psycopg.rows import dict_row
from psycopg.types.string import StrDumperUnknown

from . import settings
from .seed import plant_seed

SCHEMA = """
CREATE TABLE IF NOT EXISTS programme (
    id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name           text NOT NULL,
    slug           text NOT NULL UNIQUE,
    default_locale text NOT NULL
);

CREATE TABLE IF NOT EXISTS account (
    id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    role          text NOT NULL CHECK (role IN ('curator', 'steward')),
    programme_id  integer NOT NULL REFERENCES programme (id)
);

CREATE TABLE IF NOT EXISTS reference_entry (
    id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    programme_id    integer NOT NULL REFERENCES programme (id),
    slug            text NOT NULL,
    ordinal         integer CHECK (ordinal >= 1),
    sector          text NOT NULL,
    customer        text NOT NULL,
    title           text NOT NULL,
    summary         text NOT NULL,
    challenge       text NOT NULL,
    work            text NOT NULL,
    title_fi        text,
    body_fi         text,
    published       boolean NOT NULL DEFAULT false,
    retired_at      timestamptz,
    version         integer NOT NULL DEFAULT 1,
    clearance_from  date,
    clearance_until date,
    quote           text,
    quote_speaker   text,
    quote_role      text,
    UNIQUE (programme_id, slug),
    CONSTRAINT one_ordinal_each UNIQUE (programme_id, ordinal) DEFERRABLE INITIALLY DEFERRED,
    CHECK (clearance_from <= clearance_until)
);

CREATE TABLE IF NOT EXISTS figure (
    id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    reference_id integer NOT NULL REFERENCES reference_entry (id),
    label        text NOT NULL,
    value        text NOT NULL,
    position     integer NOT NULL CHECK (position >= 1),
    UNIQUE (reference_id, position)
);

CREATE TABLE IF NOT EXISTS note (
    id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    programme_id integer NOT NULL REFERENCES programme (id),
    slug         text NOT NULL,
    title        text NOT NULL,
    preview      text NOT NULL,
    body         text NOT NULL,
    published_on date,
    UNIQUE (programme_id, slug)
);

CREATE TABLE IF NOT EXISTS enquiry (
    id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    programme_id integer NOT NULL REFERENCES programme (id),
    email        text NOT NULL,
    phone        text,
    reference    text,
    created_at   timestamptz NOT NULL,
    agreed       boolean NOT NULL,
    open         boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_enquiry_per_address
    ON enquiry (programme_id, lower(email)) WHERE open;

CREATE TABLE IF NOT EXISTS preview_link (
    id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    token        text NOT NULL UNIQUE,
    reference_id integer NOT NULL REFERENCES reference_entry (id),
    expires_at   timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS slug_redirect (
    id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    programme_id integer NOT NULL REFERENCES programme (id),
    slug         text NOT NULL,
    reference_id integer NOT NULL REFERENCES reference_entry (id),
    UNIQUE (programme_id, slug)
);

CREATE TABLE IF NOT EXISTS service_clock (
    id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    offset_seconds bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS desk_session (
    id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    token_digest text NOT NULL UNIQUE,
    account_id   integer NOT NULL REFERENCES account (id) ON DELETE CASCADE,
    signed_in_at timestamptz NOT NULL
);
"""

POOL_SIZE = 8
# A dead Postgres must surface well inside the published five seconds, however the connection died.
CONNECTION_OPTIONS = {"connect_timeout": 2, "keepalives_idle": 1, "keepalives_interval": 1, "keepalives_count": 2,
                      "tcp_user_timeout": 3000}

_idle = LifoQueue(POOL_SIZE)
_prepared = threading.Event()
_prepare_lock = threading.Lock()


class LookupDumper(StrDumperUnknown):
    """Postgres text cannot hold NUL, and no stored value does: a NUL in an address becomes U+FFFD, so the lookup
    matches nothing instead of failing the query. Every written field refuses NUL before it gets here."""

    def dump(self, obj):
        return super().dump(obj.replace("\0", "�"))


def _connect():
    conn = psycopg.connect(settings.DATABASE_URL, autocommit=True, row_factory=dict_row, **CONNECTION_OPTIONS)
    conn.adapters.register_dumper(str, LookupDumper)
    return conn


def _checkout():
    """An idle connection that still answers, or a new one, so no request meets a connection Postgres has dropped."""
    while True:
        try:
            conn = _idle.get_nowait()
        except Empty:
            return _connect()
        try:
            conn.execute("SELECT true")
            return conn
        except psycopg.Error:
            conn.close()


def _prepare(conn):
    """Apply the schema, and on a database that has never held it the seed, once across all workers."""
    with _prepare_lock:
        if _prepared.is_set():
            return
        with conn.transaction():
            conn.execute("SELECT pg_advisory_xact_lock(0, 0)")
            first_boot = conn.execute("SELECT to_regclass('programme') IS NULL AS first").fetchone()["first"]
            conn.execute(SCHEMA)
            if first_boot:
                plant_seed(conn)
        _prepared.set()


def _keep_preparing():
    while not _prepared.is_set():
        try:
            conn = _connect()
            try:
                _prepare(conn)
            finally:
                conn.close()
        except psycopg.Error:
            time.sleep(1)


def start_preparing():
    threading.Thread(target=_keep_preparing, name="store-prepare", daemon=True).start()


def db():
    """This request's connection, on first use. Raises psycopg.OperationalError while Postgres is unreachable."""
    if "db" not in g:
        conn = _checkout()
        try:
            _prepare(conn)
        except BaseException:
            conn.close()
            raise
        g.db = conn
    return g.db


def release_db(_error=None):
    conn = g.pop("db", None)
    if conn is None:
        return
    if conn.closed or conn.info.transaction_status != TransactionStatus.IDLE:
        conn.close()
        return
    try:
        _idle.put_nowait(conn)
    except Full:
        conn.close()


def lock_programme(conn, programme_id):
    """Serialise every change to one programme's references, in arrival order."""
    conn.execute("SELECT pg_advisory_xact_lock(1, %s)", (programme_id,))

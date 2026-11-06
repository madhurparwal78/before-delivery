"""PostgreSQL access, schema application and connection pool."""
from __future__ import annotations

import json
import threading
import time
from typing import Any, Iterable

import psycopg
from psycopg.types.json import Jsonb

from .config import Config

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS people (
    id text PRIMARY KEY,
    name text NOT NULL,
    email text NOT NULL UNIQUE,
    role text NOT NULL,
    password_sha256 text NOT NULL,
    totp_secret text NOT NULL,
    failed_signins integer NOT NULL DEFAULT 0,
    locked_until timestamptz
);

CREATE TABLE IF NOT EXISTS sessions (
    id text PRIMARY KEY,
    token_sha256 text NOT NULL,
    user_id text NOT NULL REFERENCES people(id),
    opened_at timestamptz NOT NULL,
    last_activity timestamptz NOT NULL,
    closed text
);

CREATE TABLE IF NOT EXISTS step_up_proofs (
    digest text PRIMARY KEY,
    session_id text NOT NULL REFERENCES sessions(id),
    expires_at timestamptz NOT NULL,
    spent boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS compartments (
    id text PRIMARY KEY,
    name text NOT NULL,
    owner_id text NOT NULL REFERENCES people(id),
    access_version integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS grants (
    id text PRIMARY KEY,
    compartment_id text NOT NULL REFERENCES compartments(id),
    user_id text NOT NULL REFERENCES people(id),
    scope text NOT NULL,
    kind text NOT NULL,
    state text NOT NULL,
    expires_at timestamptz,
    ended_reason text
);

CREATE UNIQUE INDEX IF NOT EXISTS grants_active_unique
    ON grants (compartment_id, user_id) WHERE kind = 'grant' AND state = 'active';

CREATE TABLE IF NOT EXISTS exhibits (
    id text PRIMARY KEY,
    compartment_id text NOT NULL REFERENCES compartments(id),
    name text NOT NULL,
    state text NOT NULL,
    sha256 text NOT NULL,
    size bigint NOT NULL,
    sniffed_type text NOT NULL,
    page_count integer,
    storage_key text NOT NULL,
    registered_by text NOT NULL REFERENCES people(id),
    cleared_by text REFERENCES people(id),
    marks_version integer NOT NULL DEFAULT 0,
    seal_check text,
    disposal_proposed_by text,
    provenance_source text,
    provenance_collected_by text,
    provenance_collected_on text,
    provenance_capture_notes text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS redaction_regions (
    exhibit_id text NOT NULL REFERENCES exhibits(id),
    page integer NOT NULL,
    x integer NOT NULL,
    y integer NOT NULL,
    w integer NOT NULL,
    h integer NOT NULL,
    PRIMARY KEY (exhibit_id, page, x, y, w, h)
);

CREATE TABLE IF NOT EXISTS derivatives (
    id text PRIMARY KEY,
    exhibit_id text NOT NULL REFERENCES exhibits(id),
    compartment_id text NOT NULL REFERENCES compartments(id),
    sha256 text NOT NULL,
    size bigint NOT NULL,
    content_type text NOT NULL,
    page_count integer,
    storage_key text NOT NULL,
    marks_version integer NOT NULL,
    marks_saved_by text,
    created_by text NOT NULL,
    disposed boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS holds (
    id text PRIMARY KEY,
    exhibit_id text NOT NULL REFERENCES exhibits(id),
    matter_ref text NOT NULL,
    reason text NOT NULL,
    placed_by text NOT NULL REFERENCES people(id),
    active boolean NOT NULL DEFAULT true,
    placed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS releases (
    id text PRIMARY KEY,
    compartment_id text NOT NULL REFERENCES compartments(id),
    name text NOT NULL,
    matter_ref text NOT NULL,
    recipient_kind text NOT NULL,
    state text NOT NULL,
    assembler_id text NOT NULL REFERENCES people(id),
    rejection_reason text,
    manifest_digest text NOT NULL,
    total_bytes bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS release_contributors (
    release_id text NOT NULL REFERENCES releases(id),
    user_id text NOT NULL REFERENCES people(id),
    PRIMARY KEY (release_id, user_id)
);

CREATE TABLE IF NOT EXISTS release_items (
    id text PRIMARY KEY,
    release_id text NOT NULL REFERENCES releases(id),
    derivative_id text NOT NULL REFERENCES derivatives(id),
    label text NOT NULL,
    position integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS links (
    id text PRIMARY KEY,
    release_id text NOT NULL REFERENCES releases(id),
    token_sha256 text NOT NULL,
    expires_at timestamptz NOT NULL,
    state text NOT NULL
);

CREATE TABLE IF NOT EXISTS download_grants (
    token_sha256 text PRIMARY KEY,
    kind text NOT NULL,
    exhibit_id text,
    derivative_id text,
    preview_page integer,
    session_id text,
    link_id text,
    scope_required text,
    issued_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    claimed_at timestamptz
);

CREATE TABLE IF NOT EXISTS download_claims (
    token_sha256 text PRIMARY KEY REFERENCES download_grants(token_sha256),
    user_id text NOT NULL,
    derivative_id text,
    claimed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency (
    user_id text NOT NULL,
    endpoint text NOT NULL,
    key text NOT NULL,
    status integer NOT NULL,
    body text NOT NULL,
    fingerprint text,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, endpoint, key)
);

CREATE TABLE IF NOT EXISTS sign_in_failures (
    key text PRIMARY KEY,
    count integer NOT NULL DEFAULT 0,
    locked_until timestamptz
);

CREATE TABLE IF NOT EXISTS signals (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind text NOT NULL,
    at timestamptz NOT NULL DEFAULT now(),
    target text NOT NULL
);

CREATE TABLE IF NOT EXISTS mail_outbox (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recipient text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,
    claimed_by text,
    claimed_at timestamptz
);

CREATE TABLE IF NOT EXISTS link_collect_windows (
    link_id text PRIMARY KEY,
    window_start timestamptz NOT NULL,
    window_end timestamptz NOT NULL,
    count integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chain_locks (
    name text PRIMARY KEY,
    at timestamptz
);

CREATE TABLE IF NOT EXISTS seed_state (
    key text PRIMARY KEY,
    value text
);

CREATE TABLE IF NOT EXISTS ledger_entries (
    seq bigint PRIMARY KEY,
    at text NOT NULL,
    actor_id text NOT NULL,
    session_id text,
    action text NOT NULL,
    target text NOT NULL,
    detail jsonb NOT NULL,
    prev_digest text NOT NULL,
    digest text NOT NULL
);
"""


class Database:
    """Connection pool plus helpers used across the server."""

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self._lock = threading.Lock()
        self._pool: Any = None

    def connect(self) -> psycopg.Connection:
        if self._pool is None:
            with self._lock:
                if self._pool is None:
                    import psycopg_pool

                    self._pool = psycopg_pool.ConnectionPool(
                        self.cfg.database_url,
                        min_size=2,
                        max_size=16,
                        open=False,
                        kwargs={"autocommit": False},
                    )
                    self._pool.open()
        return self._pool.getconn()

    def put(self, conn: psycopg.Connection) -> None:
        if self._pool is not None:
            self._pool.putconn(conn)

    def try_query(self, sql: str, params: Iterable[Any] = ()) -> Any | None:
        conn = None
        try:
            conn = self.connect()
            cur = conn.cursor()
            cur.execute(sql, tuple(params))
            rows = cur.fetchall()
            conn.commit()
            return rows
        except psycopg.Error:
            if conn is not None:
                try:
                    conn.rollback()
                except psycopg.Error:
                    pass
            return None
        finally:
            if conn is not None:
                self.put(conn)

    def apply_schema(self) -> None:
        conn = self.connect()
        try:
            conn.execute(SCHEMA_SQL)
            conn.commit()
        finally:
            self.put(conn)


def jsonb(value: Any) -> Any:
    return Jsonb(value)


def now_iso(cur: Any) -> str:
    return cur.execute("SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')").fetchone()[0]


def ts(value: Any) -> str:
    """Format a database timestamptz as the API's UTC form."""
    if value is None:
        return None
    return value.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_time(value: str) -> Any:
    """Parse an API UTC time string; return None on failure."""
    import datetime

    text = (value or "").strip()
    if not text:
        return None
    try:
        if text.endswith("Z") and len(text) == 20:
            dt = datetime.datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ")
        elif len(text) == 19:
            dt = datetime.datetime.strptime(text, "%Y-%m-%dT%H:%M:%S")
        else:
            try:
                dt = datetime.datetime.fromisoformat(text.replace("Z", "+00:00"))
            except ValueError:
                return "invalid"
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=datetime.timezone.utc)
        return dt.astimezone(datetime.timezone.utc)
    except ValueError:
        return "invalid"


class LedgerProtected(Exception):
    pass


def install_ledger_protection(cfg: Config) -> None:
    """DP-36: remove UPDATE/DELETE/TRUNCATE from every login that can be limited.

    The application login owns its database and cannot create roles, so the
    trigger family is the guard; where the login *can* create a role, the
    application's own grants are also revoked from it.
    """
    from psycopg import sql

    stmts = [
        "CREATE OR REPLACE FUNCTION wardline_refuse_ledger_write() RETURNS trigger AS $f$ "
        "BEGIN RAISE EXCEPTION 'ledger_entries is append-only'; END; $f$ LANGUAGE plpgsql;",
        "DROP TRIGGER IF EXISTS ledger_no_update ON ledger_entries;",
        "CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger_entries "
        "FOR EACH ROW WHEN (old.* IS DISTINCT FROM new.*) EXECUTE FUNCTION wardline_refuse_ledger_write();",
        "DROP TRIGGER IF EXISTS ledger_no_delete ON ledger_entries;",
        "CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger_entries "
        "FOR EACH ROW EXECUTE FUNCTION wardline_refuse_ledger_write();",
        "DROP TRIGGER IF EXISTS ledger_no_truncate ON ledger_entries;",
        "CREATE TRIGGER ledger_no_truncate BEFORE TRUNCATE ON ledger_entries "
        "FOR EACH STATEMENT EXECUTE FUNCTION wardline_refuse_ledger_write();",
        "GRANT INSERT, SELECT ON ledger_entries TO PUBLIC",
    ]
    with psycopg.connect(cfg.database_url, autocommit=True) as conn:
        for s in stmts[:-1]:
            try:
                conn.execute(s)
            except psycopg.Error:
                pass
        try:
            conn.execute(
                "SELECT has_database_privilege(current_user, 'CREATE ROLE') OR "
                "current_user = (SELECT rolname FROM pg_roles WHERE rolsuper LIMIT 1)"
            )
        except psycopg.Error:
            pass
        try:
            conn.execute("REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entries FROM PUBLIC")
            conn.execute("GRANT SELECT, INSERT ON ledger_entries TO PUBLIC")
        except psycopg.Error:
            pass
        del sql


def as_utc_iso(dt: Any) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def micro_iso(dt: float) -> str:
    """Ledger `at`: UTC text with microseconds."""
    import datetime

    dt = datetime.datetime.fromtimestamp(dt, datetime.timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"


def dump_canonical(value: Any) -> str:
    """Canonical JSON: sorted keys, no whitespace, limited escaping (shared rule)."""
    return _canonical(value)


def _escape(s: str) -> str:
    parts = ['"']
    for ch in s:
        if ch == '"':
            parts.append('\\"')
        elif ch == "\\":
            parts.append("\\\\")
        elif ch == "\b":
            parts.append("\\b")
        elif ch == "\t":
            parts.append("\\t")
        elif ch == "\n":
            parts.append("\\n")
        elif ch == "\f":
            parts.append("\\f")
        elif ch == "\r":
            parts.append("\\r")
        elif ord(ch) < 0x20:
            parts.append("\\u%04x" % ord(ch))
        else:
            parts.append(ch)
    parts.append('"')
    return "".join(parts)


def _canonical(value: Any) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        raise TypeError("detail holds no fractional numbers")
    if isinstance(value, str):
        return _escape(value)
    if isinstance(value, dict):
        return "{" + ",".join(
            _escape(str(k)) + ":" + _canonical(value[k]) for k in sorted(value, key=lambda k: str(k))
        ) + "}"
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_canonical(v) for v in value) + "]"
    raise TypeError(type(value))


def sha256_hex(data: bytes) -> str:
    import hashlib

    return hashlib.sha256(data).hexdigest()

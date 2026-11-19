"""PostgreSQL access: pooled connections, schema creation, outage tracking.

The driver is pg8000, whose cursors are wrapped here to return dict rows so the
rest of the server reads rows by column name.
"""
from __future__ import annotations

import threading
from urllib.parse import unquote, urlparse

import pg8000.dbapi

from . import config

_pool_lock = threading.Lock()
_pool: list = []
_pool_size = 0
_db_up = threading.Event()
_stop = threading.Event()

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS seed_state (
  key text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  preferences jsonb NOT NULL DEFAULT '{"sync_sounds": false, "theme": "light"}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  plan text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS memberships (
  user_id text NOT NULL REFERENCES users(id),
  workspace_id text NOT NULL REFERENCES workspaces(id),
  role text NOT NULL CHECK (role IN ('admin','editor','viewer')),
  PRIMARY KEY (user_id, workspace_id)
);
CREATE TABLE IF NOT EXISTS invites (
  id text PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  email text NOT NULL,
  name text NOT NULL,
  role text NOT NULL,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE TABLE IF NOT EXISTS connector_definitions (
  id text PRIMARY KEY,
  workspace_id text REFERENCES workspaces(id),
  name text NOT NULL,
  slug text NOT NULL,
  type text NOT NULL,
  category text NOT NULL,
  availability jsonb NOT NULL,
  runnable boolean NOT NULL,
  custom boolean NOT NULL,
  version integer NOT NULL DEFAULT 1,
  manifests jsonb,
  detected_schemas jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS connector_slug_builtin
  ON connector_definitions (slug) WHERE workspace_id IS NULL;
CREATE TABLE IF NOT EXISTS sources (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  definition_id text NOT NULL REFERENCES connector_definitions(id),
  config jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS destinations (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  definition_id text NOT NULL REFERENCES connector_definitions(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS connections (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','inactive')),
  version integer NOT NULL DEFAULT 1,
  source_id text NOT NULL REFERENCES sources(id),
  destination_id text NOT NULL REFERENCES destinations(id),
  namespace_prefix text NOT NULL,
  streams jsonb NOT NULL,
  schedule jsonb NOT NULL,
  schema_change_policy text NOT NULL,
  cursors jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS connections_name_ws ON connections (workspace_id, lower(name));
CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY,
  connection_id text NOT NULL REFERENCES connections(id),
  workspace_id text NOT NULL REFERENCES workspaces(id),
  connection_version integer NOT NULL,
  definition_version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','running','succeeded','failed','cancelled')),
  attempts jsonb NOT NULL DEFAULT '[]'::jsonb,
  records_committed integer NOT NULL DEFAULT 0,
  per_stream jsonb NOT NULL DEFAULT '[]'::jsonb,
  failure_reason text,
  trigger_request_id text NOT NULL,
  started_by text NOT NULL REFERENCES users(id),
  log_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  settings jsonb NOT NULL,
  source_snapshot jsonb,
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  ended_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_job
  ON connections (id) WHERE status IN ('pending','running');
CREATE INDEX IF NOT EXISTS jobs_ws_created ON jobs (workspace_id, created_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS audit_events (
  workspace_id text NOT NULL REFERENCES workspaces(id),
  seq bigint NOT NULL,
  action text NOT NULL,
  target_id text NOT NULL,
  actor_email text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  prev_hash text NOT NULL,
  hash text NOT NULL,
  PRIMARY KEY (workspace_id, seq)
);
CREATE TABLE IF NOT EXISTS builder_projects (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  manifest jsonb NOT NULL,
  tested_streams jsonb NOT NULL DEFAULT '{}'::jsonb,
  definition_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sign_in_attempts (
  email text NOT NULL,
  failed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attempts_email_time ON sign_in_attempts (email, failed_at);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  workspace_id text NOT NULL,
  key text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  body jsonb NOT NULL,
  resource_id text NOT NULL,
  in_flight boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, key)
);
CREATE TABLE IF NOT EXISTS table_generations (
  destination_id text NOT NULL REFERENCES destinations(id),
  table_name text NOT NULL,
  generation integer NOT NULL DEFAULT 1,
  PRIMARY KEY (destination_id, table_name)
);
CREATE TABLE IF NOT EXISTS cancel_requests (
  job_id text PRIMARY KEY,
  requested_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sample_source_state (
  source_id text NOT NULL REFERENCES sources(id),
  state jsonb NOT NULL,
  PRIMARY KEY (source_id)
);
"""


def db_ready() -> bool:
    return _db_up.is_set()


def mark_db_up() -> None:
    _db_up.set()


def mark_db_down() -> None:
    _db_up.clear()


def probe() -> bool:
    """One quick connectivity check."""
    try:
        with connection() as conn:
            conn.execute("SELECT 1")
        return True
    except Exception:
        return False


def init_schema() -> None:
    with connection() as conn:
        conn.execute(SCHEMA_SQL)


def watch(stop_event: threading.Event) -> None:
    """Keep retrying the connection at least every five seconds.

    When the database answers, the schema is created and the seed ensured, so
    the app becomes ready without a restart. Restart recovery runs once, when
    the process first sees the database.
    """
    recovered = False
    while not stop_event.is_set():
        if probe():
            try:
                from . import seed as seed_mod

                init_schema()
                seed_mod.run()
                if not recovered:
                    seed_mod.recover()
                    recovered = True
                mark_db_up()
            except Exception:
                mark_db_down()
        else:
            mark_db_down()
        stop_event.wait(5)


def start_watcher() -> threading.Thread:
    _stop.clear()
    t = threading.Thread(target=watch, args=(_stop,), daemon=True)
    t.start()
    return t


class Row(dict):
    """A row that also reads by attribute, as the server code does."""

    def __getattr__(self, name):
        try:
            return self[name]
        except KeyError as exc:
            raise AttributeError(name) from exc


class Result:
    """Cursor wrapper reading rows as Row objects."""

    def __init__(self, cursor) -> None:
        self._cursor = cursor
        self._columns = None

    def _row(self, values) -> Row:
        if self._columns is None:
            self._columns = [d[0] for d in (self._cursor.description or [])]
        return Row(zip(self._columns, values))

    def fetchone(self):
        row = self._cursor.fetchone()
        return self._row(row) if row is not None else None

    def fetchall(self):
        return [self._row(row) for row in self._cursor.fetchall()]


def _connection_kwargs():
    """Split DATABASE_URL into the keyword arguments pg8000 accepts."""
    parsed = urlparse(config.DATABASE_URL)
    return {
        "user": unquote(parsed.username or ""),
        "password": unquote(parsed.password or ""),
        "host": parsed.hostname or "localhost",
        "port": parsed.port or 5432,
        "database": (parsed.path or "/").lstrip("/") or "postgres",
    }


MAX_POOL = 16


class Connection:
    """A pg8000 connection whose execute() returns dict rows."""

    def __init__(self) -> None:
        self._conn = pg8000.dbapi.connect(**_connection_kwargs())
        self._conn.autocommit = True
        self._cursor = self._conn.cursor()
        self.autocommit = True
        self._pooled = True

    def close(self) -> None:
        try:
            self._cursor.close()
        finally:
            self._conn.close()

    def execute(self, query, params=None) -> Result:
        if params is None:
            self._cursor.execute(query)
        else:
            self._cursor.execute(query, params)
        return Result(self._cursor)

    def cursor(self):
        """A raw cursor context manager, for executemany."""
        return _CursorScope(self._conn)

    def commit(self) -> None:
        self._conn.commit()

    def rollback(self) -> None:
        self._conn.rollback()


class _CursorScope:
    def __init__(self, conn) -> None:
        self._conn = conn
        self._cursor = None

    def __enter__(self):
        self._cursor = self._conn.cursor()
        return self._cursor

    def __exit__(self, exc_type, exc, tb):
        self._cursor.close()
        return False


def _get_connection() -> Connection:
    global _pool_size
    with _pool_lock:
        while _pool:
            conn = _pool.pop()
            try:
                conn.execute("SELECT 1")
                return conn
            except Exception:
                _pool_size = max(0, _pool_size - 1)
                try:
                    conn.close()
                except Exception:
                    pass
        _pool_size += 1
    return Connection()


def _release(conn) -> None:
    """Return a healthy connection to the pool, otherwise close it."""
    global _pool_size
    keep = False
    with _pool_lock:
        if len(_pool) < MAX_POOL:
            _pool.append(conn)
            keep = True
    if not keep:
        with _pool_lock:
            _pool_size = max(0, _pool_size - 1)
        try:
            conn.close()
        except Exception:
            pass


class connection:
    """Pooled connection context manager."""

    def __enter__(self) -> Connection:
        self._conn = _get_connection()
        return self._conn

    def __exit__(self, exc_type, exc, tb) -> bool:
        try:
            if exc_type is None:
                if not self._conn.autocommit:
                    self._conn.commit()
            else:
                self._conn.rollback()
        except Exception:
            pass
        _release(self._conn)
        return False


class tx:
    """Explicit transaction block on a pooled connection."""

    def __enter__(self) -> Connection:
        self._conn = _get_connection()
        self._conn._conn.autocommit = False
        return self._conn

    def __exit__(self, exc_type, exc, tb) -> bool:
        try:
            if exc_type is None:
                self._conn.commit()
            else:
                self._conn.rollback()
        finally:
            self._conn._conn.autocommit = True
            _release(self._conn)
        return False

"""PostgreSQL access: a small bounded pool, transaction helper and the schema.

Every database session a request opens goes back to the pool when the ``with`` block ends, however
it ends. A process never holds more than ``DB_POOL_MAX`` sessions.
"""

from __future__ import annotations

import queue
import threading
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from typing import Any
from urllib.parse import unquote, urlsplit

import pg8000.dbapi

from . import config

Row = dict[str, Any]

# Queries use %s and %(name)s placeholders; pg8000 rewrites both into PostgreSQL's $n form.
pg8000.dbapi.paramstyle = "pyformat"

Error = pg8000.dbapi.Error


class UniqueViolation(pg8000.dbapi.DatabaseError):
    """A unique constraint refused the statement (SQLSTATE 23505)."""


class PoolTimeout(Exception):
    """No database session became free in time."""


class Cursor:
    """A cursor whose rows are dicts keyed by column name; other modules import it from hub.db, never the driver."""

    def __init__(self, raw: pg8000.dbapi.Cursor):
        self._raw = raw

    def execute(self, sql: str, params: Sequence[Any] | Mapping[str, Any] | None = None) -> None:
        try:
            if params:
                self._raw.execute(sql, params)
            else:
                self._raw.execute(sql)
        except pg8000.dbapi.DatabaseError as error:
            detail = error.args[0] if error.args and isinstance(error.args[0], dict) else {}
            if detail.get("C") == "23505":
                raise UniqueViolation(*error.args) from None
            raise

    def _columns(self) -> list[str]:
        return [column[0] for column in self._raw.description or ()]

    def fetchone(self) -> Row | None:
        row = self._raw.fetchone()
        return None if row is None else dict(zip(self._columns(), row))

    def fetchall(self) -> list[Row]:
        names = self._columns()
        return [dict(zip(names, row)) for row in self._raw.fetchall()]

    @property
    def rowcount(self) -> int:
        return self._raw.rowcount


def _connect_args() -> dict[str, Any]:
    url = urlsplit(config.DATABASE_URL)
    return {
        "user": unquote(url.username or ""), "password": unquote(url.password or "") or None,
        "host": url.hostname or "localhost", "port": url.port or 5432,
        "database": unquote(url.path.lstrip("/")) or None, "application_name": "community-hub",
    }


def _connect() -> pg8000.dbapi.Connection:
    """Open a session with the time limits that keep a stuck query or abandoned transaction from holding it."""
    conn = pg8000.dbapi.connect(timeout=30, **_connect_args())
    try:
        cursor = conn.cursor()
        cursor.execute("SET statement_timeout = 300000")
        cursor.execute("SET idle_in_transaction_session_timeout = 120000")
        conn.commit()
    except BaseException:
        conn.close()
        raise
    return conn


class Pool:
    def __init__(self, size: int):
        self._idle: queue.LifoQueue[pg8000.dbapi.Connection] = queue.LifoQueue()
        self._size = size
        self._made = 0
        self._lock = threading.Lock()

    def acquire(self, timeout: float = 15.0) -> pg8000.dbapi.Connection:
        try:
            return self._idle.get_nowait()
        except queue.Empty:
            pass
        with self._lock:
            reserve = self._made < self._size
            if reserve:
                self._made += 1
        if reserve:
            try:
                return _connect()
            except BaseException:
                self.discard()
                raise
        try:
            return self._idle.get(timeout=timeout)
        except queue.Empty as error:
            raise PoolTimeout() from error

    def discard(self, conn: pg8000.dbapi.Connection | None = None) -> None:
        """Forget a session that broke or failed to open, closing it if it exists."""
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
        with self._lock:
            self._made -= 1

    def release(self, conn: pg8000.dbapi.Connection) -> None:
        try:
            conn.rollback()
        except Exception:
            self.discard(conn)
            return
        self._idle.put(conn)


_pool = Pool(config.DB_POOL_MAX)


@contextmanager
def tx() -> Iterator[Cursor]:
    """A cursor inside one transaction: committed when the block ends, rolled back on an exception.

    A session whose socket broke (server restart, network drop) is closed and forgotten instead of reused.
    """
    conn = _pool.acquire()
    try:
        yield Cursor(conn.cursor())
        conn.commit()
    except (pg8000.dbapi.InterfaceError, OSError):
        _pool.discard(conn)
        raise
    except BaseException:
        _pool.release(conn)
        raise
    _pool.release(conn)


def all_rows(sql: str, params: Sequence[Any] | Mapping[str, Any] | None = None) -> list[Row]:
    with tx() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def one_row(sql: str, params: Sequence[Any] | Mapping[str, Any] | None = None) -> Row | None:
    with tx() as cur:
        cur.execute(sql, params)
        return cur.fetchone()


def run(sql: str, params: Sequence[Any] | Mapping[str, Any] | None = None) -> int:
    with tx() as cur:
        cur.execute(sql, params)
        return cur.rowcount


def advisory(cur: Cursor, key: str) -> None:
    """Serialise concurrent work on ``key`` until the transaction ends."""
    cur.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (key,))


def ping() -> bool:
    try:
        with tx() as cur:
            cur.execute("SELECT 1")
        return True
    except (Error, OSError, PoolTimeout):
        return False


SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text NOT NULL);

CREATE TABLE IF NOT EXISTS members (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  email text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  username text NOT NULL,
  display_name text NOT NULL,
  avatar text NOT NULL DEFAULT '',
  password_hash text NOT NULL,
  date_of_birth date NOT NULL,
  status text NOT NULL DEFAULT 'online',
  tier text NOT NULL DEFAULT 'free',
  app_icon text NOT NULL DEFAULT 'classic',
  last_channel_id integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS members_email_key ON members (email);
CREATE UNIQUE INDEX IF NOT EXISTS members_username_key ON members (lower(username));

CREATE TABLE IF NOT EXISTS tokens (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  member_id integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS tokens_member ON tokens (member_id);

CREATE TABLE IF NOT EXISTS email_tokens (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  member_id integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_tokens_member ON email_tokens (member_id);

CREATE TABLE IF NOT EXISTS login_failures (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS login_failures_email ON login_failures (email, created_at);

CREATE TABLE IF NOT EXISTS communities (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  icon text NOT NULL DEFAULT '',
  splash text NOT NULL DEFAULT '',
  banner text NOT NULL DEFAULT '',
  category text NOT NULL,
  keywords text NOT NULL DEFAULT '',
  verified boolean NOT NULL DEFAULT false,
  partnered boolean NOT NULL DEFAULT false,
  published boolean NOT NULL DEFAULT true,
  verification_level text NOT NULL DEFAULT 'none',
  online_baseline integer NOT NULL DEFAULT 0,
  member_baseline integer NOT NULL DEFAULT 0,
  owner_id integer REFERENCES members(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS communities_published ON communities (published, category);

CREATE TABLE IF NOT EXISTS channels (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  community_id integer NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'Text Channels',
  position integer NOT NULL DEFAULT 0,
  topic text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'text',
  slowmode_seconds integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS channels_community ON channels (community_id, position);

CREATE TABLE IF NOT EXISTS memberships (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  member_id integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  community_id integer NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  muted boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  communication_disabled_until timestamptz,
  UNIQUE (member_id, community_id)
);
CREATE INDEX IF NOT EXISTS memberships_community ON memberships (community_id);

CREATE TABLE IF NOT EXISTS roles (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  community_id integer NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name text NOT NULL,
  position integer NOT NULL,
  permissions text[] NOT NULL DEFAULT '{}',
  is_default boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS roles_community ON roles (community_id, position);

CREATE TABLE IF NOT EXISTS member_roles (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  community_id integer NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  member_id integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  role_id integer NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  UNIQUE (member_id, role_id)
);
CREATE INDEX IF NOT EXISTS member_roles_community ON member_roles (community_id, member_id);

CREATE TABLE IF NOT EXISTS channel_overwrites (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  channel_id integer NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  target_type text NOT NULL,
  target_id integer NOT NULL,
  allow text[] NOT NULL DEFAULT '{}',
  deny text[] NOT NULL DEFAULT '{}',
  UNIQUE (channel_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS bans (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  community_id integer NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  member_id integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id, member_id)
);

CREATE TABLE IF NOT EXISTS invites (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  community_id integer NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  inviter_id integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  uses integer NOT NULL DEFAULT 0,
  max_uses integer NOT NULL DEFAULT 0,
  max_age_seconds integer NOT NULL DEFAULT 86400,
  expires_at timestamptz,
  created_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS messages (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  channel_id integer NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  edited_at timestamptz,
  reply_to_id integer REFERENCES messages(id) ON DELETE SET NULL,
  nonce text,
  mentions integer[] NOT NULL DEFAULT '{}',
  ever_mentioned integer[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS messages_channel ON messages (channel_id, id);
CREATE INDEX IF NOT EXISTS messages_reply ON messages (reply_to_id) WHERE reply_to_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_nonce ON messages (author_id, channel_id, nonce) WHERE nonce IS NOT NULL;

CREATE TABLE IF NOT EXISTS reactions (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  message_id integer NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  member_id integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  UNIQUE (message_id, member_id, emoji)
);

CREATE TABLE IF NOT EXISTS attachments (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  uploader_id integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  message_id integer REFERENCES messages(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  filename text NOT NULL,
  size_bytes bigint NOT NULL,
  content_type text NOT NULL,
  sha256 text NOT NULL,
  data bytea NOT NULL,
  width integer,
  height integer,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attachments_message ON attachments (message_id);

CREATE TABLE IF NOT EXISTS read_states (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  member_id integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  channel_id integer NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  last_read_message_id integer,
  UNIQUE (member_id, channel_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  recipient_id integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  message_id integer REFERENCES messages(id) ON DELETE CASCADE,
  community_id integer REFERENCES communities(id) ON DELETE CASCADE,
  actor_id integer REFERENCES members(id) ON DELETE CASCADE,
  kind text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS notifications_recipient ON notifications (recipient_id, id DESC);
CREATE INDEX IF NOT EXISTS notifications_message ON notifications (message_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  member_id integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  tier text NOT NULL,
  amount_cents integer NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscriptions_member ON subscriptions (member_id);

CREATE TABLE IF NOT EXISTS checkout_replays (
  member_id integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  key text NOT NULL,
  fingerprint text NOT NULL,
  status integer NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, key)
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  reference text NOT NULL DEFAULT '',
  email text NOT NULL,
  category text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS support_tickets_email ON support_tickets (lower(email), created_at);

CREATE TABLE IF NOT EXISTS page_views (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  path text NOT NULL,
  visitor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbox (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  recipient text NOT NULL,
  recipient_name text,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_pending ON outbox (id) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS live_events (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  type text NOT NULL,
  community_id integer,
  channel_id integer,
  member_id integer,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE attachments ALTER COLUMN data SET STORAGE EXTERNAL;
CREATE INDEX IF NOT EXISTS live_events_created ON live_events (created_at);
"""

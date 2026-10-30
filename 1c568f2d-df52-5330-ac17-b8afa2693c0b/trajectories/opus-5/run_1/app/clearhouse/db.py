"""Postgres access: a small pool, the schema and the boot sequence."""
import queue
import threading
from contextlib import contextmanager
from urllib.parse import unquote, urlparse

import pg8000.dbapi as driver

from . import config

driver.paramstyle = "pyformat"
Broken = (driver.InterfaceError, driver.OperationalError)

SCHEMA = """
create table if not exists accounts (
  id text primary key,
  email text not null,
  name text not null,
  role text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists accounts_email_key on accounts (lower(email));

create table if not exists sessions (
  token text primary key,
  account_id text not null references accounts(id),
  created_at timestamptz not null default now()
);

create table if not exists login_failures (
  id bigserial primary key,
  email text not null,
  created_at timestamptz not null default now()
);
create index if not exists login_failures_email_idx on login_failures (email, created_at);

create table if not exists objects (
  id integer primary key,
  title text not null,
  image_title text not null,
  page_url text not null,
  article_url text not null,
  description text not null,
  extract text not null,
  license text not null,
  license_url text not null,
  artist text not null,
  image_desc_url text not null,
  width integer not null,
  height integer not null,
  cutout_id integer not null,
  mask_w integer not null,
  mask_h integer not null,
  mask_b integer not null,
  shuffle_rank integer not null
);
create index if not exists objects_cutout_idx on objects (cutout_id);
create index if not exists objects_mask_idx on objects (mask_b);

create table if not exists pieces (
  id bigserial primary key,
  title text not null,
  summary text not null,
  fee_cents integer not null,
  submitted_fee_cents integer not null,
  state text not null,
  owner_id text not null references accounts(id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  cleared_at timestamptz
);
create unique index if not exists pieces_title_key
  on pieces (lower(title)) where state <> 'rejected';

create table if not exists piece_objects (
  piece_id bigint not null references pieces(id),
  object_id integer not null references objects(id),
  position integer not null,
  primary key (piece_id, object_id)
);

create table if not exists reviews (
  id bigserial primary key,
  piece_id bigint not null references pieces(id),
  kind text not null,
  reviewer_id text not null references accounts(id),
  result text not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (piece_id, kind)
);

create table if not exists duplicate_acks (
  piece_id bigint not null references pieces(id),
  object_id integer not null references objects(id),
  duplicate_object_id integer not null references objects(id),
  acknowledged_by text not null references accounts(id),
  acknowledged_at timestamptz not null default now(),
  primary key (piece_id, object_id, duplicate_object_id)
);

create table if not exists schedule_slots (
  day date primary key,
  piece_id bigint not null unique references pieces(id),
  view_count integer not null default 0
);

create table if not exists budgets (
  quarter text primary key,
  budget_cents integer not null
);

create table if not exists audit_entries (
  id bigserial primary key,
  piece_id bigint not null references pieces(id),
  actor_id text not null references accounts(id),
  from_state text not null default '',
  to_state text not null,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists audit_piece_idx on audit_entries (piece_id);

create table if not exists preferences (
  account_id text primary key references accounts(id),
  rows_per_page integer not null default 50,
  date_display text not null default 'relative',
  high_contrast boolean not null default false
);
"""

BOOT_LOCK = 724193


class Result:
    """Rows as dictionaries, read in full so the cursor can close at once."""

    def __init__(self, cursor):
        names = [column[0] for column in cursor.description or []]
        self._rows = [dict(zip(names, row)) for row in cursor.fetchall()] if names else []

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return self._rows


class Connection:
    def __init__(self, raw):
        self._raw = raw
        self.closed = False

    def execute(self, sql, params=None):
        cursor = self._raw.cursor()
        try:
            cursor.execute(sql, params if params else ())
            return Result(cursor)
        finally:
            cursor.close()

    def executemany(self, sql, batch):
        cursor = self._raw.cursor()
        try:
            cursor.executemany(sql, batch)
        finally:
            cursor.close()

    def commit(self):
        self._raw.commit()

    def rollback(self):
        self._raw.rollback()

    def close(self):
        self.closed = True
        self._raw.close()


class Pool:
    def __init__(self, dsn, size=10):
        self._dsn = dsn
        self._size = size
        self._free = queue.LifoQueue()
        self._made = 0
        self._guard = threading.Lock()

    def _open(self):
        url = urlparse(self._dsn)
        return Connection(
            driver.connect(
                user=unquote(url.username or ""),
                password=unquote(url.password or ""),
                host=url.hostname or "localhost",
                port=url.port or 5432,
                database=(url.path or "").lstrip("/"),
            )
        )

    def acquire(self):
        try:
            conn = self._free.get_nowait()
        except queue.Empty:
            with self._guard:
                if self._made < self._size:
                    self._made += 1
                    return self._open()
            conn = self._free.get(timeout=20)
        if conn.closed:
            return self._open()
        return conn

    def release(self, conn, broken=False):
        if broken or conn.closed:
            try:
                conn.close()
            except Exception:
                pass
            with self._guard:
                self._made -= 1
            return
        self._free.put(conn)


_pool = Pool(config.DATABASE_URL)


@contextmanager
def tx():
    """One transaction. A refused or failed write leaves nothing behind."""
    conn = _pool.acquire()
    broken = False
    try:
        yield conn
        conn.commit()
    except BaseException as exc:
        broken = isinstance(exc, Broken)
        if not broken:
            try:
                conn.rollback()
            except Exception:
                broken = True
        raise
    finally:
        _pool.release(conn, broken)


def rows(conn, sql, params=()):
    return conn.execute(sql, params).fetchall()


def row(conn, sql, params=()):
    return conn.execute(sql, params).fetchone()


def value(conn, sql, params=()):
    got = row(conn, sql, params)
    return None if got is None else next(iter(got.values()))


_booted = threading.Event()


def ready():
    return _booted.is_set()


def boot():
    """Create the schema and run the seed, idempotently, under one lock."""
    from . import seed

    with tx() as conn:
        conn.execute("select pg_advisory_lock(%s)", (BOOT_LOCK,))
        try:
            conn.execute(SCHEMA)
            seed.run(conn)
        finally:
            conn.execute("select pg_advisory_unlock(%s)", (BOOT_LOCK,))
    _booted.set()


def boot_forever():
    while not _booted.is_set():
        try:
            boot()
        except Exception as exc:  # postgres not ready yet: keep retrying
            print("boot retry:", exc, flush=True)
            threading.Event().wait(2)

"""PostgreSQL access: a small connection pool, readiness and the outage signal.

Nothing here touches the database at import time. The first request starts a
background thread that applies the schema and the seed and keeps retrying while
PostgreSQL is unreachable, so the server listens either way.
"""

import threading
import time
from contextlib import contextmanager
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from . import config

SCHEMA_PATH = Path(__file__).with_name("schema.sql")
SEED_LOCK_KEY = 772411563
IDLE_POOL_SIZE = 8
CONNECTION_MAX_AGE_SECONDS = 180
CONNECT_TIMEOUT_SECONDS = 3
RETRY_QUIET_SECONDS = 2
SESSION_OPTIONS = "-c statement_timeout=8000"
KEEPALIVE_SETTINGS = {
    "keepalives": 1,
    "keepalives_idle": 5,
    "keepalives_interval": 2,
    "keepalives_count": 2,
    "tcp_user_timeout": 3000,
}

_idle: list[tuple[psycopg.Connection, float]] = []
_idle_lock = threading.Lock()

_ready = False
_last_failure = 0.0
_keeper_started = False
_keeper_lock = threading.Lock()


class DatabaseUnavailable(Exception):
    """PostgreSQL could not be reached for this request."""


def _is_unavailable(exc: Exception) -> bool:
    state = getattr(exc, "sqlstate", None)
    return state is None or state.startswith("08") or state.startswith("57P")


def _connect() -> psycopg.Connection:
    try:
        return psycopg.connect(
            config.DATABASE_URL,
            autocommit=True,
            row_factory=dict_row,
            connect_timeout=CONNECT_TIMEOUT_SECONDS,
            options=SESSION_OPTIONS,
            **KEEPALIVE_SETTINGS,
        )
    except psycopg.Error as exc:
        raise DatabaseUnavailable(str(exc)) from exc


def _discard(conn: psycopg.Connection) -> None:
    try:
        conn.close()
    except psycopg.Error:
        pass


def _drop_idle() -> None:
    with _idle_lock:
        stale = list(_idle)
        _idle.clear()
    for conn, _ in stale:
        _discard(conn)


def _acquire() -> psycopg.Connection:
    """A live connection: pooled ones are proved before they are handed out."""
    while True:
        with _idle_lock:
            if not _idle:
                break
            conn, stored_at = _idle.pop()
        if conn.closed or time.monotonic() - stored_at > CONNECTION_MAX_AGE_SECONDS:
            _discard(conn)
            continue
        try:
            conn.execute("SELECT 1")
        except psycopg.Error:
            _discard(conn)
            _drop_idle()
            break
        return conn
    return _connect()


def _release(conn: psycopg.Connection) -> None:
    if conn.closed:
        return
    with _idle_lock:
        if len(_idle) < IDLE_POOL_SIZE:
            _idle.append((conn, time.monotonic()))
            return
    _discard(conn)


@contextmanager
def transaction():
    """Run one block in one transaction, so multi-row changes commit together."""
    global _ready, _last_failure
    conn = _acquire()
    try:
        with conn.transaction():
            yield conn
    except psycopg.Error as exc:
        _discard(conn)
        if _is_unavailable(exc):
            _ready = False
            _last_failure = time.monotonic()
            raise DatabaseUnavailable(str(exc)) from exc
        raise
    except Exception:
        _release(conn)
        raise
    else:
        _release(conn)


def health_ready() -> bool:
    """Whether PostgreSQL answers right now and the seed has been applied.

    A database that just refused a connection is not retried straight away, so
    health keeps answering quickly through an outage.
    """
    global _ready
    if not _ready:
        if time.monotonic() - _last_failure < RETRY_QUIET_SECONDS:
            return False
        if not _try_ready():
            return False
        _ready = True
        return True
    try:
        with transaction() as conn:
            conn.execute("SELECT 1")
    except DatabaseUnavailable:
        return False
    return True


def _try_ready() -> bool:
    global _last_failure
    try:
        apply_schema_and_seed()
    except (DatabaseUnavailable, psycopg.Error):
        _last_failure = time.monotonic()
        return False
    return True


def apply_schema_and_seed() -> None:
    """Idempotent startup work, guarded by an advisory lock for two instances."""
    from .seed import seed_everything

    with transaction() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(%s)", (SEED_LOCK_KEY,))
        conn.execute(SCHEMA_PATH.read_text(encoding="utf-8"))
        seed_everything(conn)


def _keeper() -> None:
    global _ready
    while True:
        if not _ready and _try_ready():
            _ready = True
        time.sleep(1)


def start_keeper() -> None:
    global _keeper_started
    with _keeper_lock:
        if _keeper_started:
            return
        _keeper_started = True
    threading.Thread(target=_keeper, name="mela-db-keeper", daemon=True).start()

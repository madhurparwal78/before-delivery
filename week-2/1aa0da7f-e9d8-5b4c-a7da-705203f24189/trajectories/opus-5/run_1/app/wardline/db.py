"""PostgreSQL access: pooling, transactions and cross-process locks."""

from __future__ import annotations

import pathlib
import threading
import time
from contextlib import contextmanager
from typing import Any, Iterator

import psycopg2
import psycopg2.extras
import psycopg2.pool

from .config import CONFIG

SCHEMA_PATH = pathlib.Path(__file__).with_name("schema.sql")

LOCK_LEDGER = 1
LOCK_COMPARTMENT = 2
LOCK_EXHIBIT = 3
LOCK_SEED = 4
LOCK_RELEASE = 5
LOCK_LINK = 6

_pool: psycopg2.pool.ThreadedConnectionPool | None = None
_pool_lock = threading.Lock()
_ready = threading.Event()


class DatabaseUnavailable(Exception):
    """The database could not be reached."""


def _get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pool
    with _pool_lock:
        if _pool is None:
            try:
                _pool = psycopg2.pool.ThreadedConnectionPool(
                    1, 32, CONFIG.database_url, connect_timeout=5
                )
            except psycopg2.Error as exc:
                raise DatabaseUnavailable(str(exc)) from exc
        return _pool


def _drop_pool() -> None:
    global _pool
    with _pool_lock:
        if _pool is not None:
            try:
                _pool.closeall()
            except psycopg2.Error:
                pass
            _pool = None


@contextmanager
def connection() -> Iterator[Any]:
    pool = _get_pool()
    try:
        conn = pool.getconn()
    except psycopg2.Error as exc:
        _drop_pool()
        raise DatabaseUnavailable(str(exc)) from exc
    broken = False
    try:
        yield conn
    except psycopg2.OperationalError as exc:
        broken = True
        raise DatabaseUnavailable(str(exc)) from exc
    finally:
        try:
            if broken:
                conn.close()
                pool.putconn(conn, close=True)
            else:
                pool.putconn(conn)
        except psycopg2.Error:
            pass


@contextmanager
def tx() -> Iterator[Any]:
    """A transaction yielding a dict cursor, committed on a clean exit."""
    with connection() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            yield cur
            conn.commit()
        except BaseException:
            try:
                conn.rollback()
            except psycopg2.Error:
                pass
            raise
        finally:
            cur.close()


def take_lock(cur: Any, kind: int, key: str | int) -> None:
    """Take a transaction-scoped advisory lock shared by every running copy."""
    if isinstance(key, int):
        second = key
    else:
        second = _text_key(key)
    cur.execute("SELECT pg_advisory_xact_lock(%s, %s)", (kind, second))


def _text_key(key: str) -> int:
    import hashlib

    digest = hashlib.sha256(key.encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big", signed=True)


def next_id(cur: Any, prefix: str, width: int = 4) -> str:
    cur.execute(
        """
        INSERT INTO id_counters (prefix, n) VALUES (%s, 1)
        ON CONFLICT (prefix) DO UPDATE SET n = id_counters.n + 1
        RETURNING n
        """,
        (prefix,),
    )
    n = cur.fetchone()["n"]
    return f"{prefix}-{n:0{width}d}"


def reserve_id(cur: Any, prefix: str, value: int) -> None:
    cur.execute(
        """
        INSERT INTO id_counters (prefix, n) VALUES (%s, %s)
        ON CONFLICT (prefix) DO UPDATE SET n = GREATEST(id_counters.n, EXCLUDED.n)
        """,
        (prefix, value),
    )


def is_ready() -> bool:
    return _ready.is_set()


def apply_schema() -> None:
    sql = SCHEMA_PATH.read_text(encoding="utf-8")
    with tx() as cur:
        take_lock(cur, LOCK_SEED, 1)
        cur.execute(sql)
    protect_ledger()
    _ready.set()


def protect_ledger() -> None:
    """Remove write rights on the ledger from every login and reinstall triggers."""
    with tx() as cur:
        cur.execute("SELECT current_user AS login")
        login = cur.fetchone()["login"]
        cur.execute(
            "REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entries FROM PUBLIC"
        )
        cur.execute(
            f'REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entries FROM "{login}"'
        )
        cur.execute(
            """
            SELECT rolname FROM pg_roles
            WHERE rolname NOT LIKE 'pg\\_%%' AND rolname <> %s AND rolcanlogin
            """,
            (login,),
        )
        for row in cur.fetchall():
            name = row["rolname"].replace('"', '""')
            cur.execute(
                f'REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entries FROM "{name}"'
            )


def wait_for_database(stop: threading.Event) -> None:
    while not stop.is_set():
        try:
            apply_schema()
            return
        except (DatabaseUnavailable, psycopg2.Error):
            _drop_pool()
            time.sleep(1.0)

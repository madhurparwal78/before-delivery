"""Postgres access: a small thread-safe pool and a transaction helper."""

import contextlib
import queue
import threading
import urllib.parse

import pg8000.dbapi

from .config import config

_POOL_SIZE = 12


def _dsn():
    parsed = urllib.parse.urlparse(config.database_url)
    return {
        "host": parsed.hostname or "localhost",
        "port": parsed.port or 5432,
        "database": (parsed.path or "/").lstrip("/"),
        "user": urllib.parse.unquote(parsed.username or ""),
        "password": urllib.parse.unquote(parsed.password or ""),
    }


class Pool:
    def __init__(self):
        self._idle = queue.LifoQueue()
        self._lock = threading.Lock()
        self._opened = 0

    def _connect(self):
        conn = pg8000.dbapi.Connection(**_dsn(), timeout=10)
        conn.autocommit = False
        return conn

    def acquire(self):
        try:
            return self._idle.get_nowait()
        except queue.Empty:
            pass
        with self._lock:
            if self._opened < _POOL_SIZE:
                self._opened += 1
                try:
                    return self._connect()
                except Exception:
                    self._opened -= 1
                    raise
        return self._idle.get(timeout=30)

    def release(self, conn, broken=False):
        if broken:
            with contextlib.suppress(Exception):
                conn.close()
            with self._lock:
                self._opened -= 1
            return
        self._idle.put(conn)


pool = Pool()


class Cursor:
    """Thin cursor wrapper returning dict rows."""

    def __init__(self, cursor):
        self._cursor = cursor

    def execute(self, sql, params=()):
        self._cursor.execute(sql, params)
        return self

    def _columns(self):
        return [c[0] if isinstance(c[0], str) else c[0].decode() for c in self._cursor.description]

    def all(self, sql=None, params=()):
        if sql is not None:
            self.execute(sql, params)
        columns = self._columns()
        return [dict(zip(columns, row)) for row in self._cursor.fetchall()]

    def one(self, sql=None, params=()):
        rows = self.all(sql, params)
        return rows[0] if rows else None

    def value(self, sql=None, params=()):
        row = self.one(sql, params)
        return None if row is None else next(iter(row.values()))

    @property
    def rowcount(self):
        return self._cursor.rowcount


@contextlib.contextmanager
def transaction():
    """One database transaction. Multi-step atomic changes run inside one of these."""
    conn = pool.acquire()
    cursor = conn.cursor()
    try:
        yield Cursor(cursor)
        conn.commit()
    except Exception:
        with contextlib.suppress(Exception):
            conn.rollback()
        with contextlib.suppress(Exception):
            cursor.close()
        pool.release(conn, broken=not _alive(conn))
        raise
    cursor.close()
    pool.release(conn)


def _alive(conn):
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1")
        cur.close()
        conn.rollback()
        return True
    except Exception:
        return False

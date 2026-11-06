"""PostgreSQL access: a small thread-safe pool and transaction helpers."""
import contextlib
import queue
import threading
import time

import pg8000.dbapi
from pg8000.exceptions import DatabaseError, InterfaceError

from . import config

pg8000.dbapi.paramstyle = "format"

_POOL_SIZE = 24


class _Pool:
    def __init__(self, size):
        self._idle = queue.LifoQueue()
        self._capacity = threading.Semaphore(size)

    def _connect(self):
        connection = pg8000.dbapi.connect(**config.database_params())
        connection.autocommit = True
        cursor = connection.cursor()
        cursor.execute("SET TIME ZONE 'UTC'")
        cursor.close()
        return connection

    def drain(self):
        while True:
            try:
                conn = self._idle.get_nowait()
            except queue.Empty:
                return
            with contextlib.suppress(Exception):
                conn.close()

    @contextlib.contextmanager
    def connection(self):
        self._capacity.acquire()
        try:
            try:
                conn = self._idle.get_nowait()
            except queue.Empty:
                conn = self._connect()
            try:
                yield conn
            except (InterfaceError, OSError):
                with contextlib.suppress(Exception):
                    conn.close()
                raise
            except Exception:
                with contextlib.suppress(Exception):
                    conn.rollback()
                self._idle.put(conn)
                raise
            else:
                self._idle.put(conn)
        finally:
            self._capacity.release()


_pool = _Pool(_POOL_SIZE)


def close_idle():
    """Drop pooled connections, so a forked child opens its own."""
    _pool.drain()


class Cursor:
    """A thin cursor wrapper that returns rows as dictionaries."""

    def __init__(self, raw):
        self._raw = raw

    def execute(self, sql, params=()):
        self._raw.execute(sql, params)
        return self

    def _columns(self):
        return [d[0] for d in self._raw.description]

    def one(self, sql, params=()):
        self._raw.execute(sql, params)
        row = self._raw.fetchone()
        if row is None:
            return None
        return dict(zip(self._columns(), row))

    def all(self, sql, params=()):
        self._raw.execute(sql, params)
        columns = self._columns()
        return [dict(zip(columns, row)) for row in self._raw.fetchall()]

    def value(self, sql, params=()):
        self._raw.execute(sql, params)
        row = self._raw.fetchone()
        return None if row is None else row[0]

    @property
    def rowcount(self):
        return self._raw.rowcount


@contextlib.contextmanager
def tx():
    """Run a block in one transaction, committing only on a clean return."""
    with _pool.connection() as conn:
        conn.autocommit = False
        cur = conn.cursor()
        try:
            yield Cursor(cur)
        except BaseException:
            with contextlib.suppress(Exception):
                conn.rollback()
            raise
        else:
            conn.commit()
        finally:
            with contextlib.suppress(Exception):
                cur.close()
            conn.autocommit = True


def wait_until_reachable(attempts=None):
    """Block until a connection succeeds, retrying for ever by default."""
    tries = 0
    while True:
        tries += 1
        try:
            with tx() as cur:
                cur.value("SELECT 1")
            return True
        except (DatabaseError, InterfaceError, OSError):
            if attempts is not None and tries >= attempts:
                return False
            time.sleep(1.0)


def reachable():
    try:
        with tx() as cur:
            cur.value("SELECT 1")
        return True
    except (DatabaseError, InterfaceError, OSError):
        return False

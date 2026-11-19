"""PostgreSQL access: a small thread-safe pool and one transaction helper."""
import queue
import threading
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row

from . import config


class Pool:
    def __init__(self, dsn: str, size: int) -> None:
        self._dsn = dsn
        self._idle: queue.LifoQueue = queue.LifoQueue()
        self._slots = threading.BoundedSemaphore(size)

    def _open(self) -> psycopg.Connection:
        return psycopg.connect(self._dsn, row_factory=dict_row, autocommit=False)

    @contextmanager
    def connection(self):
        self._slots.acquire()
        conn = None
        try:
            while conn is None:
                try:
                    candidate = self._idle.get_nowait()
                except queue.Empty:
                    conn = self._open()
                else:
                    if candidate.closed or candidate.broken:
                        continue
                    conn = candidate
            yield conn
        finally:
            if conn is not None:
                try:
                    if not conn.closed:
                        conn.rollback()
                    self._idle.put(conn)
                except psycopg.Error:
                    pass
            self._slots.release()


_pool: Pool | None = None
_pool_lock = threading.Lock()


def pool() -> Pool:
    global _pool
    with _pool_lock:
        if _pool is None:
            if not config.DATABASE_URL:
                raise RuntimeError("DATABASE_URL is not set")
            _pool = Pool(config.DATABASE_URL, config.POOL_SIZE)
        return _pool


@contextmanager
def tx():
    """One transaction: commit on success, roll back on any exception."""
    with pool().connection() as conn:
        try:
            yield conn
        except BaseException:
            conn.rollback()
            raise
        else:
            conn.commit()


def one(conn, sql: str, params=()):
    return conn.execute(sql, params).fetchone()


def all_(conn, sql: str, params=()):
    return conn.execute(sql, params).fetchall()

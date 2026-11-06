"""The one way to postgres: a small connection pool and a transaction that commits or rolls back as a unit."""

import queue
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from urllib.parse import unquote, urlsplit

import pg8000.native

from .config import settings

Row = dict[str, object]


def connect(timeout: float = 10) -> pg8000.native.Connection:
    url = urlsplit(settings.database_url)
    conn = pg8000.native.Connection(
        user=unquote(url.username or ""),
        password=unquote(url.password or ""),
        host=url.hostname or "localhost",
        port=url.port or 5432,
        database=url.path.lstrip("/") or None,
        timeout=timeout,
        application_name="clearhouse",
    )
    conn.run("SET TIME ZONE 'UTC'")
    return conn


class Tx:
    """One open transaction; every query returns rows as dicts keyed by column name."""

    def __init__(self, conn: pg8000.native.Connection) -> None:
        self.conn = conn

    def rows(self, sql: str, **params: object) -> list[Row]:
        result = self.conn.run(sql, **params) or []
        names = [c["name"] for c in self.conn.columns or []]
        return [dict(zip(names, row, strict=True)) for row in result]

    def one(self, sql: str, **params: object) -> Row | None:
        found = self.rows(sql, **params)
        return found[0] if found else None

    def value(self, sql: str, **params: object) -> object:
        result = self.conn.run(sql, **params)
        return result[0][0] if result else None

    def run(self, sql: str, **params: object) -> None:
        self.conn.run(sql, **params)


class Pool:
    def __init__(self, size: int = 12) -> None:
        self.idle: queue.LifoQueue[pg8000.native.Connection] = queue.LifoQueue()
        self.slots = threading.BoundedSemaphore(size)

    def acquire(self) -> pg8000.native.Connection:
        self.slots.acquire()
        try:
            return self.idle.get_nowait()
        except queue.Empty:
            try:
                return connect()
            except BaseException:
                self.slots.release()
                raise

    def release(self, conn: pg8000.native.Connection | None) -> None:
        if conn is not None:
            self.idle.put(conn)
        self.slots.release()


pool = Pool()


@contextmanager
def transaction() -> Iterator[Tx]:
    conn = pool.acquire()
    try:
        conn.run("BEGIN")
        yield Tx(conn)
        conn.run("COMMIT")
    except BaseException:
        try:
            conn.run("ROLLBACK")
        except Exception:
            conn = None
        raise
    finally:
        pool.release(conn)


def wait_until_ready() -> None:
    """Start-up keeps retrying until postgres answers."""
    while True:
        try:
            connect(timeout=5).close()
            return
        except Exception as error:
            print(f"[clearhouse] waiting for postgres: {error}", flush=True)
            time.sleep(2)

"""PostgreSQL access: a small pg8000 connection pool, one-transaction blocks and the schema."""
import logging
import queue
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import unquote, urlsplit

import pg8000.native

from . import config
from .refusals import ApiError

log = logging.getLogger("tessel.db")
POOL_SIZE = 32


def _connect() -> pg8000.native.Connection:
    url = urlsplit(config.DATABASE_URL)
    return pg8000.native.Connection(
        user=unquote(url.username or ""), password=unquote(url.password or "") or None,
        host=url.hostname or "localhost", port=url.port or 5432, database=unquote(url.path.lstrip("/")) or None,
        application_name="tessel", timeout=30)


class Pool:
    """Up to POOL_SIZE open connections, handed out one per transaction."""

    def __init__(self):
        self.idle: queue.LifoQueue = queue.LifoQueue()
        self.slots = threading.BoundedSemaphore(POOL_SIZE)

    def take(self) -> pg8000.native.Connection:
        self.slots.acquire()
        try:
            return self.idle.get_nowait()
        except queue.Empty:
            try:
                return _connect()
            except BaseException:
                self.slots.release()
                raise

    def give(self, con, broken: bool = False) -> None:
        if broken:
            try:
                con.close()
            except Exception:  # noqa: BLE001 -- a broken socket may refuse even the close
                pass
        else:
            self.idle.put(con)
        self.slots.release()


pool = Pool()


class Tx:
    """One open transaction; statements take named parameters (`:name`)."""

    def __init__(self, con):
        self.con = con

    def rows(self, sql: str, **params) -> list[dict]:
        found = self.con.run(sql, **params)
        names = [c["name"] for c in (self.con.columns or [])]
        return [dict(zip(names, r)) for r in found] if names else []

    def one(self, sql: str, **params) -> dict | None:
        found = self.rows(sql, **params)
        return found[0] if found else None

    def run(self, sql: str, **params) -> None:
        self.con.run(sql, **params)


@contextmanager
def tx():
    """A transaction that commits on success, or on a refusal marked `commit` (accounting a refusal may keep)."""
    con = pool.take()
    broken = False
    try:
        con.run("BEGIN")
        try:
            yield Tx(con)
        except ApiError as err:
            con.run("COMMIT" if err.commit else "ROLLBACK")
            raise
        except BaseException:
            con.run("ROLLBACK")
            raise
        con.run("COMMIT")
    except (pg8000.native.InterfaceError, OSError):
        broken = True
        raise
    finally:
        pool.give(con, broken)


def error_code(exc: BaseException) -> str | None:
    """The SQLSTATE of a PostgreSQL error, if it is one."""
    if isinstance(exc, pg8000.native.DatabaseError) and exc.args and isinstance(exc.args[0], dict):
        return exc.args[0].get("C")
    return None


def wait_until_reachable() -> None:
    """Block until PostgreSQL answers, retrying every second."""
    while True:
        try:
            with tx() as t:
                t.run("SELECT 1")
            return
        except Exception as exc:  # noqa: BLE001 -- any failure means not reachable yet
            log.warning("PostgreSQL not reachable yet (%s); retrying", type(exc).__name__)
            time.sleep(1)


def migrate() -> None:
    statements = [s.strip() for s in (Path(__file__).parent / "schema.sql").read_text().split(";\n") if s.strip()]
    with tx() as t:
        t.run("SELECT pg_advisory_xact_lock(731101)")
        for statement in statements:
            t.run(statement)

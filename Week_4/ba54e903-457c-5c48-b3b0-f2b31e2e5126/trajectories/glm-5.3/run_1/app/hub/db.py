"""PostgreSQL access: a bounded pool (at most 20 sessions per instance, DP-97)."""
from __future__ import annotations

import threading
import time
from contextlib import contextmanager
from typing import Iterator, Optional

from .pgwire import Connection, PgError

MAX_SESSIONS = 20


class Database:
    def __init__(self, config) -> None:
        self._config = config
        self._pool: list[Connection] = []
        self._pool_lock = threading.Lock()
        self._checked_out: set[int] = set()
        self._ready = False
        self._failure = ""

    @property
    def ready(self) -> bool:
        return self._ready

    @property
    def failure(self) -> str:
        return self._failure

    def _new_connection(self) -> Connection:
        conn = Connection(self._config.database_url, autocommit=True)
        # Bounded work: cap any statement so abandoned clients cannot pin sessions.
        conn.execute("SET statement_timeout = '30s'")
        conn.execute("SET idle_in_transaction_session_timeout = '5s'")
        return conn

    def _open_count(self) -> int:
        return len(self._pool) + len(self._checked_out)

    def close(self) -> None:
        with self._pool_lock:
            for conn in self._pool:
                try:
                    conn.close()
                except Exception:
                    pass
            self._pool = []

    @contextmanager
    def session(self) -> Iterator[Connection]:
        """Check a session out of the pool; every caller releases it however it ends."""
        conn = self.acquire()
        try:
            yield conn
        finally:
            self.release(conn)

    def acquire(self) -> Connection:
        deadline = time.monotonic() + 5.0
        last_error: Optional[Exception] = None
        while time.monotonic() < deadline:
            with self._pool_lock:
                if self._pool:
                    conn = self._pool.pop()
                    self._checked_out.add(id(conn))
                    return conn
                if len(self._checked_out) >= MAX_SESSIONS:
                    last_error = RuntimeError("pool exhausted")
                else:
                    break
            time.sleep(0.02)
        if last_error is not None:
            raise last_error
        conn = self._new_connection()
        with self._pool_lock:
            self._checked_out.add(id(conn))
        return conn

    def release(self, conn: Connection) -> None:
        with self._pool_lock:
            self._checked_out.discard(id(conn))
        broken = True
        try:
            if not conn.closed and conn._in_transaction is False:
                broken = False
        except Exception:
            broken = True
        if broken:
            try:
                conn.close()
            except Exception:
                pass
            return
        with self._pool_lock:
            self._pool.append(conn)
            while len(self._pool) > MAX_SESSIONS:
                extra = self._pool.pop()
                try:
                    extra.close()
                except Exception:
                    pass

    def ping(self) -> bool:
        try:
            with self.session() as conn:
                conn.execute("SELECT 1")
            self._ready = True
            self._failure = ""
            return True
        except Exception as exc:  # database down at boot: stay up, mark unready
            self._ready = False
            self._failure = str(exc)
            return False

    # ---- small helpers used everywhere ----

    def one(self, sql: str, args: tuple = ()) -> Optional[dict]:
        with self.session() as conn:
            return conn.fetchone(sql, self._wrap(args))

    def all(self, sql: str, args: tuple = ()) -> list[dict]:
        with self.session() as conn:
            return conn.fetchall(sql, self._wrap(args))

    def execute(self, sql: str, args: tuple = ()) -> None:
        with self.session() as conn:
            conn.execute(sql, self._wrap(args))

    def insert(self, sql: str, args: tuple = ()) -> int:
        with self.session() as conn:
            row = conn.fetchone(sql + " RETURNING id", self._wrap(args))
            return int(row["id"])

    @staticmethod
    def _wrap(args) -> tuple:
        if args is None:
            return ()
        if isinstance(args, (list, set)):
            return tuple(args)
        if isinstance(args, tuple):
            return args
        return (args,)

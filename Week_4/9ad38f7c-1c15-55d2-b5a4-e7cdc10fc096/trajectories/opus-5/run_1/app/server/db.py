"""PostgreSQL access: a small pool, an outage-safe call path and the clock.

Every statement runs inside one transaction so that simultaneous changes are
settled by the database. Lock and throttle times are read from the database
clock, never from the Python clock.
"""

from __future__ import annotations

import asyncio
import hashlib
import socket
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pg8000.dbapi
import pg8000.exceptions

from .config import (
    DB_CONNECT_TIMEOUT_SECONDS,
    DB_REQUEST_BUDGET_SECONDS,
    DB_STATEMENT_TIMEOUT_MS,
    SETTINGS,
    DatabaseSettings,
)

OUTAGE_WINDOW_SECONDS = 0.4

LOCK_CLASS_MIGRATION = 1947
LOCK_CLASS_TEAM = 11
LOCK_CLASS_SIGN_IN = 12
LOCK_CLASS_FLAG = 13

INT32_SPAN = 1 << 32


class DatabaseUnavailable(Exception):
    """Raised when the database cannot be reached or a statement failed."""


def key32(*parts: object) -> int:
    """A signed 32-bit advisory-lock key for the given parts."""
    digest = hashlib.sha256("\x1f".join(str(part) for part in parts).encode()).digest()
    value = int.from_bytes(digest[:4], "big")
    return value - INT32_SPAN if value >= INT32_SPAN // 2 else value


class Transaction:
    """One open transaction, exposing only the query helpers routes need."""

    def __init__(self, cursor: Any) -> None:
        self._cursor = cursor

    def execute(self, sql: str, params: tuple[Any, ...] = ()) -> None:
        self._cursor.execute(sql, params)

    def rows(self, sql: str, params: tuple[Any, ...] = ()) -> list[list[Any]]:
        self._cursor.execute(sql, params)
        return list(self._cursor.fetchall() or [])

    def row(self, sql: str, params: tuple[Any, ...] = ()) -> list[Any] | None:
        found = self.rows(sql, params)
        return found[0] if found else None

    def value(self, sql: str, params: tuple[Any, ...] = ()) -> Any:
        found = self.row(sql, params)
        return None if found is None else found[0]

    def now(self):
        return self.value("SELECT now()")

    def lock(self, lock_class: int, key: int) -> None:
        self.execute("SELECT pg_advisory_xact_lock(%s, %s)", (lock_class, key))


class Database:
    def __init__(self, settings: DatabaseSettings) -> None:
        self._settings = settings
        self._idle: list[Any] = []
        self._guard = threading.Lock()
        self._executor = ThreadPoolExecutor(
            max_workers=16, thread_name_prefix="downtime-db"
        )
        self._unreachable_until = 0.0
        self.seeded = False

    def _unreachable(self) -> bool:
        """While the database is out, refuse at once rather than queue up waits."""
        return time.monotonic() < self._unreachable_until

    def _note_unreachable(self) -> None:
        self._unreachable_until = time.monotonic() + OUTAGE_WINDOW_SECONDS

    # -- connections ----------------------------------------------------
    def _open(self) -> Any:
        try:
            connection = pg8000.dbapi.connect(
                user=self._settings.user,
                password=self._settings.password,
                host=self._settings.host,
                port=self._settings.port,
                database=self._settings.database,
                timeout=DB_CONNECT_TIMEOUT_SECONDS,
                application_name="downtime",
            )
            cursor = connection.cursor()
            cursor.execute(f"SET statement_timeout = {DB_STATEMENT_TIMEOUT_MS}")
            cursor.execute("SET idle_in_transaction_session_timeout = 10000")
            cursor.execute("SET TIME ZONE 'UTC'")
            connection.commit()
        except Exception as error:  # every failure is an outage
            self._note_unreachable()
            raise DatabaseUnavailable(str(error)) from error
        return connection

    def _checkout(self) -> Any:
        with self._guard:
            while self._idle:
                connection = self._idle.pop()
                if self._alive(connection):
                    return connection
                self._discard(connection)
        return self._open()

    def _alive(self, connection: Any) -> bool:
        try:
            cursor = connection.cursor()
            cursor.execute("SELECT 1")
            cursor.fetchall()
            connection.commit()
        except Exception:
            return False
        return True

    def _release(self, connection: Any) -> None:
        with self._guard:
            if len(self._idle) < 12:
                self._idle.append(connection)
                return
        self._discard(connection)

    @staticmethod
    def _discard(connection: Any) -> None:
        try:
            connection.close()
        except Exception:
            pass

    def drain(self) -> None:
        with self._guard:
            idle, self._idle = self._idle, []
        for connection in idle:
            self._discard(connection)

    # -- running work ---------------------------------------------------
    def run(self, work: Callable[[Transaction], Any]) -> Any:
        """Run one unit of work in a transaction, committing on success."""
        if self._unreachable():
            raise DatabaseUnavailable("the database was unreachable a moment ago")
        connection = self._checkout()
        cursor = connection.cursor()
        try:
            result = work(Transaction(cursor))
        except (
            pg8000.exceptions.InterfaceError,
            pg8000.exceptions.DatabaseError,
            socket.timeout,
            OSError,
        ) as error:
            self._rollback_or_discard(connection, keep=False)
            raise DatabaseUnavailable(str(error)) from error
        except BaseException:
            self._rollback_or_discard(connection, keep=True)
            raise
        try:
            connection.commit()
        except Exception as error:
            self._discard(connection)
            raise DatabaseUnavailable(str(error)) from error
        self._release(connection)
        return result

    def _rollback_or_discard(self, connection: Any, keep: bool) -> None:
        if not keep:
            self._discard(connection)
            return
        try:
            connection.rollback()
        except Exception:
            self._discard(connection)
            return
        self._release(connection)

    async def call(
        self,
        work: Callable[[Transaction], Any],
        budget: float = DB_REQUEST_BUDGET_SECONDS,
    ) -> Any:
        """Await one unit of work, bounded so no request outlives the budget."""
        loop = asyncio.get_running_loop()
        future = loop.run_in_executor(self._executor, self.run, work)
        try:
            return await asyncio.wait_for(asyncio.shield(future), budget)
        except (asyncio.TimeoutError, TimeoutError) as error:
            raise DatabaseUnavailable("database call exceeded its budget") from error

    def shutdown(self) -> None:
        self.drain()
        self._executor.shutdown(wait=False, cancel_futures=True)


DATABASE = Database(SETTINGS.database)

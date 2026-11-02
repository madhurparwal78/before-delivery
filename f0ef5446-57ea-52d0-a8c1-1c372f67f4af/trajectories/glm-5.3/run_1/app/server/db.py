"""A PostgreSQL connection per worker thread, reused across requests.

The app connects as the non-superuser owner named by DATABASE_URL. Every
statement outside a transaction block commits at once; each block is one
transaction (Business rules under Services).
"""
from __future__ import annotations

import threading
from contextlib import contextmanager
from urllib.parse import unquote, urlparse

import pg8000.dbapi as pg

from . import config

_local = threading.local()

class DatabaseUnavailable(RuntimeError):
    """PostgreSQL cannot be reached."""


def is_unique_violation(exc: Exception) -> bool:
    """A 23505 answer from PostgreSQL: the refused second write."""
    if not exc.args or not isinstance(exc.args[0], dict):
        return False
    return exc.args[0].get("C") == "23505"


def _params() -> dict:
    parsed = urlparse(config.DATABASE_URL)
    return {
        "user": unquote(parsed.username or ""),
        "password": unquote(parsed.password or ""),
        "host": parsed.hostname or "localhost",
        "port": parsed.port or 5432,
        "database": (parsed.path or "/").lstrip("/"),
    }


def _connect():
    try:
        connection = pg.connect(**_params(), timeout=15)
        connection.autocommit = True
        return connection
    except Exception as exc:
        raise DatabaseUnavailable("database unreachable") from exc


class _Cursor:
    """A cursor facade over the thread's connection."""

    def __init__(self, raw):
        self._raw = raw

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        try:
            self._raw.close()
        except Exception:
            pass
        return False

    def execute(self, sql: str, params: tuple = ()) -> None:
        try:
            self._raw.execute(sql, params)
        except (pg.InterfaceError, pg.OperationalError) as exc:
            _local.broken = True
            raise DatabaseUnavailable("database connection lost") from exc

    def fetchone(self):
        return self._raw.fetchone()

    def fetchall(self):
        return self._raw.fetchall()

    @property
    def rowcount(self) -> int:
        return self._raw.rowcount


class _Transaction:
    """One transaction block: BEGIN on entry, COMMIT or ROLLBACK on exit."""

    def __init__(self, connection):
        self._connection = connection
        self._outermost = connection._depth == 0

    def _run(self, statement: str) -> None:
        try:
            cursor = self._connection._raw.cursor()
            cursor.execute(statement)
            cursor.close()
        except Exception as exc:
            _local.broken = True
            raise DatabaseUnavailable("database connection lost") from exc

    def __enter__(self):
        if self._outermost:
            self._run("BEGIN")
        self._connection._depth += 1
        return self

    def __exit__(self, exc_type, exc, traceback):
        self._connection._depth -= 1
        if self._connection._depth == 0:
            if exc_type is None:
                self._run("COMMIT")
            else:
                self._run("ROLLBACK")
        return False


class _Connection:
    def __init__(self, raw):
        self._raw = raw
        self._depth = 0

    def transaction(self) -> _Transaction:
        return _Transaction(self)

    def cursor(self) -> _Cursor:
        return _Cursor(self._raw.cursor())


@contextmanager
def connection():
    """The thread's connection, reconnecting when the session is broken."""
    existing = getattr(_local, "connection", None)
    if existing is None or getattr(_local, "broken", False):
        existing = _Connection(_connect())
        _local.connection = existing
        _local.broken = False
    try:
        yield existing
    except DatabaseUnavailable:
        _local.broken = True
        raise

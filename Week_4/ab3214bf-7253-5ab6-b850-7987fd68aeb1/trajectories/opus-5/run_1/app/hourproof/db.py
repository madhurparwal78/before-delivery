"""PostgreSQL access: a small connection pool and transaction helpers."""

from __future__ import annotations

import queue
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Sequence
from urllib.parse import unquote, urlparse

import pg8000.dbapi

from .config import CONFIG

_POOL: "queue.LifoQueue[Any]" = queue.LifoQueue()
_LOCK = threading.Lock()
_CREATED = 0
_MAX_CONNECTIONS = 16


def _connect() -> Any:
    parsed = urlparse(CONFIG.database_url)
    connection = pg8000.dbapi.connect(
        user=unquote(parsed.username or ""),
        password=unquote(parsed.password or ""),
        host=parsed.hostname or "localhost",
        port=parsed.port or 5432,
        database=(parsed.path or "/").lstrip("/"),
        timeout=10,
    )
    connection.autocommit = False
    return connection


def _acquire() -> Any:
    global _CREATED
    try:
        return _POOL.get_nowait()
    except queue.Empty:
        pass
    with _LOCK:
        if _CREATED < _MAX_CONNECTIONS:
            _CREATED += 1
            return _connect()
    return _POOL.get()


def _release(connection: Any, broken: bool) -> None:
    global _CREATED
    if broken:
        with _LOCK:
            _CREATED -= 1
        try:
            connection.close()
        except Exception:
            pass
        return
    _POOL.put(connection)


class Cursor:
    """A cursor that returns rows as dictionaries."""

    def __init__(self, raw: Any) -> None:
        self._raw = raw

    def execute(self, sql: str, params: Sequence[Any] = ()) -> "Cursor":
        self._raw.execute(sql, params)
        return self

    def all(self, sql: str, params: Sequence[Any] = ()) -> list[dict[str, Any]]:
        self._raw.execute(sql, params)
        names = [column[0] for column in self._raw.description]
        return [dict(zip(names, row)) for row in self._raw.fetchall()]

    def one(self, sql: str, params: Sequence[Any] = ()) -> dict[str, Any] | None:
        rows = self.all(sql, params)
        return rows[0] if rows else None

    def value(self, sql: str, params: Sequence[Any] = ()) -> Any:
        self._raw.execute(sql, params)
        row = self._raw.fetchone()
        return None if row is None else row[0]

    def many(self, sql: str, rows: Sequence[Sequence[Any]]) -> None:
        if rows:
            self._raw.executemany(sql, rows)


@contextmanager
def tx() -> Iterator[Cursor]:
    connection = _acquire()
    raw = connection.cursor()
    broken = False
    try:
        yield Cursor(raw)
        connection.commit()
    except Exception as failure:
        broken = isinstance(failure, pg8000.dbapi.InterfaceError)
        if not broken:
            try:
                connection.rollback()
            except Exception:
                broken = True
        raise
    finally:
        try:
            raw.close()
        except Exception:
            broken = True
        _release(connection, broken)


def wait_for_database() -> None:
    while True:
        try:
            connection = _connect()
            connection.close()
            return
        except Exception:
            time.sleep(1)


def apply_schema() -> None:
    sql = (Path(__file__).parent / "schema.sql").read_text(encoding="utf-8")
    with tx() as cursor:
        for statement in [part.strip() for part in sql.split(";") if part.strip()]:
            cursor.execute(statement)

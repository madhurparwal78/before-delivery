"""PostgreSQL access: a small pool that tolerates an unreachable server."""

from __future__ import annotations

import json
import logging
import threading
import time
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit

import pg8000.dbapi as pg
import pg8000.exceptions

from .config import CONFIG

log = logging.getLogger("northpier.db")

SCHEMA_SQL = (Path(__file__).with_name("schema.sql")).read_text(encoding="utf-8")

# Namespaces for pg_advisory_xact_lock, so unrelated guards never collide.
LOCK_CALENDAR = 1
LOCK_SEED = 2
LOCK_INQUIRY_KEY = 3
LOCK_TRANSITION_KEY = 4
LOCK_FLOOD = 5

POOL_MAX_SIZE = 16
CONNECT_TIMEOUT = 3
ACQUIRE_TIMEOUT = 3.0

_LOST_CONNECTION = (OSError, pg.InterfaceError, pg8000.exceptions.InterfaceError)


class DatabaseUnavailable(Exception):
    """Raised when PostgreSQL cannot be reached."""


class Result:
    """The rows a statement returned, as dictionaries."""

    __slots__ = ("rows",)

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows

    def fetchone(self) -> dict[str, Any] | None:
        return self.rows[0] if self.rows else None

    def fetchall(self) -> list[dict[str, Any]]:
        return self.rows


def _positional(sql: str, params: Mapping[str, Any]) -> tuple[str, tuple[Any, ...]]:
    """Turn `%(name)s` placeholders into the positional form the driver takes."""
    order: list[Any] = []
    pieces: list[str] = []
    rest = sql
    while True:
        start = rest.find("%(")
        if start < 0:
            pieces.append(rest)
            return "".join(pieces), tuple(order)
        end = rest.index(")s", start)
        pieces.append(rest[:start])
        pieces.append("%s")
        order.append(params[rest[start + 2 : end]])
        rest = rest[end + 2 :]


class Connection:
    """One PostgreSQL session with explicit transactions."""

    def __init__(self, raw: Any) -> None:
        self._raw = raw
        self._in_transaction = False

    def execute(
        self, sql: str, params: Sequence[Any] | Mapping[str, Any] | None = None
    ) -> Result:
        if isinstance(params, Mapping):
            sql, bound = _positional(sql, params)
        else:
            bound = tuple(params or ())
        cursor = self._raw.cursor()
        try:
            if bound:
                cursor.execute(sql, bound)
            else:
                cursor.execute(sql)
            if cursor.description is None:
                return Result([])
            names = [column[0] for column in cursor.description]
            return Result([dict(zip(names, row)) for row in cursor.fetchall()])
        except _LOST_CONNECTION as exc:
            raise DatabaseUnavailable(str(exc)) from exc
        finally:
            cursor.close()

    @contextmanager
    def transaction(self) -> Iterator[Connection]:
        """One real transaction. Advisory locks inside it last until it ends."""
        if self._in_transaction:
            raise AssertionError("transactions are never nested on the inquiry desk")
        self.execute("BEGIN")
        self._in_transaction = True
        try:
            yield self
        except BaseException:
            self._in_transaction = False
            try:
                self.execute("ROLLBACK")
            except DatabaseUnavailable:
                pass
            raise
        self._in_transaction = False
        self.execute("COMMIT")


class _Pool:
    """Hands out sessions up to `POOL_MAX_SIZE`, reusing idle ones."""

    def __init__(self, dsn: str) -> None:
        self._settings = self._parse(dsn)
        self._idle: list[Any] = []
        self._leased = 0
        self._guard = threading.Condition()

    @staticmethod
    def _parse(dsn: str) -> dict[str, Any]:
        parts = urlsplit(dsn)
        return {
            "user": unquote(parts.username or ""),
            "password": unquote(parts.password) if parts.password else None,
            "host": parts.hostname or "localhost",
            "port": parts.port or 5432,
            "database": unquote((parts.path or "/").lstrip("/")),
            "timeout": CONNECT_TIMEOUT,
        }

    def _connect(self) -> Any:
        try:
            raw = pg.connect(**self._settings)
        except Exception as exc:  # noqa: BLE001 - any failure means unreachable
            raise DatabaseUnavailable(str(exc)) from exc
        raw.autocommit = True
        return raw

    def acquire(self) -> Any:
        deadline = time.monotonic() + ACQUIRE_TIMEOUT
        with self._guard:
            while True:
                if self._idle:
                    self._leased += 1
                    return self._idle.pop()
                if self._leased < POOL_MAX_SIZE:
                    self._leased += 1
                    break
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise DatabaseUnavailable("no session available")
                self._guard.wait(remaining)
        try:
            return self._connect()
        except DatabaseUnavailable:
            self._give_back(None)
            raise

    def _give_back(self, raw: Any) -> None:
        with self._guard:
            self._leased -= 1
            if raw is not None:
                self._idle.append(raw)
            self._guard.notify()

    def release(self, raw: Any, *, reusable: bool) -> None:
        self._give_back(raw if reusable else None)
        if not reusable:
            try:
                raw.close()
            except Exception:  # noqa: BLE001 - a broken socket needs no goodbye
                pass


class Database:
    def __init__(self, dsn: str) -> None:
        self._pool = _Pool(dsn)
        self._ready = threading.Event()

    # -- lifecycle ---------------------------------------------------------

    def start(self, prepare: Any) -> None:
        """Prepare the database in the background, retrying every 2 seconds."""

        def runner() -> None:
            while True:
                try:
                    prepare(self)
                except Exception:  # noqa: BLE001 - keep serving and retry
                    log.warning("database not ready, retrying in 2s")
                    time.sleep(2.0)
                    continue
                self._ready.set()
                return

        threading.Thread(target=runner, name="np-prepare", daemon=True).start()

    def healthy(self) -> bool:
        if not self._ready.is_set():
            return False
        try:
            with self.connection() as conn:
                conn.execute("SELECT 1")
        except DatabaseUnavailable:
            return False
        return True

    # -- access ------------------------------------------------------------

    @contextmanager
    def connection(self) -> Iterator[Connection]:
        raw = self._pool.acquire()
        reusable = True
        try:
            yield Connection(raw)
        except DatabaseUnavailable:
            reusable = False
            raise
        except BaseException:
            try:
                raw.rollback()
            except Exception:  # noqa: BLE001 - the session goes if it cannot reset
                reusable = False
            raise
        finally:
            self._pool.release(raw, reusable=reusable)

    def apply_schema(self) -> None:
        with self.connection() as conn:
            with conn.transaction():
                for statement in SCHEMA_SQL.split(";"):
                    if statement.strip():
                        conn.execute(statement)


def advisory_lock(conn: Connection, namespace: int, key: int) -> None:
    """Take a transaction-scoped advisory lock, released when the tx ends."""
    conn.execute("SELECT pg_advisory_xact_lock(%s, %s)", (namespace, key))


def text_lock_key(value: str) -> int:
    digest = 0
    for byte in value.encode("utf-8"):
        digest = (digest * 131 + byte) % 2147483647
    return digest - 1073741824


def json_param(value: Any) -> str:
    """JSON text for a placeholder the SQL casts to `jsonb`."""
    return json.dumps(value, ensure_ascii=False)


DATABASE = Database(CONFIG.database_url)

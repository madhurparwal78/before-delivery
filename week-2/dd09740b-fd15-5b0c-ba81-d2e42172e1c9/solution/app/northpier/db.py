"""PostgreSQL access: one asyncpg connection and event loop per thread, explicit transactions, outages as
`Unavailable`. Statements name their parameters `:name`; they are bound positionally."""
import asyncio
import json
import re
import threading
from datetime import datetime
from collections.abc import Coroutine, Iterator
from contextlib import contextmanager
from functools import lru_cache
from typing import Any

import asyncpg

from northpier.config import SETTINGS

CONNECT_TIMEOUT_S = 5
COMMAND_TIMEOUT_S = 5
LOST = (OSError, asyncio.TimeoutError, asyncpg.exceptions.ConnectionDoesNotExistError,
        asyncpg.exceptions.PostgresConnectionError, asyncpg.exceptions.OperatorInterventionError,
        asyncpg.exceptions.InvalidAuthorizationSpecificationError, asyncpg.exceptions.InvalidCatalogNameError,
        asyncpg.exceptions.TooManyConnectionsError)
_PARAMETER = re.compile(r"(?<!:):([a-z_][a-z0-9_]*)")
_local = threading.local()


class Unavailable(Exception):
    """PostgreSQL did not answer."""


@lru_cache(maxsize=512)
def _positional(sql: str) -> tuple[str, tuple[str, ...]]:
    """`:name` parameters rewritten to `$n`, with the names in binding order."""
    names: list[str] = []

    def number(match: re.Match[str]) -> str:
        if match.group(1) not in names:
            names.append(match.group(1))
        return f"${names.index(match.group(1)) + 1}"

    return _PARAMETER.sub(number, sql), tuple(names)


def _loop() -> asyncio.AbstractEventLoop:
    if getattr(_local, "loop", None) is None:
        _local.loop = asyncio.new_event_loop()
    return _local.loop


def _wait(work: Coroutine[Any, Any, Any]) -> Any:
    return _loop().run_until_complete(work)


class Tx:
    """A connection inside an open transaction."""

    def __init__(self, connection: asyncpg.Connection) -> None:
        self._connection = connection

    def rows(self, sql: str, **params: Any) -> list[dict[str, Any]]:
        statement, names = _positional(sql)
        found = _wait(self._connection.fetch(statement, *(params[name] for name in names)))
        return [dict(row) for row in found]

    def one(self, sql: str, **params: Any) -> dict[str, Any] | None:
        found = self.rows(sql, **params)
        return found[0] if found else None

    def value(self, sql: str, **params: Any) -> Any:
        statement, names = _positional(sql)
        return _wait(self._connection.fetchval(statement, *(params[name] for name in names)))

    def run(self, sql: str, **params: Any) -> None:
        statement, names = _positional(sql)
        _wait(self._connection.execute(statement, *(params[name] for name in names)))

    def lock(self, name: str) -> None:
        """A transaction-scoped advisory lock on a name: the guard for claims that have no row to lock yet."""
        self.run("SELECT pg_advisory_xact_lock(hashtextextended(:name, 0))", name=name)

    def clock(self) -> datetime:
        """The server clock every rule judges by, read after the transaction's locks are held."""
        return self.value("SELECT clock_timestamp()")


async def _connect() -> asyncpg.Connection:
    database = SETTINGS.database
    connection = await asyncpg.connect(user=database.user, password=database.password or None, host=database.host,
                                       port=database.port, database=database.database, timeout=CONNECT_TIMEOUT_S,
                                       command_timeout=COMMAND_TIMEOUT_S, statement_cache_size=0,
                                       server_settings={"application_name": "northpier"})
    for kind in ("json", "jsonb"):
        await connection.set_type_codec(kind, encoder=json.dumps, decoder=json.loads, schema="pg_catalog")
    return connection


def _drop() -> None:
    connection = getattr(_local, "connection", None)
    _local.connection = None
    if connection is not None:
        connection.terminate()


def _open() -> asyncpg.Connection:
    if getattr(_local, "connection", None) is None or _local.connection.is_closed():
        _local.connection = _wait(_connect())
    _wait(_local.connection.execute("BEGIN"))
    return _local.connection


def _begin() -> asyncpg.Connection:
    """A connection with BEGIN sent; a stale pooled connection is replaced once before giving up."""
    try:
        return _open()
    except LOST:
        _drop()
    try:
        return _open()
    except LOST as error:
        _drop()
        raise Unavailable from error


@contextmanager
def transaction() -> Iterator[Tx]:
    """Run the block in one transaction; any failure rolls back, a lost connection raises `Unavailable`."""
    connection = _begin()
    try:
        yield Tx(connection)
        _wait(connection.execute("COMMIT"))
    except LOST as error:
        _drop()
        raise Unavailable from error
    except BaseException:
        try:
            _wait(connection.execute("ROLLBACK"))
        except LOST:
            _drop()
        raise

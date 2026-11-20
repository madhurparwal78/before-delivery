"""Postgres access: one asyncpg pool behind a blocking, transaction-scoped API.

asyncpg is an asyncio driver, so a single event loop runs in its own thread and
the serving threads hand coroutines to it. Each unit of work holds one
connection for the length of its transaction, which is what the row locks that
decide the concurrent rules depend on.
"""

from __future__ import annotations

import asyncio
import threading
from contextlib import contextmanager
from functools import lru_cache

import asyncpg

from .config import CONFIG

POOL_MAX = 40


class Unique(Exception):
    """A unique index refused a write."""

    def __init__(self, constraint: str):
        super().__init__(constraint)
        self.constraint = constraint


class _LoopThread:
    def __init__(self):
        self._loop = asyncio.new_event_loop()
        threading.Thread(target=self._loop.run_forever, name="tallow-db", daemon=True).start()

    def run(self, awaitable):
        async def settle():
            return await awaitable

        return asyncio.run_coroutine_threadsafe(settle(), self._loop).result()


_LOOP = _LoopThread()
_pool: asyncpg.Pool | None = None
_pool_lock = threading.Lock()


async def _build_pool() -> asyncpg.Pool:
    return await asyncpg.create_pool(
        dsn=CONFIG.database_url,
        min_size=1,
        max_size=POOL_MAX,
        statement_cache_size=0,
        server_settings={"timezone": "UTC"},
    )


def _pool_or_create() -> asyncpg.Pool:
    global _pool
    with _pool_lock:
        if _pool is None:
            _pool = _LOOP.run(_build_pool())
    return _pool


@lru_cache(maxsize=512)
def _numbered(sql: str) -> str:
    """Rewrite the %s placeholders this codebase writes as asyncpg's $1, $2, …"""
    parts = sql.split("%s")
    pieces = [parts[0]]
    for number, part in enumerate(parts[1:], start=1):
        pieces.append(f"${number}")
        pieces.append(part)
    return "".join(pieces)


class Session:
    """One connection inside one transaction."""

    def __init__(self, connection: asyncpg.Connection):
        self.connection = connection

    def fetch(self, sql: str, params: tuple) -> list[dict]:
        records = self._await(self.connection.fetch(_numbered(sql), *params))
        return [dict(record) for record in records]

    def run(self, sql: str, params: tuple) -> None:
        if params:
            self._await(self.connection.execute(_numbered(sql), *params))
        else:
            self._await(self.connection.execute(sql))

    @staticmethod
    def _await(coroutine):
        try:
            return _LOOP.run(coroutine)
        except asyncpg.UniqueViolationError as error:
            raise Unique(error.constraint_name or "") from error


@contextmanager
def _unit_of_work(commit: bool):
    pool = _pool_or_create()
    connection = _LOOP.run(pool.acquire())
    transaction_handle = connection.transaction()
    _LOOP.run(transaction_handle.start())
    try:
        yield Session(connection)
    except BaseException:
        _LOOP.run(transaction_handle.rollback())
        _LOOP.run(pool.release(connection))
        raise
    if commit:
        _LOOP.run(transaction_handle.commit())
    else:
        _LOOP.run(transaction_handle.rollback())
    _LOOP.run(pool.release(connection))


@contextmanager
def transaction():
    """Run a unit of work. Commits on success, rolls back on any exception."""
    with _unit_of_work(commit=True) as session:
        yield session


@contextmanager
def read_only():
    """Run reads inside one snapshot; nothing is committed."""
    with _unit_of_work(commit=False) as session:
        yield session


def rows(session: Session, sql: str, params: tuple = ()) -> list[dict]:
    return session.fetch(sql, params)


def row(session: Session, sql: str, params: tuple = ()) -> dict | None:
    found = session.fetch(sql, params)
    return found[0] if found else None


def execute(session: Session, sql: str, params: tuple = ()) -> None:
    session.run(sql, params)

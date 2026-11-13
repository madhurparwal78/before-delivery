"""The single backing service: Postgres at DATABASE_URL.

The pool keeps retrying on its own, so a boot with Postgres absent turns into a
served app the moment the database answers, with no restart. Schema creation and
the seed run behind one advisory lock, so several workers starting together apply
the seed exactly once.
"""

from __future__ import annotations

import logging
import pathlib
import threading
import time
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool, PoolTimeout

from .config import settings

PREPARE_LOCK = 528_491
WRITE_LOCK = 528_492

_SCHEMA = (pathlib.Path(__file__).parent / "schema.sql").read_text(encoding="utf-8")

log = logging.getLogger("northfall")


class DatabaseUnavailable(Exception):
    """Raised when Postgres cannot be reached in time."""


def _conninfo() -> str:
    extras = "connect_timeout=3&options=-c%20statement_timeout%3D4000"
    joiner = "&" if "?" in settings.database_url else "?"
    return f"{settings.database_url}{joiner}{extras}"


pool = ConnectionPool(
    _conninfo(),
    min_size=0,
    max_size=10,
    timeout=3.0,
    max_idle=60.0,
    check=ConnectionPool.check_connection,
    kwargs={"row_factory": dict_row, "autocommit": False},
    open=False,
    name="northfall",
)

_ready = threading.Event()


def is_ready() -> bool:
    return _ready.is_set()


@contextmanager
def transaction():
    """A connection inside one transaction, or DatabaseUnavailable."""
    try:
        with pool.connection() as conn:
            yield conn
    except (PoolTimeout, psycopg.OperationalError, psycopg.InterfaceError) as exc:
        raise DatabaseUnavailable() from exc


def take_write_lock(conn: psycopg.Connection) -> None:
    conn.execute("SELECT pg_advisory_xact_lock(%s)", (WRITE_LOCK,))


def reachable() -> bool:
    try:
        with transaction() as conn:
            conn.execute("SELECT 1")
        return True
    except DatabaseUnavailable:
        return False


def prepare_once() -> bool:
    """Create the schema and apply the seed. True once the store is ready."""
    from .seed import apply_seed

    try:
        with transaction() as conn:
            conn.execute("SELECT pg_advisory_xact_lock(%s)", (PREPARE_LOCK,))
            conn.execute(_SCHEMA)
            row = conn.execute("SELECT applied FROM seed_marker WHERE id = 1").fetchone()
            if row is None:
                apply_seed(conn)
                conn.execute("INSERT INTO seed_marker (id, applied) VALUES (1, true)")
        _ready.set()
        return True
    except (DatabaseUnavailable, psycopg.Error) as exc:
        log.warning("store not ready yet: %s", type(exc).__name__)
        return False


def start() -> None:
    pool.open()

    def retry() -> None:
        while not prepare_once():
            time.sleep(1.0)

    if not prepare_once():
        threading.Thread(target=retry, name="northfall-prepare", daemon=True).start()

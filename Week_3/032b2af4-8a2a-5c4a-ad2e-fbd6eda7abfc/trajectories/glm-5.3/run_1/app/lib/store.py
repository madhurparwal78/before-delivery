"""Database layer: connection pool and helpers for Pacely."""
import threading

import psycopg
from psycopg_pool import ConnectionPool

_pool = None
_lock = threading.Lock()


def init_pool(database_url: str) -> None:
    global _pool
    with _lock:
        if _pool is None:
            _pool = ConnectionPool(database_url, min_size=1, max_size=16, open=True,
                                   kwargs={"autocommit": True, "row_factory": psycopg.rows.dict_row})


def db():
    if _pool is None:
        raise RuntimeError("pool not initialised")
    return _pool


def query(sql: str, params=()) -> list[dict]:
    with db().connection() as conn:
        return conn.execute(sql, params).fetchall()


def one(sql: str, params=()):
    rows = query(sql, params)
    return rows[0] if rows else None


def conn():
    return db().connection()


def execute(sql: str, params=()) -> None:
    with conn() as c:
        c.execute(sql, params)

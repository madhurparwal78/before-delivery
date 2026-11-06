"""Process state: readiness once schema, seeding and auth accounts exist,
and the database heartbeat behind /api/health."""
from __future__ import annotations

import threading

_lock = threading.Lock()
_ready = False
_database_ok = False


def mark_ready() -> None:
    global _ready
    with _lock:
        _ready = True


def ready() -> bool:
    return _ready


def set_database(ok: bool) -> None:
    global _database_ok
    with _lock:
        _database_ok = ok


def database_ok() -> bool:
    return _database_ok

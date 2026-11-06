"""Reading a stored original back as linear values, with a small decode cache."""

from __future__ import annotations

import threading
from typing import Any

import numpy as np

from . import errors, storage
from .imaging import scan as scan_images

CACHE_SIZE = 3

_lock = threading.Lock()
_cache: dict[str, np.ndarray] = {}
_order: list[str] = []


def _remember(sha256: str, linear: np.ndarray) -> None:
    with _lock:
        _cache[sha256] = linear
        if sha256 in _order:
            _order.remove(sha256)
        _order.append(sha256)
        while len(_order) > CACHE_SIZE:
            _cache.pop(_order.pop(0), None)


def _cached(sha256: str) -> np.ndarray | None:
    with _lock:
        return _cache.get(sha256)


def linear_values(scan: dict[str, Any]) -> np.ndarray:
    """The scan's linear values, read through storage so an outage is honest."""
    sha256 = scan["sha256"]
    cached = _cached(sha256)
    if cached is not None:
        if not storage.available():
            raise errors.storage_unavailable()
        return cached
    key = storage.original_key(str(scan["account_id"]), str(scan["id"]))
    try:
        data = storage.get_object(key)
    except storage.StorageUnavailable as exc:
        raise errors.storage_unavailable() from exc
    decoded = scan_images.decode(data)
    _remember(sha256, decoded.linear)
    return decoded.linear

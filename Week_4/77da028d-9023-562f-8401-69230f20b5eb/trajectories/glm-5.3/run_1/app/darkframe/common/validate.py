"""Shared validation helpers used by every service."""
from __future__ import annotations

import re
from typing import Any, Optional

FLOAT_RE = re.compile(r"^-?\d+(\.\d+)?$")
TZ_RE = re.compile(r"^[A-Za-z0-9_+\-/]+$")
FILTERS = ["L", "R", "G", "B", "Ha", "OIII", "SII"]
BROADBAND = ["L", "R", "G", "B"]
NARROWBAND = ["Ha", "OIII", "SII"]
FRAME_CONTENT_TYPES = {"image/png", "image/jpeg", "image/fits"}
NAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")


def as_dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def filter_order(name: str) -> int:
    return FILTERS.index(name) if name in FILTERS else len(FILTERS)


def is_real_date(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", value):
        return False
    import datetime as _dt

    try:
        _dt.datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        return False
    return True


def is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def in_range(value: Any, low: Any, high: Any) -> bool:
    return is_int(value) and low <= value <= high


def is_number(value: Any) -> bool:
    return (isinstance(value, (int, float)) and not isinstance(value, bool)) and value == value


def one_decimal(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return True
    if isinstance(value, float):
        return round(value, 1) == value
    return False


LEDGER_COLS = 'id, imager_id, name, kind, camera, gain, "offset", exposure_s, temperature_c, binning, filter, frame_count, captured_on, status, version, current_master, created_at, updated_at'


def strip(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    return str(value)

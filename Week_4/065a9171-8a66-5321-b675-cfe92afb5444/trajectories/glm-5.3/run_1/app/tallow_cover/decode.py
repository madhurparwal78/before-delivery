"""Row decoding helpers. All Postgres values arrive as text bytes or None."""
import datetime as dt
from decimal import Decimal

from . import domain
from .domain import LONDON


def s(v):
    """bytes -> str, keeping None."""
    return None if v is None else v.decode()


def i(v):
    if v is None:
        return None
    return int(v.decode())


def f(v):
    if v is None:
        return None
    return float(v.decode())


def dec(v):
    if v is None:
        return None
    return Decimal(v.decode())


def d(v):
    """bytes 'YYYY-MM-DD' -> date, keeping None."""
    if v is None:
        return None
    return dt.date.fromisoformat(v.decode())


def t(v):
    """bytes timestamp (UTC from Postgres) -> aware datetime, keeping None."""
    if v is None:
        return None
    return dt.datetime.fromisoformat(v.decode().replace(" ", "T")).replace(tzinfo=dt.UTC)


def b(v):
    if v is None:
        return None
    return v if isinstance(v, bytes) else bytes(v)


def j(v):
    if v is None:
        return None
    import json
    return json.loads(v.decode())


def hours(v):
    """numeric -> float, or None."""
    return None if v is None else float(Decimal(v.decode()))

"""Field validation: the published limits, each decided once."""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Any

from .copy import FIELD_COPY
from .domain.exposure import parse_aperture, parse_shutter

EMAIL_PATTERN = re.compile(r"^[^@\s]{1,64}@[^@\s.]+(\.[^@\s.]+)+$")
MAX_EMAIL = 254
MIN_PASSWORD = 10
MAX_PASSWORD = 128
MAX_NAME = 80
MAX_STOCK = 60
MAX_NOTE = 500
MAX_TITLE = 80
FORMATS = ("35mm", "120-6x6", "120-6x7")
KINDS = ("normal", "test")

_MISSING = object()


def character_count(value: str) -> int:
    """Code points, counted after trimming leading and trailing whitespace."""
    return len(value.strip())


class Fields:
    """Collects every failing field so they are reported together."""

    def __init__(self) -> None:
        self.errors: dict[str, str] = {}

    def fail(self, field: str, copy_key: str | None = None) -> None:
        self.errors[field] = FIELD_COPY[copy_key or field]

    def ok(self) -> bool:
        return not self.errors


def text(
    fields: Fields,
    body: dict[str, Any],
    field: str,
    *,
    maximum: int,
    minimum: int = 0,
    default: Any = _MISSING,
) -> str | None:
    value = body.get(field, default)
    if value is _MISSING:
        fields.fail(field)
        return None
    if not isinstance(value, str):
        fields.fail(field)
        return None
    trimmed = value.strip()
    if not minimum <= len(trimmed) <= maximum:
        fields.fail(field)
        return None
    return trimmed


def whole_number(
    fields: Fields,
    body: dict[str, Any],
    field: str,
    *,
    low: int,
    high: int,
    default: Any = _MISSING,
    copy_key: str | None = None,
) -> int | None:
    value = body.get(field, default)
    if value is _MISSING:
        fields.fail(field, copy_key)
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        fields.fail(field, copy_key)
        return None
    if isinstance(value, float) and not value.is_integer():
        fields.fail(field, copy_key)
        return None
    number = int(value)
    if not low <= number <= high:
        fields.fail(field, copy_key)
        return None
    return number


def decimal_number(
    fields: Fields,
    body: dict[str, Any],
    field: str,
    *,
    low: float,
    high: float,
    default: Any = _MISSING,
) -> float | None:
    value = body.get(field, default)
    if value is _MISSING:
        fields.fail(field)
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        fields.fail(field)
        return None
    if not low <= float(value) <= high:
        fields.fail(field)
        return None
    return float(value)


def reciprocity_exponent(
    fields: Fields, body: dict[str, Any], default: Any = _MISSING
) -> float | None:
    value = body.get("reciprocity_p", default)
    if value is _MISSING:
        fields.fail("reciprocity_p")
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        fields.fail("reciprocity_p")
        return None
    try:
        exact = Decimal(str(value))
    except InvalidOperation:
        fields.fail("reciprocity_p")
        return None
    if exact.as_tuple().exponent < -2 or not Decimal("0.50") <= exact <= Decimal("1.00"):
        fields.fail("reciprocity_p")
        return None
    return float(exact)


def email(fields: Fields, body: dict[str, Any]) -> str | None:
    value = body.get("email")
    if not isinstance(value, str):
        fields.fail("email")
        return None
    trimmed = value.strip().lower()
    if len(trimmed) > MAX_EMAIL or not EMAIL_PATTERN.match(trimmed):
        fields.fail("email")
        return None
    return trimmed


def password(fields: Fields, body: dict[str, Any]) -> str | None:
    value = body.get("password")
    if not isinstance(value, str) or not MIN_PASSWORD <= len(value) <= MAX_PASSWORD:
        fields.fail("password")
        return None
    return value


def choice(
    fields: Fields,
    body: dict[str, Any],
    field: str,
    allowed: tuple[str, ...],
    default: Any = _MISSING,
) -> str | None:
    value = body.get(field, default)
    if value not in allowed:
        fields.fail(field)
        return None
    return str(value)


def aperture(fields: Fields, body: dict[str, Any], default: Any = _MISSING) -> str | None:
    value = body.get("aperture", default)
    marked = parse_aperture(value)
    if marked is None:
        fields.fail("aperture")
    return marked


def shutter(fields: Fields, body: dict[str, Any], default: Any = _MISSING) -> str | None:
    value = body.get("shutter", default)
    parsed = parse_shutter(value)
    if parsed is None:
        fields.fail("shutter")
    return parsed


def note_text(
    fields: Fields, body: dict[str, Any], field: str, maximum: int, default: Any = ""
) -> str | None:
    value = body.get(field, default)
    if not isinstance(value, str):
        fields.fail(field)
        return None
    trimmed = value.strip()
    if character_count(value) > maximum:
        fields.fail(field)
        return None
    return trimmed


def flag(fields: Fields, body: dict[str, Any], field: str, default: bool) -> bool:
    value = body.get(field, default)
    if not isinstance(value, bool):
        fields.fail(field)
        return default
    return value


def query_whole_number(
    fields: Fields, raw: str | None, field: str, *, low: int, high: int
) -> int | None:
    if raw is None or not re.fullmatch(r"-?\d+", raw):
        fields.fail(field)
        return None
    number = int(raw)
    if not low <= number <= high:
        fields.fail(field)
        return None
    return number

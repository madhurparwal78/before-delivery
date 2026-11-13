"""Validation helpers shared by the API routes."""

from __future__ import annotations

import re
from typing import Any, Mapping

from ..domain import LEVELS, KINDS, DURATIONS, LEVEL_CODES
from ..errors import (
    MSG_AT_LEAST_ONE_LEVEL,
    MSG_CANNOT_SET,
    MSG_CHOOSE_KIND,
    MSG_CHOOSE_LEVEL,
    MSG_DATE_FORM,
    MSG_DATE_FUTURE,
    MSG_DURATION,
    MSG_EMAIL,
    MSG_KIND_ONCE,
    MSG_PRIORITY,
    MSG_REQUIRED,
    MSG_TICK_KIND,
    MSG_TOO_LONG,
    ApiError,
    validation,
)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
DATE_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$")


def _trim(value: str) -> str:
    return value.strip()


def clean_company(value: Any, field: str = "company") -> str:
    """Trim, collapse whitespace, 1 to 80 characters."""
    if not isinstance(value, str):
        raise validation({field: MSG_REQUIRED})
    text = " ".join(value.split())
    if not text:
        raise validation({field: MSG_REQUIRED})
    if len(text) > 80:
        raise validation({field: MSG_TOO_LONG})
    return text


def clean_value(value: Any) -> str:
    """Trim, 1 to 120 characters."""
    if not isinstance(value, str):
        raise validation({"value": MSG_REQUIRED})
    text = value.strip()
    if not text:
        raise validation({"value": MSG_REQUIRED})
    if len(text) > 120:
        raise validation({"value": MSG_TOO_LONG})
    return text


def clean_notes(value: Any) -> str:
    """Trim, 0 to 500 characters, default empty."""
    if value is None:
        return ""
    if not isinstance(value, str):
        raise validation({"notes": MSG_REQUIRED})
    text = value.strip()
    if len(text) > 500:
        raise validation({"notes": MSG_TOO_LONG})
    return text


def clean_kind(value: Any, field: str = "data_kind") -> str:
    if value is None:
        raise validation({field: MSG_REQUIRED})
    if not isinstance(value, str) or value not in KINDS:
        raise validation({field: MSG_CHOOSE_KIND})
    return value


def clean_level(value: Any, field: str = "level") -> str:
    if value is None:
        raise validation({field: MSG_REQUIRED})
    if not isinstance(value, str) or value not in LEVELS:
        raise validation({field: MSG_CHOOSE_LEVEL})
    return value


def clean_company_contains(value: Any) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        raise validation({"company_contains": MSG_REQUIRED})
    text = " ".join(value.split())
    if len(text) > 60:
        raise validation({"company_contains": MSG_TOO_LONG})
    return text


def clean_priority(value: Any, default: int | None = None) -> int:
    if value is None:
        if default is None:
            raise validation({"priority": MSG_REQUIRED})
        return default
    if isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > 999:
        raise validation({"priority": MSG_PRIORITY})
    return value


def clean_date(value: Any, today_iso: str, field: str = "announced_on") -> str:
    if not isinstance(value, str) or not DATE_RE.match(value):
        raise validation({field: MSG_DATE_FORM})
    try:
        from datetime import date

        parsed = date.fromisoformat(value)
    except ValueError:
        raise validation({field: MSG_DATE_FORM})
    if parsed.isoformat() > today_iso:
        raise validation({field: MSG_DATE_FUTURE})
    return value


def clean_kinds(value: Any, field: str = "data_kinds") -> list[str]:
    if value is None:
        raise validation({field: MSG_TICK_KIND})
    if not isinstance(value, list) or not value:
        raise validation({field: MSG_TICK_KIND})
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, str) or item not in KINDS:
            raise validation({field: MSG_CHOOSE_KIND})
        if item in seen:
            raise validation({field: MSG_KIND_ONCE})
        seen.add(item)
    return list(value)


def clean_email(value: Any, field: str = "contact_email") -> str:
    if not isinstance(value, str) or not EMAIL_RE.match(value):
        raise validation({field: MSG_EMAIL})
    text = value.strip().casefold()
    if len(text) > 254:
        raise validation({field: MSG_TOO_LONG})
    return text


def clean_duration(value: Any) -> str:
    if not isinstance(value, str) or value not in DURATIONS:
        raise validation({"duration": MSG_DURATION})
    return value


def clean_contact_name(value: Any) -> str:
    if not isinstance(value, str):
        raise validation({"contact_name": MSG_REQUIRED})
    text = _trim(value)
    if not text:
        raise validation({"contact_name": MSG_REQUIRED})
    if len(text) > 80:
        raise validation({"contact_name": MSG_TOO_LONG})
    return text


def clean_levels(value: Any, field: str = "levels") -> list[str]:
    if value is None or not isinstance(value, list) or not value:
        raise validation({field: MSG_AT_LEAST_ONE_LEVEL})
    for item in value:
        if not isinstance(item, str) or item not in LEVEL_CODES:
            raise validation({field: MSG_CHOOSE_LEVEL})
    unique = list(dict.fromkeys(value))
    return unique


def reject_unknown_keys(body: Mapping[str, Any], allowed: set[str]) -> None:
    """422 with 'This field cannot be set.' for each key outside the editable list."""
    extras = {k: MSG_CANNOT_SET for k in body if k not in allowed}
    if extras:
        raise validation(extras)

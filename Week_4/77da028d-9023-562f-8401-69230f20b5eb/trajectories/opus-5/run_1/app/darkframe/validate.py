"""Field validation that always ends in the published 422 shape."""

from __future__ import annotations

from datetime import date
from typing import Any, Iterable

from .domain import timeutil
from .errors import validation

MISSING = object()


class Fields:
    """Collects field errors so one 422 reports all of them."""

    def __init__(self, body: dict[str, Any], *, prefix: str = "") -> None:
        self.body = body
        self.prefix = prefix
        self.errors: dict[str, str] = {}

    def fail(self, name: str, message: str) -> None:
        self.errors.setdefault(f"{self.prefix}{name}", message)

    def done(self) -> None:
        if self.errors:
            raise validation(self.errors)

    def present(self, name: str) -> bool:
        return name in self.body

    def text(
        self,
        name: str,
        minimum: int,
        maximum: int,
        *,
        default: Any = MISSING,
        field: str | None = None,
    ) -> Any:
        label = field or name
        value = self.body.get(name, MISSING)
        if value is MISSING:
            if default is not MISSING:
                return default
            self.fail(label, "This field is required.")
            return None
        if not isinstance(value, str) or not minimum <= len(value) <= maximum:
            self.fail(
                label, f"Use between {minimum} and {maximum} characters."
            )
            return None
        return value

    def whole(
        self,
        name: str,
        minimum: int,
        maximum: int,
        *,
        default: Any = MISSING,
        field: str | None = None,
    ) -> Any:
        label = field or name
        value = self.body.get(name, MISSING)
        if value is MISSING:
            if default is not MISSING:
                return default
            self.fail(label, "This field is required.")
            return None
        if isinstance(value, bool) or not isinstance(value, int):
            self.fail(label, f"Use a whole number from {minimum} to {maximum}.")
            return None
        if not minimum <= value <= maximum:
            self.fail(label, f"Use a whole number from {minimum} to {maximum}.")
            return None
        return value

    def decimal(
        self,
        name: str,
        minimum: float,
        maximum: float,
        *,
        default: Any = MISSING,
        field: str | None = None,
    ) -> Any:
        label = field or name
        value = self.body.get(name, MISSING)
        if value is MISSING:
            if default is not MISSING:
                return default
            self.fail(label, "This field is required.")
            return None
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            self.fail(label, f"Use a number from {minimum} to {maximum}.")
            return None
        if not minimum <= float(value) <= maximum:
            self.fail(label, f"Use a number from {minimum} to {maximum}.")
            return None
        return float(value)

    def one_decimal(
        self,
        name: str,
        minimum: float,
        maximum: float,
        *,
        default: Any = MISSING,
        field: str | None = None,
    ) -> Any:
        label = field or name
        value = self.decimal(name, minimum, maximum, default=default, field=label)
        if value is None or value is default:
            return value
        if round(float(value), 1) != float(value):
            self.fail(label, "Use at most one decimal place.")
            return None
        return round(float(value), 1)

    def boolean(self, name: str, *, default: Any = MISSING) -> Any:
        value = self.body.get(name, MISSING)
        if value is MISSING:
            if default is not MISSING:
                return default
            self.fail(name, "This field is required.")
            return None
        if not isinstance(value, bool):
            self.fail(name, "Use true or false.")
            return None
        return value

    def choice(
        self, name: str, allowed: Iterable[str], *, default: Any = MISSING
    ) -> Any:
        value = self.body.get(name, MISSING)
        if value is MISSING:
            if default is not MISSING:
                return default
            self.fail(name, "This field is required.")
            return None
        options = tuple(allowed)
        if value not in options:
            self.fail(name, f"Choose one of {', '.join(options)}.")
            return None
        return value

    def day(self, name: str, *, default: Any = MISSING) -> Any:
        value = self.body.get(name, MISSING)
        if value is MISSING:
            if default is not MISSING:
                return default
            self.fail(name, "This field is required.")
            return None
        parsed = timeutil.parse_date(value)
        if parsed is None:
            self.fail(name, "Use a date as YYYY-MM-DD.")
            return None
        return parsed

    def clock(self, name: str, *, default: Any = MISSING) -> Any:
        value = self.body.get(name, MISSING)
        if value is MISSING:
            if default is not MISSING:
                return default
            self.fail(name, "This field is required.")
            return None
        parsed = timeutil.parse_hhmm(value)
        if parsed is None:
            self.fail(name, "Use a time as HH:MM.")
            return None
        return parsed

    def instant(
        self, name: str, *, default: Any = MISSING, nullable: bool = False
    ) -> Any:
        value = self.body.get(name, MISSING)
        if value is None and nullable:
            return None
        if value is MISSING:
            if default is not MISSING:
                return default
            self.fail(name, "This field is required.")
            return None
        parsed = timeutil.parse_offset_instant(value)
        if parsed is None:
            self.fail(name, "Use an ISO 8601 time with a UTC offset.")
            return None
        return parsed


def parse_date_param(raw: str | None, field: str = "date") -> date:
    parsed = timeutil.parse_date(raw)
    if parsed is None:
        raise validation({field: "Use a date as YYYY-MM-DD."})
    return parsed

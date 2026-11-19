"""Request-body validation that collects every field error into the one 422 body."""
import re
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from darkframe.rules.errors import validation

DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_PATTERN = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
MISSING = object()


def parse_date(text: str, field: str = "date") -> date:
    if not DATE_PATTERN.fullmatch(text):
        raise validation({field: f"{field.capitalize()} must be a real date written YYYY-MM-DD."})
    try:
        return date.fromisoformat(text)
    except ValueError as error:
        raise validation({field: f"{field.capitalize()} must be a real date written YYYY-MM-DD."}) from error


def is_zone(name: str) -> bool:
    try:
        ZoneInfo(name)
    except (KeyError, ValueError, OSError):
        return False
    return True


def parse_offset_datetime(text: str) -> datetime | None:
    """An ISO 8601 instant that carries a UTC offset, or None."""
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.utcoffset() is not None else None


class Fields:
    """Reads typed values out of a body, remembering one message per failing field."""

    def __init__(self, body: dict[str, Any], prefix: str = "") -> None:
        self.body = body
        self.prefix = prefix
        self.errors: dict[str, str] = {}

    def fail(self, name: str, message: str) -> None:
        self.errors.setdefault(f"{self.prefix}{name}", message)

    def raise_errors(self) -> None:
        if self.errors:
            raise validation(self.errors)

    def whole(self, name: str, low: int, high: int, label: str) -> int | None:
        value = self.body.get(name, MISSING)
        if isinstance(value, float) and value.is_integer():
            value = int(value)
        if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
            self.fail(name, f"{label} must be a whole number from {low} to {high}.")
            return None
        return value

    def number(self, name: str, low: float, high: float, label: str, places: int | None = None) -> float | None:
        value = self.body.get(name, MISSING)
        valid = isinstance(value, (int, float)) and not isinstance(value, bool) and low <= value <= high
        if valid and places is not None and abs(value * 10 ** places - round(value * 10 ** places)) > 1e-6:
            valid = False
        if not valid:
            suffix = f" with at most {places} decimal place" if places == 1 else ""
            self.fail(name, f"{label} must be a number from {low:g} to {high:g}{suffix}.")
            return None
        return float(value)

    def text(self, name: str, low: int, high: int, label: str) -> str | None:
        value = self.body.get(name, MISSING)
        if not isinstance(value, str) or not low <= len(value) <= high:
            self.fail(name, f"{label} must be {low} to {high} characters." if low else f"{label} must be at most {high} characters.")
            return None
        return value

    def choice(self, name: str, options: tuple[str, ...], label: str) -> str | None:
        value = self.body.get(name, MISSING)
        if value not in options:
            self.fail(name, f"{label} must be one of {', '.join(options)}.")
            return None
        return value

    def date(self, name: str, label: str) -> date | None:
        value = self.body.get(name, MISSING)
        if not isinstance(value, str) or not DATE_PATTERN.fullmatch(value):
            self.fail(name, f"{label} must be a real date written YYYY-MM-DD.")
            return None
        try:
            return date.fromisoformat(value)
        except ValueError:
            self.fail(name, f"{label} must be a real date written YYYY-MM-DD.")
            return None

    def zone(self, name: str, label: str) -> str | None:
        value = self.body.get(name, MISSING)
        if not isinstance(value, str) or not is_zone(value):
            self.fail(name, f"{label} must be an IANA time zone such as Europe/London.")
            return None
        return value


def require_object(value: Any, name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise validation({name: f"{name.capitalize()} must be an object."})
    return value

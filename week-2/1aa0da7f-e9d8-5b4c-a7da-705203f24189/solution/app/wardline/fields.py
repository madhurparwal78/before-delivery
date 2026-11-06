"""Field validation: trimming, the published copy and the choice between copies."""

from __future__ import annotations

import datetime as dt
import re
from typing import Any

from wardline.errors import ValidationFailed

REQUIRED = "This field is required."
UNSTORABLE = "This field holds characters that cannot be stored."
BODY = "This request could not be read."
FUTURE_TIME = "Choose a time in the future."
WITHIN_90 = "Choose a time within 90 days."
REASON_10 = "Write a reason of at least 10 characters."
REASON_20 = "Write a reason of at least 20 characters."
PAGE = "Choose a page of this exhibit."
REGIONS = "Each region must sit inside its page."
DATE = "Enter a date that is not in the future, as YYYY-MM-DD."
BAD_KEY = "This key cannot be used."

TRIM = " \t\r\n"
_TIME = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")
_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


def over_length(maximum: int) -> str:
    return f"Keep this to {maximum} characters or fewer."


def unstorable(value: str) -> bool:
    """True for NUL, other characters below U+0020 except tab and line feed, U+007F, or a lone surrogate."""
    for char in value:
        code = ord(char)
        if (code < 0x20 and code not in (0x09, 0x0A)) or code == 0x7F or 0xD800 <= code <= 0xDFFF:
            return True
    return False


def now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def format_time(value: dt.datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_time(value: str) -> dt.datetime | None:
    if not _TIME.fullmatch(value):
        return None
    try:
        return dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.UTC)
    except ValueError:
        return None


class Form:
    """Collects refused fields so that each 422 names every one of them."""

    def __init__(self, body: dict[str, Any]) -> None:
        self.body = body
        self.errors: dict[str, str] = {}

    def text(self, field: str, maximum: int) -> str | None:
        """A required free text field."""
        value = self.body.get(field)
        if not isinstance(value, str) or not value.strip(TRIM):
            self.errors[field] = REQUIRED
            return None
        value = value.strip(TRIM)
        if unstorable(value):
            self.errors[field] = UNSTORABLE
            return None
        if len(value) > maximum:
            self.errors[field] = over_length(maximum)
            return None
        return value

    def reason(self, minimum: int = 10) -> str | None:
        copy = REASON_20 if minimum == 20 else REASON_10
        value = self.body.get("reason")
        if value is None or (isinstance(value, str) and not value.strip(TRIM)):
            self.errors["reason"] = copy
            return None
        if not isinstance(value, str):
            self.errors["reason"] = REQUIRED
            return None
        value = value.strip(TRIM)
        if unstorable(value):
            self.errors["reason"] = UNSTORABLE
        elif len(value) > 2000:
            self.errors["reason"] = over_length(2000)
        elif len(value) < minimum:
            self.errors["reason"] = copy
        else:
            return value
        return None

    def choice(self, field: str, allowed: tuple[str, ...]) -> str | None:
        value = self.body.get(field)
        if not isinstance(value, str) or value.strip(TRIM) not in allowed:
            self.errors[field] = REQUIRED
            return None
        return value.strip(TRIM)

    def whole_number(self, field: str) -> int | None:
        value = self.body.get(field)
        if type(value) is not int:
            self.errors[field] = REQUIRED
            return None
        return value

    def grant_expiry(self) -> dt.datetime | None:
        """Grant `expires_at`: null is valid and means the grant does not lapse."""
        value = self.body.get("expires_at", "")
        if value is None:
            return None
        if not isinstance(value, str) or not value.strip(TRIM):
            self.errors["expires_at"] = REQUIRED
            return None
        parsed = parse_time(value.strip(TRIM))
        if parsed is None or parsed <= now():
            self.errors["expires_at"] = FUTURE_TIME
            return None
        return parsed

    def link_expiry(self) -> dt.datetime | None:
        value = self.body.get("expires_at")
        if not isinstance(value, str) or not value.strip(TRIM):
            self.errors["expires_at"] = REQUIRED
            return None
        parsed = parse_time(value.strip(TRIM))
        if parsed is None or parsed <= now():
            self.errors["expires_at"] = FUTURE_TIME
            return None
        if parsed > now() + dt.timedelta(days=90):
            self.errors["expires_at"] = WITHIN_90
            return None
        return parsed

    def done(self) -> None:
        if self.errors:
            raise ValidationFailed(self.errors)


def collected_on_error(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip(TRIM):
        return REQUIRED
    value = value.strip(TRIM)
    if not _DATE.fullmatch(value):
        return DATE
    try:
        day = dt.date.fromisoformat(value)
    except ValueError:
        return DATE
    return DATE if day > now().date() else None

"""Field validation and the one copy for each refusal, as published."""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from typing import Any

from .errors import ValidationFailed

REQUIRED = "This field is required."
UNSTORABLE = "This field holds characters that cannot be stored."
BODY_UNREADABLE = "This request could not be read."
IDEMPOTENCY_UNUSABLE = "This key cannot be used."
DATE_COPY = "Enter a date that is not in the future, as YYYY-MM-DD."
PAGE_COPY = "Choose a page of this exhibit."
REASON_COPY = "Write a reason of at least 10 characters."
REASON_BREAK_GLASS_COPY = "Write a reason of at least 20 characters."
REGIONS_COPY = "Each region must sit inside its page."
FUTURE_TIME_COPY = "Choose a time in the future."
NINETY_DAY_COPY = "Choose a time within 90 days."

FILE_TYPE_MISMATCH = "The declared type does not match the file."
FILE_UNACCEPTED = "This file type is not accepted."
FILE_NAME_UNSAFE = "This file name is not accepted."
FILE_DIGEST_DIFFERS = "The file does not match the submitted digest."
FILE_TOO_LARGE_COPY = "This file is over the 20,000,000 byte limit."

MAX_LENGTHS = {
    "name": 200,
    "collected_by": 200,
    "matter_ref": 200,
    "source": 500,
    "capture_notes": 2000,
    "label": 120,
    "text": 200,
    "reason": 2000,
}

TRIM_CHARS = " \t\r\n"
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TIME_RE = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?"
    r"([Zz]|[+-]\d{2}:\d{2})$"
)


def over_length(maximum: int) -> str:
    return f"Keep this to {maximum} characters or fewer."


def trim(value: str) -> str:
    return value.strip(TRIM_CHARS)


def is_unstorable(value: str) -> bool:
    for ch in value:
        point = ord(ch)
        if point == 0 or (point < 0x20 and ch not in "\t\n"):
            return True
        if point == 0x7F or 0xD800 <= point <= 0xDFFF:
            return True
    return False


def parse_time(value: str) -> datetime | None:
    if not _TIME_RE.match(value.strip()):
        return None
    text = value.strip()
    if text[-1] in "Zz":
        text = text[:-1] + "+00:00"
    try:
        moment = datetime.fromisoformat(text)
    except ValueError:
        return None
    return moment.astimezone(timezone.utc)


class FieldChecker:
    """Collects one copy per refused field and raises them together."""

    def __init__(self, body: dict[str, Any]) -> None:
        self.body = body
        self.fields: dict[str, str] = {}

    def fail(self, field: str, copy: str) -> None:
        self.fields.setdefault(field, copy)

    def done(self) -> None:
        if self.fields:
            raise ValidationFailed(self.fields)

    def free_text(
        self,
        field: str,
        *,
        minimum: int = 1,
        maximum: int | None = None,
        reason_copy: str | None = None,
    ) -> str | None:
        maximum = maximum if maximum is not None else MAX_LENGTHS[field]
        missing_copy = reason_copy or REQUIRED
        raw = self.body.get(field)
        if raw is None or not isinstance(raw, str):
            self.fail(field, REQUIRED if not isinstance(raw, str) and raw is not None else missing_copy)
            return None
        value = trim(raw)
        if value == "":
            self.fail(field, missing_copy)
            return None
        if is_unstorable(value):
            self.fail(field, UNSTORABLE)
            return None
        if len(value) > maximum:
            self.fail(field, over_length(maximum))
            return None
        if len(value) < minimum:
            self.fail(field, reason_copy or REQUIRED)
            return None
        return value

    def reason(self, *, break_glass: bool = False) -> str | None:
        copy = REASON_BREAK_GLASS_COPY if break_glass else REASON_COPY
        minimum = 20 if break_glass else 10
        return self.free_text(
            "reason", minimum=minimum, maximum=MAX_LENGTHS["reason"], reason_copy=copy
        )

    def optional_text(self, field: str) -> str | None:
        raw = self.body.get(field)
        if raw is None or not isinstance(raw, str):
            return None
        value = trim(raw)
        if value == "":
            return None
        if is_unstorable(value):
            self.fail(field, UNSTORABLE)
            return None
        maximum = MAX_LENGTHS[field]
        if len(value) > maximum:
            self.fail(field, over_length(maximum))
            return None
        return value

    def collected_on(self) -> str | None:
        raw = self.body.get("collected_on")
        if raw is None or not isinstance(raw, str) or trim(raw) == "":
            self.fail("collected_on", REQUIRED)
            return None
        value = trim(raw)
        if not _DATE_RE.match(value):
            self.fail("collected_on", DATE_COPY)
            return None
        try:
            parsed = date.fromisoformat(value)
        except ValueError:
            self.fail("collected_on", DATE_COPY)
            return None
        if parsed > datetime.now(timezone.utc).date():
            self.fail("collected_on", DATE_COPY)
            return None
        return value

    def whole_number(self, field: str) -> int | None:
        raw = self.body.get(field)
        if raw is None or isinstance(raw, bool) or not isinstance(raw, int):
            self.fail(field, REQUIRED)
            return None
        return raw

    def body_id(self, field: str) -> str | None:
        raw = self.body.get(field)
        if raw is None or not isinstance(raw, str) or trim(raw) == "":
            self.fail(field, REQUIRED)
            return None
        return trim(raw)

    def choice(self, field: str, options: tuple[str, ...]) -> str | None:
        raw = self.body.get(field)
        if not isinstance(raw, str) or trim(raw) not in options:
            self.fail(field, REQUIRED)
            return None
        return trim(raw)

    def grant_expires_at(self) -> tuple[datetime | None, bool]:
        """Returns (time, ok). A null lapse time is valid."""
        if "expires_at" not in self.body:
            self.fail("expires_at", REQUIRED)
            return None, False
        raw = self.body["expires_at"]
        if raw is None:
            return None, True
        if not isinstance(raw, str):
            self.fail("expires_at", REQUIRED)
            return None, False
        if trim(raw) == "":
            self.fail("expires_at", REQUIRED)
            return None, False
        moment = parse_time(raw)
        now = datetime.now(timezone.utc)
        if moment is None or moment <= now:
            self.fail("expires_at", FUTURE_TIME_COPY)
            return None, False
        return moment, True

    def link_expires_at(self) -> datetime | None:
        raw = self.body.get("expires_at")
        if not isinstance(raw, str) or trim(raw) == "":
            self.fail("expires_at", REQUIRED)
            return None
        moment = parse_time(raw)
        now = datetime.now(timezone.utc)
        if moment is None or moment <= now:
            self.fail("expires_at", FUTURE_TIME_COPY)
            return None
        if moment > now + timedelta(days=90):
            self.fail("expires_at", NINETY_DAY_COPY)
            return None
        return moment


def check_regions(value: Any, page_count: int | None) -> tuple[list[dict] | None, str | None]:
    """Returns (regions, failure copy)."""
    if value is None or not isinstance(value, list):
        return None, REQUIRED
    pages = page_count or 1
    regions: list[dict] = []
    for item in value:
        if not isinstance(item, dict):
            return None, REGIONS_COPY
        keys = ("page", "x", "y", "w", "h")
        if any(key not in item for key in keys):
            return None, REGIONS_COPY
        if any(
            isinstance(item[key], bool) or not isinstance(item[key], int)
            for key in keys
        ):
            return None, REGIONS_COPY
        page, x, y, w, h = (item[key] for key in keys)
        if page < 1 or page > pages:
            return None, REGIONS_COPY
        if x < 0 or y < 0 or w < 1 or h < 1:
            return None, REGIONS_COPY
        if x + w > 1000 or y + h > 1000:
            return None, REGIONS_COPY
        regions.append({"page": page, "x": x, "y": y, "w": w, "h": h})
    return regions, None

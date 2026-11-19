"""The account field rules, the hostile-input checks and the request readers.

Every rule in this module is the single place that decides its field, shared by the
API handlers and (in meaning) by the sign-up page's own browser checks.
"""

from __future__ import annotations

import json
import unicodedata
from datetime import date, datetime, timezone
from typing import Any, Iterable

from .errors import ApiError, invalid

CONTROL_CHARS = frozenset(chr(c) for c in list(range(0x00, 0x20)) + [0x7F])
USERNAME_CHARS = frozenset("abcdefghijklmnopqrstuvwxyz0123456789_.")
SLUG_CHARS = frozenset("abcdefghijklmnopqrstuvwxyz0123456789")
MAX_JSON_DEPTH = 32
MAX_JSON_BODY_BYTES = 1_000_000


def has_control(text: str) -> bool:
    return any(ch in CONTROL_CHARS for ch in text)


# --- account fields -------------------------------------------------------


def clean_email(raw: Any, field: str = "email") -> str:
    if not isinstance(raw, str):
        raise invalid(field)
    if len(raw) > 254 or not raw:
        raise invalid(field)
    if has_control(raw) or any(ch.isspace() for ch in raw):
        raise invalid(field)
    if raw.count("@") != 1:
        raise invalid(field)
    local, _, domain = raw.partition("@")
    if not local or not domain:
        raise invalid(field)
    labels = domain.split(".")
    if len(labels) < 2 or any(not label for label in labels):
        raise invalid(field)
    return raw.lower()


def clean_display_name(raw: Any, field: str = "display_name") -> str:
    if not isinstance(raw, str):
        raise invalid(field)
    value = unicodedata.normalize("NFC", raw.strip())
    if not value or len(value) > 32 or has_control(value):
        raise invalid(field)
    return value


def clean_username(raw: Any, field: str = "username") -> str:
    if not isinstance(raw, str):
        raise invalid(field)
    if not 2 <= len(raw) <= 32 or any(ch not in USERNAME_CHARS for ch in raw):
        raise invalid(field)
    return raw


def clean_password(raw: Any, field: str = "password") -> str:
    if not isinstance(raw, str):
        raise invalid(field)
    if not 8 <= len(raw) <= 128:
        raise invalid(field)
    return raw


def clean_date_of_birth(raw: Any, field: str = "date_of_birth") -> date:
    if not isinstance(raw, str) or len(raw) != 10:
        raise invalid(field)
    try:
        born = date.fromisoformat(raw)
    except ValueError:
        raise invalid(field) from None
    today = datetime.now(timezone.utc).date()
    if born >= today:
        raise invalid(field)
    if thirteenth_birthday(born) > today:
        raise invalid(field)
    return born


def thirteenth_birthday(born: date) -> date:
    """The day the person turns 13; a 29 February birthday counts as 1 March."""
    year = born.year + 13
    try:
        return born.replace(year=year)
    except ValueError:
        return date(year, 3, 1)


def clean_slug(raw: Any, field: str = "slug") -> str:
    if not isinstance(raw, str):
        raise invalid(field)
    if not 3 <= len(raw) <= 40:
        raise invalid(field)
    groups = raw.split("-")
    if any(not group or any(ch not in SLUG_CHARS for ch in group) for group in groups):
        raise invalid(field)
    return raw


# --- request readers ------------------------------------------------------


def _strict_percent_decode(raw: bytes) -> str:
    out = bytearray()
    i = 0
    while i < len(raw):
        byte = raw[i]
        if byte == 0x25 and i + 2 < len(raw):
            try:
                out.append(int(raw[i + 1 : i + 3].decode("ascii"), 16))
            except ValueError:
                raise UnicodeDecodeError("percent", raw, i, i + 3, "broken escape") from None
            i += 3
            continue
        if byte == 0x25:
            raise UnicodeDecodeError("percent", raw, i, len(raw), "broken escape")
        out.append(0x20 if byte == 0x2B else byte)
        i += 1
    return out.decode("utf-8")


def decode_path_segment(raw: bytes) -> str:
    """Percent-decode one path segment, refusing NUL and invalid UTF-8."""
    out = bytearray()
    i = 0
    while i < len(raw):
        if raw[i] == 0x25:
            if i + 2 >= len(raw):
                raise UnicodeDecodeError("percent", raw, i, len(raw), "broken escape")
            try:
                out.append(int(raw[i + 1 : i + 3].decode("ascii"), 16))
            except ValueError:
                raise UnicodeDecodeError("percent", raw, i, i + 3, "broken escape") from None
            i += 3
            continue
        out.append(raw[i])
        i += 1
    text = out.decode("utf-8")
    if "\x00" in text:
        raise UnicodeDecodeError("nul", raw, 0, len(raw), "nul byte")
    return text


class Query:
    """Query parameters, decoded strictly only for the names an endpoint reads."""

    def __init__(self, query_string: bytes) -> None:
        self._raw: dict[str, bytes] = {}
        for pair in query_string.split(b"&"):
            if not pair:
                continue
            name, _, value = pair.partition(b"=")
            try:
                key = _strict_percent_decode(name)
            except (UnicodeDecodeError, ValueError):
                continue
            self._raw.setdefault(key, value)

    def has(self, name: str) -> bool:
        return name in self._raw

    def get(self, name: str, default: str | None = None) -> str | None:
        if name not in self._raw:
            return default
        try:
            value = _strict_percent_decode(self._raw[name])
        except (UnicodeDecodeError, ValueError):
            raise invalid(name) from None
        if "\x00" in value:
            raise invalid(name)
        return value

    def whole_number(self, name: str, default: int, low: int, high: int) -> int:
        raw = self.get(name)
        if raw is None or raw == "":
            return default
        if not raw.isdigit() and not (raw.startswith("-") and raw[1:].isdigit()):
            raise invalid(name)
        value = int(raw)
        if not low <= value <= high:
            raise invalid(name)
        return value

    def flag(self, name: str) -> bool:
        return self.get(name) == "true"


def _json_depth_ok(value: Any, depth: int = 1) -> bool:
    if depth > MAX_JSON_DEPTH:
        return False
    if isinstance(value, dict):
        return all(_json_depth_ok(item, depth + 1) for item in value.values())
    if isinstance(value, list):
        return all(_json_depth_ok(item, depth + 1) for item in value)
    return True


def _json_strings_ok(value: Any) -> bool:
    if isinstance(value, str):
        try:
            value.encode("utf-8")
        except UnicodeEncodeError:
            return False
        return True
    if isinstance(value, dict):
        return all(
            _json_strings_ok(key) and _json_strings_ok(item) for key, item in value.items()
        )
    if isinstance(value, list):
        return all(_json_strings_ok(item) for item in value)
    return True


def parse_json_object(raw: bytes) -> dict[str, Any]:
    """Read a JSON request body, refusing anything unreadable with field null."""
    if not raw.strip():
        return {}
    try:
        value = json.loads(raw.decode("utf-8", errors="strict"))
    except (ValueError, UnicodeDecodeError):
        raise invalid(None) from None
    if not isinstance(value, dict):
        raise invalid(None)
    if not _json_depth_ok(value) or not _json_strings_ok(value):
        raise invalid(None)
    return value


class Body:
    """A JSON object body, read field by field with the hostile-input checks."""

    def __init__(self, data: dict[str, Any]) -> None:
        self.data = data

    def has(self, name: str) -> bool:
        return name in self.data

    def raw(self, name: str, default: Any = None) -> Any:
        value = self.data.get(name, default)
        if isinstance(value, str) and "\x00" in value:
            raise invalid(name)
        return value

    def text(self, name: str, default: str | None = None) -> str | None:
        value = self.raw(name, default)
        if value is None:
            return None
        if not isinstance(value, str):
            raise invalid(name)
        return value

    def required_text(self, name: str) -> str:
        value = self.text(name)
        if value is None:
            raise invalid(name)
        return value

    def boolean(self, name: str) -> bool | None:
        value = self.raw(name)
        if value is None:
            return None
        if not isinstance(value, bool):
            raise invalid(name)
        return value

    def whole_number(self, name: str, low: int, high: int) -> int:
        value = self.raw(name)
        if isinstance(value, bool) or not isinstance(value, int):
            raise invalid(name)
        if not low <= value <= high:
            raise invalid(name)
        return value

    def string_list(self, name: str, limit: int) -> list[str] | None:
        value = self.raw(name)
        if value is None:
            return None
        if not isinstance(value, list) or len(value) > limit:
            raise invalid(name)
        items: list[str] = []
        for item in value:
            if not isinstance(item, str) or "\x00" in item:
                raise invalid(name)
            items.append(item)
        return items

    def id_list(self, name: str, limit: int) -> list[int] | None:
        value = self.raw(name)
        if value is None:
            return None
        if not isinstance(value, list) or len(value) > limit:
            raise invalid(name)
        items: list[int] = []
        for item in value:
            if isinstance(item, bool) or not isinstance(item, int) or not 1 <= item <= 2147483647:
                raise invalid(name)
            items.append(item)
        return items

    def one_of(self, name: str, allowed: Iterable[str]) -> str | None:
        value = self.text(name)
        if value is None:
            return None
        if value not in set(allowed):
            raise invalid(name)
        return value


def bounded_text(
    body: Body, name: str, low: int, high: int, *, required: bool = True
) -> str | None:
    """A trimmed free-text field counted in code points."""
    value = body.text(name)
    if value is None:
        if required:
            raise invalid(name)
        return None
    value = value.strip()
    if not low <= len(value) <= high:
        raise invalid(name)
    return value


__all__ = [
    "ApiError",
    "Body",
    "Query",
    "bounded_text",
    "clean_date_of_birth",
    "clean_display_name",
    "clean_email",
    "clean_password",
    "clean_slug",
    "clean_username",
    "decode_path_segment",
    "has_control",
    "parse_json_object",
    "thirteenth_birthday",
]

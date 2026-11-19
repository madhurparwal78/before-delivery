"""Typed reads of a JSON body and a query string. Every refusal names the offending field.

The error precedence puts field validation after the resource and permission steps, so handlers read
fields only when they are ready to validate them, in the order the endpoint lists them.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import unquote_to_bytes

from .errors import invalid

_MISSING = object()
_WHOLE = re.compile(r"\d{1,18}")


def _clean(name: str, value: str) -> str:
    if "\x00" in value:
        raise invalid(name)
    return value


class Body:
    def __init__(self, data: dict[str, Any]):
        self.data = data

    def has(self, name: str) -> bool:
        return name in self.data

    def raw(self, name: str) -> Any:
        return self.data.get(name)

    def string(self, name: str, default: Any = _MISSING, *, strip: bool = False,
               min_length: int = 0, max_length: int | None = None) -> Any:
        if name not in self.data or self.data[name] is None:
            if default is _MISSING:
                raise invalid(name)
            return default
        value = self.data[name]
        if not isinstance(value, str):
            raise invalid(name)
        _clean(name, value)
        if strip:
            value = value.strip()
        if len(value) < min_length or (max_length is not None and len(value) > max_length):
            raise invalid(name)
        return value

    def boolean(self, name: str, default: Any = _MISSING) -> Any:
        if name not in self.data or self.data[name] is None:
            if default is _MISSING:
                raise invalid(name)
            return default
        if not isinstance(self.data[name], bool):
            raise invalid(name)
        return self.data[name]

    def integer(self, name: str, default: Any = _MISSING, *, low: int | None = None, high: int | None = None) -> Any:
        if name not in self.data or self.data[name] is None:
            if default is _MISSING:
                raise invalid(name)
            return default
        value = self.data[name]
        if isinstance(value, bool) or not isinstance(value, int):
            raise invalid(name)
        if (low is not None and value < low) or (high is not None and value > high):
            raise invalid(name)
        return value

    def strings(self, name: str, default: Any = _MISSING, *, allowed: set[str] | None = None) -> Any:
        if name not in self.data or self.data[name] is None:
            if default is _MISSING:
                raise invalid(name)
            return default
        value = self.data[name]
        if not isinstance(value, list) or not all(isinstance(x, str) for x in value):
            raise invalid(name)
        for item in value:
            _clean(name, item)
        if allowed is not None and not set(value) <= allowed:
            raise invalid(name)
        return value

    def integers(self, name: str, default: Any = _MISSING, *, max_items: int | None = None) -> Any:
        if name not in self.data or self.data[name] is None:
            if default is _MISSING:
                raise invalid(name)
            return default
        value = self.data[name]
        if (not isinstance(value, list) or any(isinstance(x, bool) or not isinstance(x, int) for x in value)
                or (max_items is not None and len(value) > max_items)):
            raise invalid(name)
        return value


class Query:
    """Lazy reader of the raw query string: only parameters an endpoint reads are decoded."""

    def __init__(self, query_string: str):
        self._pairs = [p.split("=", 1) if "=" in p else [p, ""] for p in query_string.split("&") if p]

    def _decode(self, text: str) -> bytes:
        return unquote_to_bytes(text.replace("+", " "))

    def value(self, name: str) -> str | None:
        for key, raw in self._pairs:
            if self._decode(key).decode("utf-8", "replace") == name:
                try:
                    text = self._decode(raw).decode("utf-8")
                except UnicodeDecodeError:
                    raise invalid(name) from None
                return _clean(name, text)
        return None

    def string(self, name: str, default: Any = None) -> Any:
        value = self.value(name)
        return default if value is None else value

    def integer(self, name: str, default: int | None, low: int, high: int | None = None) -> int | None:
        value = self.value(name)
        if value is None or value == "":
            return default
        if not _WHOLE.fullmatch(value):
            raise invalid(name)
        number = int(value)
        if number < low or (high is not None and number > high):
            raise invalid(name)
        return number

    def choice(self, name: str, choices: Any, default: str) -> str:
        value = self.value(name)
        if value is None or value == "":
            return default
        if value not in choices:
            raise invalid(name)
        return value

    def flag(self, name: str) -> bool:
        value = self.value(name)
        if value is None or value == "":
            return False
        if value not in ("true", "false"):
            raise invalid(name)
        return value == "true"

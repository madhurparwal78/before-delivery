"""Input forms: the strict JSON reader, required body fields, path ids, slugs and query numbers."""

import json
import re
from typing import Any

from .errors import ApiError, validation

MAX_DEPTH = 32
MAX_ID = 9223372036854775807
SLUG_MAX = 64
_DIGITS = re.compile(r"[1-9][0-9]*")


def _invalid_json() -> ApiError:
    return ApiError(400, "invalid_json")


def _unique_members(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate member name")
        result[key] = value
    return result


def _no_constants(name: str) -> None:
    raise ValueError(f"{name} is not JSON")


def _check_tree(value: Any) -> None:
    """Refuse nesting deeper than MAX_DEPTH and strings holding a lone surrogate."""
    stack = [(value, 1)]
    while stack:
        item, depth = stack.pop()
        if isinstance(item, dict):
            if depth > MAX_DEPTH:
                raise ValueError("too deep")
            for key, child in item.items():
                key.encode("utf-8")
                stack.append((child, depth + 1))
        elif isinstance(item, list):
            if depth > MAX_DEPTH:
                raise ValueError("too deep")
            stack.extend((child, depth + 1) for child in item)
        elif isinstance(item, str):
            item.encode("utf-8")


def json_object(body: bytes) -> dict[str, Any]:
    """A strict JSON object: UTF-8, no NaN or Infinity, no repeated names, no lone surrogates, depth <= 32."""
    try:
        value = json.loads(body.decode("utf-8"), object_pairs_hook=_unique_members, parse_constant=_no_constants)
        _check_tree(value)
    except (ValueError, RecursionError):  # UnicodeError is a ValueError
        raise _invalid_json() from None
    if not isinstance(value, dict):
        raise _invalid_json()
    return value


def required(body: dict[str, Any], *names: str) -> dict[str, str]:
    """Each named field must be a string that is not blank after trimming and holds no U+0000."""
    failing = {}
    for name in names:
        value = body.get(name)
        if not isinstance(value, str) or not value.strip():
            failing[name] = "This field is required."
        elif "\x00" in value:
            failing[name] = "This field cannot contain a NUL character."
    if failing:
        raise validation(failing)
    return {name: body[name] for name in names}


def path_id(raw: str) -> int | None:
    """ASCII digits, no sign, no leading zero, at most 2**63 - 1; anything else names nobody."""
    if not _DIGITS.fullmatch(raw) or int(raw) > MAX_ID:
        return None
    return int(raw)


def path_slug(raw: str) -> str | None:
    if "\x00" in raw or not raw.isascii() or len(raw) > SLUG_MAX:
        return None
    return raw


def query_number(params: dict[str, list[str]], name: str, default: int) -> int:
    values = params.get(name)
    if values is None:
        return default
    if len(values) != 1 or not _DIGITS.fullmatch(values[0]) or int(values[0]) > MAX_ID:
        raise validation({name: f"{name} must be a whole number from 1."})
    return int(values[0])


def query_flag(params: dict[str, list[str]], name: str) -> bool:
    values = params.get(name)
    if values is None:
        return False
    if len(values) != 1 or values[0] not in ("0", "1"):
        raise validation({name: f"{name} must be 0 or 1."})
    return values[0] == "1"

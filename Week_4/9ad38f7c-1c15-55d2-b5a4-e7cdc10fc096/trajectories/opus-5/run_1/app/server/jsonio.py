"""Strict JSON reading, applied in one place for every body route."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from .errors import ApiError
from .times import as_iso

MAX_DEPTH = 32


class _DuplicateMember(ValueError):
    pass


def _no_duplicate_members(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    seen: dict[str, Any] = {}
    for name, value in pairs:
        if name in seen:
            raise _DuplicateMember(name)
        seen[name] = value
    return seen


def _refuse_constant(name: str) -> Any:
    raise ValueError(f"{name} is not accepted")


def _depth_within_limit(text: str) -> bool:
    depth = 0
    in_string = False
    escaped = False
    for character in text:
        if in_string:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                in_string = False
            continue
        if character == '"':
            in_string = True
        elif character in "{[":
            depth += 1
            if depth > MAX_DEPTH:
                return False
        elif character in "}]":
            depth -= 1
    return True


def _holds_lone_surrogate(value: Any) -> bool:
    if isinstance(value, str):
        return any("\ud800" <= character <= "\udfff" for character in value)
    if isinstance(value, dict):
        return any(
            _holds_lone_surrogate(name) or _holds_lone_surrogate(item)
            for name, item in value.items()
        )
    if isinstance(value, list):
        return any(_holds_lone_surrogate(item) for item in value)
    return False


def invalid_json() -> ApiError:
    return ApiError(400, "invalid_json")


def read_json_object(raw: bytes) -> dict[str, Any]:
    """Read a strict JSON object, refusing every form named in the brief."""
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise invalid_json() from error
    if not _depth_within_limit(text):
        raise invalid_json()
    try:
        value = json.loads(
            text,
            object_pairs_hook=_no_duplicate_members,
            parse_constant=_refuse_constant,
        )
    except (ValueError, RecursionError) as error:
        raise invalid_json() from error
    if not isinstance(value, dict):
        raise invalid_json()
    if _holds_lone_surrogate(value):
        raise invalid_json()
    return value


def _as_published(value: Any) -> str:
    """Every time leaves as an ISO 8601 UTC string with seconds and a Z suffix."""
    if isinstance(value, datetime):
        return as_iso(value)
    raise TypeError(f"{type(value).__name__} is not part of the published surface")


def dump(payload: Any) -> bytes:
    return json.dumps(
        payload, ensure_ascii=False, allow_nan=False, default=_as_published
    ).encode("utf-8")

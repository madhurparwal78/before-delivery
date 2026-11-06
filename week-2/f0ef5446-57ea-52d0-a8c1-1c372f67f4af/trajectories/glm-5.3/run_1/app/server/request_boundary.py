"""The request body boundary: size, media type and malformed-JSON checks.

A malformed body is never stored and never touches the idempotency store.
"""
from __future__ import annotations

import json
import re
from typing import Any

MAX_BODY_BYTES = 65536
MAX_DEPTH = 32
MAX_NUMBER_CHARS = 64
_NUMBER_TOKEN = re.compile(
    r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?"
)


class InvalidJSON(Exception):
    """The body fails the malformed-JSON rule."""


def validate_body(raw: bytes) -> Any:
    """Return the parsed top-level object, or raise InvalidJSON."""
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise InvalidJSON() from exc
    try:
        value = json.loads(
            text,
            parse_constant=_reject_constant,
            object_pairs_hook=_reject_duplicate_pairs,
        )
    except ValueError as exc:
        raise InvalidJSON() from exc
    if not isinstance(value, dict):
        raise InvalidJSON()
    _check_depth(value, 1)
    _check_number_literals(text)
    return value


def _reject_constant(name: str) -> Any:
    raise InvalidJSON()


def _reject_duplicate_pairs(pairs: list[tuple[str, Any]]) -> dict:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise InvalidJSON()
        result[key] = value
    return result


def _check_depth(value: Any, depth: int) -> None:
    """The top-level object is level 1; each container inside adds one."""
    if isinstance(value, dict):
        if depth > MAX_DEPTH:
            raise InvalidJSON()
        for entry in value.values():
            _check_depth(entry, depth + 1)
    elif isinstance(value, list):
        if depth > MAX_DEPTH:
            raise InvalidJSON()
        for entry in value:
            _check_depth(entry, depth + 1)


def _check_number_literals(text: str) -> None:
    """A number literal longer than 64 characters is malformed."""
    stripped = re.sub(r'"(?:[^"\\]|\\.)*"', '""', text)
    for match in _NUMBER_TOKEN.finditer(stripped):
        if len(match.group(0)) > MAX_NUMBER_CHARS:
            raise InvalidJSON()

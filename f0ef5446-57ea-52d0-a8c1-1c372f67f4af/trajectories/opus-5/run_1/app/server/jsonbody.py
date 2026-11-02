"""Strict JSON body parsing for the server boundary."""

from __future__ import annotations

import json
import math
from typing import Any

MAX_DEPTH = 32
MAX_NUMBER_LITERAL = 64


class InvalidJson(Exception):
    """The body is not an acceptable JSON object."""


def _reject_constant(literal: str) -> Any:
    raise InvalidJson(f"non-finite literal: {literal}")


def _object_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    seen: set[str] = set()
    for name, _ in pairs:
        if name in seen:
            raise InvalidJson(f"repeated member name: {name}")
        seen.add(name)
    return dict(pairs)


def _check_number(literal: str) -> None:
    if len(literal) > MAX_NUMBER_LITERAL:
        raise InvalidJson("number literal too long")


def _parse_int(literal: str) -> int:
    _check_number(literal)
    return int(literal)


def _parse_float(literal: str) -> float:
    _check_number(literal)
    return float(literal)


def _max_depth(text: str) -> int:
    depth = 0
    deepest = 0
    in_string = False
    escaped = False
    for char in text:
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char in "{[":
            depth += 1
            deepest = max(deepest, depth)
        elif char in "}]":
            depth -= 1
    return deepest


def parse_json_object(raw: bytes) -> dict[str, Any]:
    """Parse a request body into a JSON object, or raise InvalidJson."""
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise InvalidJson("body is not valid UTF-8") from exc

    if _max_depth(text) > MAX_DEPTH:
        raise InvalidJson("nested too deeply")

    try:
        value = json.loads(
            text,
            object_pairs_hook=_object_pairs,
            parse_constant=_reject_constant,
            parse_int=_parse_int,
            parse_float=_parse_float,
        )
    except InvalidJson:
        raise
    except (json.JSONDecodeError, ValueError, RecursionError) as exc:
        raise InvalidJson("body does not parse") from exc

    if not isinstance(value, dict):
        raise InvalidJson("top level is not an object")
    return value


def json_safe(value: Any) -> Any:
    """Make a parsed value safe to serialise again, keeping it as sent."""
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {name: json_safe(item) for name, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    return value


def canonical_json(value: Any) -> str:
    """A canonical text for the JSON equality rule of Idempotency-Key bodies."""
    return json.dumps(
        _canonical(value),
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=True,
    )


def _canonical(value: Any) -> Any:
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, int):
        return f"n:{value}"
    if isinstance(value, float):
        if math.isfinite(value) and value == int(value) and abs(value) < 1e15:
            return f"n:{int(value)}"
        return f"n:{value!r}"
    if isinstance(value, dict):
        return {name: _canonical(item) for name, item in value.items()}
    if isinstance(value, list):
        return [_canonical(item) for item in value]
    return f"s:{value}"

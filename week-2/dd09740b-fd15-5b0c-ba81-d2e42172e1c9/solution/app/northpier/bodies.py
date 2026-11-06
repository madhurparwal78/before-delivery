"""Request bodies and Idempotency-Key headers, checked before any value is used."""
import json
import re
from typing import Any

from django.http import HttpRequest

from northpier.errors import Refusal

BODY_LIMIT = 65536
NESTING_LIMIT = 32
KEY_PATTERN = re.compile(r"[A-Za-z0-9_-]{8,64}")
INT_DIGITS = 4000


class HugeInt:
    """An integer literal too long for a Python int: a valid JSON number that is never a usable value."""

    def __init__(self, digits: str) -> None:
        self.digits = digits


def _parse_int(digits: str) -> int | HugeInt:
    return int(digits) if len(digits) <= INT_DIGITS else HugeInt(digits)


def _reject_constant(_name: str) -> None:
    raise ValueError("not JSON")


def _nesting(text: str) -> int:
    """Deepest container nesting, scanning outside string literals."""
    depth = deepest = 0
    in_string = escaped = False
    for char in text:
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
        elif char in "[{":
            depth += 1
            deepest = max(deepest, depth)
        elif char in "]}":
            depth -= 1
    return deepest


def json_object(request: HttpRequest) -> dict[str, Any]:
    """The body as a JSON object, or the invalid-body refusal."""
    try:
        text = request.body.decode("utf-8")
        if _nesting(text) > NESTING_LIMIT:
            raise ValueError("too deep")
        value = json.loads(text, parse_int=_parse_int, parse_constant=_reject_constant)
    except ValueError as error:
        raise Refusal("body") from error
    if not isinstance(value, dict):
        raise Refusal("body")
    return value


def idempotency_key(request: HttpRequest) -> str | None:
    """The Idempotency-Key header when sent, or the malformed-key refusal."""
    key = request.headers.get("Idempotency-Key")
    if key is None:
        return None
    if not KEY_PATTERN.fullmatch(key):
        raise Refusal("key")
    return key


def canonical_json(value: Any) -> str:
    """Keys sorted at every depth, no whitespace, every non-ASCII character escaped (storable as text)."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
                      default=lambda huge: {"$int": huge.digits})

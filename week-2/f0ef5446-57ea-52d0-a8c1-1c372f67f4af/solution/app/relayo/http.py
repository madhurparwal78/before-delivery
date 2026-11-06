"""The server boundary: request bodies, strict JSON, and the one error shape."""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any

from werkzeug.wrappers import Request, Response

BODY_LIMIT_BYTES = 65536
MAX_DEPTH = 32
MAX_NUMBER_CHARS = 64
JSON_TYPE = "application/json; charset=utf-8"


class ApiError(Exception):
    """An answer from the published error table, raised wherever a check refuses a request."""

    def __init__(self, http_status: int, code: str, headers: dict[str, str] | None = None, **extra: Any) -> None:
        super().__init__(code)
        self.http_status = http_status
        self.code = code
        self.headers = headers or {}
        self.extra = extra

    def response(self) -> Response:
        return error_response(self.http_status, self.code, self.headers, **self.extra)


def json_text(payload: Any) -> str:
    """Serialise for the wire: ASCII-only, so lone surrogates travel as JSON escapes."""
    return json.dumps(payload, ensure_ascii=True, separators=(",", ":"))


def json_response(status: int, payload: Any, headers: dict[str, str] | None = None) -> Response:
    return Response(json_text(payload), status=status, headers=headers or {}, content_type=JSON_TYPE)


def error_payload(code: str, **extra: Any) -> dict[str, Any]:
    """The one error shape: an `error` code plus the documented extra fields."""
    return {"error": code, **extra}


def error_response(http_status: int, code: str, headers: dict[str, str] | None = None, **extra: Any) -> Response:
    return json_response(http_status, error_payload(code, **extra), headers)


def read_body(request: Request) -> bytes:
    """Step 1 of the check order: refuse a body over the limit before reading it all."""
    declared = request.content_length
    if declared is not None and declared > BODY_LIMIT_BYTES:
        raise ApiError(413, "payload_too_large")
    body = request.stream.read(BODY_LIMIT_BYTES + 1)
    if len(body) > BODY_LIMIT_BYTES:
        raise ApiError(413, "payload_too_large")
    return body


def require_json_media_type(request: Request) -> None:
    if request.mimetype != "application/json":
        raise ApiError(415, "unsupported_media_type")


class _Malformed(ValueError):
    pass


def _too_deep(text: str) -> bool:
    depth = 0
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
            if depth > MAX_DEPTH:
                return True
        elif char in "]}":
            depth -= 1
    return False


def _object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    names = [name for name, _ in pairs]
    if len(set(names)) != len(names):
        raise _Malformed("repeated member name")
    return dict(pairs)


def _number(literal: str) -> Decimal:
    if len(literal) > MAX_NUMBER_CHARS:
        raise _Malformed("number literal too long")
    return Decimal(literal)


def _constant(name: str) -> Any:
    raise _Malformed(f"{name} is not JSON")


def parse_json_object(body: bytes) -> dict[str, Any]:
    """Step 5: the body must be one JSON object under the boundary rules, else 400 invalid_json."""
    try:
        text = body.decode("utf-8")
        if _too_deep(text):
            raise _Malformed("nested too deeply")
        value = json.loads(text, object_pairs_hook=_object, parse_float=_number, parse_int=_number,
                           parse_constant=_constant)
    except (ValueError, RecursionError) as error:
        raise ApiError(400, "invalid_json") from error
    if not isinstance(value, dict):
        raise ApiError(400, "invalid_json")
    return value

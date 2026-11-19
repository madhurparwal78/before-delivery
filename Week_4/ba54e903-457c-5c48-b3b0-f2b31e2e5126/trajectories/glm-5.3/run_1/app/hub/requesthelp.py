"""Request helpers: the JSON body envelope, hostile input and origin checks."""
from __future__ import annotations

import json
from typing import Any, Optional

from starlette.requests import Request

from .errors import ApiError


def check_query_value(name: str, value: Optional[str]) -> str:
    """Hostile input: NUL or broken UTF-8 in a read query parameter names it (DP-99)."""
    if value is None:
        return ""
    if "\x00" in value:
        raise ApiError("validation_failed", field=name)
    if "\ufffd" in value:
        # a replacement character means the raw bytes were not valid UTF-8
        raise ApiError("validation_failed", field=name)
    return value


def check_raw_query(request: Request, name: str) -> Optional[str]:
    """Percent-decode one query parameter strictly, naming it on broken encoding."""
    raw = request.scope.get("query_string", b"")
    if isinstance(raw, str):
        raw = raw.encode("latin-1")
    from urllib.parse import unquote_to_bytes
    for pair in raw.split(b"&"):
        if not pair:
            continue
        key, _, value = pair.partition(b"=")
        key_bytes = unquote_to_bytes(key)
        if not _is_valid_utf8(key_bytes):
            continue
        if key_bytes.decode("utf-8") != name:
            continue
        value_bytes = unquote_to_bytes(value)
        if b"\x00" in value_bytes or not _is_valid_utf8(value_bytes):
            raise ApiError("validation_failed", field=name)
        return value_bytes.decode("utf-8")
    return None


def _is_valid_utf8(data: bytes) -> bool:
    try:
        data.decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False


async def parse_json_body(request: Request) -> dict:
    """Read a JSON object body under the shared rules (DP-99)."""
    length_header = request.headers.get("content-length")
    if length_header and length_header.isdigit() and int(length_header) > 1_000_000:
        raise ApiError("payload_too_large")
    ctype = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if ctype and ctype not in ("application/json", ""):
        raise ApiError("unsupported_media_type")
    body = await request.body()
    if len(body) > 1_000_000:
        raise ApiError("payload_too_large")
    if not ctype:
        raise ApiError("unsupported_media_type")
    try:
        obj = json.loads(body.decode("utf-8"))
    except UnicodeDecodeError:
        raise ApiError("validation_failed", field=None)
    except json.JSONDecodeError:
        raise ApiError("validation_failed", field=None)
    if not isinstance(obj, dict):
        raise ApiError("validation_failed", field=None)
    _check_depth_and_surrogates(obj)
    return obj


def _check_depth_and_surrogates(obj: Any, depth: int = 1) -> None:
    """Only arrays and objects count as a nesting level; exactly 32 is allowed."""
    if isinstance(obj, dict):
        if depth > 32:
            raise ApiError("validation_failed", field=None)
        for key, value in obj.items():
            if isinstance(key, str) and any(0xD800 <= ord(c) <= 0xDFFF for c in key):
                raise ApiError("validation_failed", field=None)
            _check_depth_and_surrogates(value, depth + 1)
    elif isinstance(obj, list):
        if depth > 32:
            raise ApiError("validation_failed", field=None)
        for value in obj:
            _check_depth_and_surrogates(value, depth + 1)
    elif isinstance(obj, str):
        if any(0xD800 <= ord(c) <= 0xDFFF for c in obj):
            raise ApiError("validation_failed", field=None)


def field_nul(value: Any) -> bool:
    """True when a JSON string field the endpoint reads holds U+0000."""
    return isinstance(value, str) and "\x00" in value


def check_origin(request: Request, public_origin: str) -> None:
    """Cross-site requests: refuse foreign or null Origin before authentication (DP-07)."""
    origin = request.headers.get("origin")
    if origin is None:
        return
    if origin == public_origin:
        return
    host = request.headers.get("host")
    if host:
        if origin == f"http://{host}" or origin == f"https://{host}":
            return
    raise ApiError("forbidden")

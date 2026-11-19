"""The API request pipeline, in the brief's error-precedence order.

1. route (404, 405)  2. origin (403)  3. authentication (401)  4. body envelope (413, 415, 422)
then the handler: resource, permission, keys, state and field validation, in that order.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from email.utils import formatdate
from typing import Any, Callable
from urllib.parse import unquote_to_bytes

from flask import Response, g, jsonify, request

from . import auth, config
from .errors import ApiError
from .inputs import Body, Query

INT_MAX = 2147483647
BODY_LIMIT = 1_000_000
JSON_DEPTH_LIMIT = 32
METHOD_ORDER = ("GET", "POST", "PUT", "PATCH", "DELETE")
BODY_METHODS = ("POST", "PUT", "PATCH")
UNSAFE_METHODS = ("POST", "PUT", "PATCH", "DELETE")
INTEGER_PARAMS = {"id", "user_id", "role_id", "channel_id", "message_id", "target_id", "attachment_id"}
_WHOLE = re.compile(r"[0-9]+")


@dataclass
class Route:
    method: str
    pattern: str
    parts: list[str]
    handler: Callable[..., Any]
    session: str
    body: str | None


ROUTES: list[Route] = []


def route(method: str, pattern: str, *, session: str = "none", body: str | None = None):
    """Register an API handler. ``session``: none, required or optional. ``body``: json, multipart or None."""

    def register(handler: Callable[..., Any]) -> Callable[..., Any]:
        ROUTES.append(Route(method, pattern, pattern.split("/"), handler, session, body))
        return handler

    return register


def _segments() -> list[str]:
    """The request path split on literal slashes, each segment percent-decoded as strict UTF-8."""
    raw = request.environ.get("RAW_URI") or request.environ.get("REQUEST_URI") or request.environ.get("PATH_INFO", "")
    path = raw.split("?", 1)[0]
    decoded = []
    for segment in path.split("/"):
        try:
            text = unquote_to_bytes(segment).decode("utf-8")
        except UnicodeDecodeError:
            raise ApiError("not_found") from None
        if "\x00" in text:
            raise ApiError("not_found")
        decoded.append(text)
    return decoded


def _match(route_: Route, segments: list[str]) -> dict[str, Any] | None:
    if len(route_.parts) != len(segments):
        return None
    params: dict[str, Any] = {}
    for pattern_part, segment in zip(route_.parts, segments):
        if pattern_part.startswith("{"):
            name = pattern_part[1:-1]
            if name in INTEGER_PARAMS:
                if not _WHOLE.fullmatch(segment) or not 1 <= int(segment) <= INT_MAX:
                    return None  # a malformed id names no listed path: 404 before any 405
                params[name] = int(segment)
            elif segment == "":
                return None
            else:
                params[name] = segment
        elif pattern_part != segment:
            return None
    return params


def _check_origin() -> None:
    origin = request.headers.get("Origin")
    if origin is None:
        return
    host = request.headers.get("Host", "")
    if origin not in (config.PUBLIC_ORIGIN, f"http://{host}", f"https://{host}"):
        raise ApiError("forbidden")


def _walk(value: Any) -> None:
    """Refuse a body nested deeper than 32 levels or holding an unpaired surrogate."""
    stack = [(value, 1)]
    while stack:
        item, depth = stack.pop()
        if isinstance(item, str):
            try:
                item.encode("utf-8")
            except UnicodeEncodeError:
                raise ApiError("validation_failed") from None
        elif isinstance(item, (list, dict)):
            if depth > JSON_DEPTH_LIMIT:
                raise ApiError("validation_failed")
            children = item.items() if isinstance(item, dict) else enumerate(item)
            for key, child in children:
                if isinstance(item, dict):
                    stack.append((key, depth))
                stack.append((child, depth + 1))


def _drain(limit: int = 1 << 30) -> None:
    stream = request.stream
    taken = 0
    while taken < limit:
        chunk = stream.read(1 << 20)
        if not chunk:
            return
        taken += len(chunk)


def _read_body(kind: str) -> None:
    mimetype = request.mimetype
    length = request.content_length
    if kind == "multipart":
        if mimetype != "multipart/form-data":
            _drain()
            raise ApiError("unsupported_media_type")
        return
    if length is None and not request.headers.get("Transfer-Encoding"):
        length = 0
    if length == 0:
        g.body = Body({})
        return
    if mimetype != "application/json":
        raise ApiError("unsupported_media_type")
    if length is not None and length > BODY_LIMIT:
        _drain()
        raise ApiError("payload_too_large")
    raw = request.stream.read(BODY_LIMIT + 1)
    if len(raw) > BODY_LIMIT:
        _drain()
        raise ApiError("payload_too_large")
    try:
        data = json.loads(raw.decode("utf-8"), parse_constant=_reject_constant)
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise ApiError("validation_failed") from None
    if not isinstance(data, dict):
        raise ApiError("validation_failed")
    _walk(data)
    g.body = Body(data)


def _reject_constant(name: str) -> Any:
    raise ValueError(name)


def finish(result: Any) -> Response:
    """Turn a handler result into a response: None is 204, (data, status) a JSON status, else JSON 200."""
    if isinstance(result, Response):
        return result
    if result is None:
        return Response(status=204)
    if isinstance(result, tuple):
        data, status = result
        response = jsonify(data) if data is not None else Response()
        response.status_code = status
        return response
    return jsonify(result)


def dispatch(rest: str = "") -> Response:
    segments = _segments()
    matched = [(r, p) for r in ROUTES if (p := _match(r, segments)) is not None]
    if not matched:
        raise ApiError("not_found")
    allowed = [m for m in METHOD_ORDER if any(r.method == m for r, _ in matched)]
    chosen = next(((r, p) for r, p in matched if r.method == request.method), None)
    if chosen is None:
        raise ApiError("method_not_allowed", headers={"Allow": ", ".join(allowed)})
    route_, params = chosen
    g.session_mode = route_.session
    if route_.method in UNSAFE_METHODS or route_.pattern == "/api/live":
        _check_origin()
    auth.authenticate(route_.session)
    g.query = Query(request.query_string.decode("utf-8", "replace") if request.query_string else "")
    g.body = Body({})
    if route_.body and route_.method in BODY_METHODS:
        _read_body(route_.body)
    return finish(route_.handler(**params))


def decorate(response: Response) -> Response:
    """Headers every API answer carries."""
    response.headers["Date"] = formatdate(usegmt=True)
    if g.get("session_mode") in ("required", "optional"):
        response.headers["Cache-Control"] = "no-store"
        response.headers["Vary"] = "Authorization"
    return response

"""The ASGI application: routing, the origin check, authentication and refusals.

Error precedence is applied here in the stated order: route, origin, authentication,
body envelope, then the handler's own rules.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Mapping, Sequence

import asyncpg
from starlette.requests import Request
from starlette.responses import Response

from .config import CONFIG
from .db import DB
from .errors import ApiError, error_response, response_for
from .users import Caller
from .validation import (
    Body,
    Query,
    decode_path_segment,
    parse_json_object,
)

ID_PARAMS = frozenset(
    {"user_id", "role_id", "channel_id", "message_id", "community_id", "id", "attachment_id"}
)
MAX_ID = 2147483647
UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
METHOD_ORDER = ("GET", "POST", "PUT", "PATCH", "DELETE")
LOG = logging.getLogger("hub")


@dataclass
class Ctx:
    """One request, with nothing kept from any other."""

    request: Request
    method: str
    path: str
    params: dict[str, Any]
    query: Query
    caller: Caller | None
    raw_body: bytes

    def body(self) -> Body:
        return Body(parse_json_object(self.raw_body))

    @property
    def member_id(self) -> int:
        assert self.caller is not None
        return self.caller.id


Handler = Callable[[Ctx], Awaitable[Response]]


@dataclass(frozen=True)
class Route:
    segments: tuple[str, ...]
    methods: Mapping[str, tuple[Handler, str]]  # method -> (handler, session rule)
    kind: str  # "api", "page", "plain"


ROUTES: list[Route] = []


def same_origin(origin: str | None, host: str) -> bool:
    """A request with no Origin proceeds; any other origin must be this app's own."""
    if origin is None:
        return True
    allowed = {CONFIG.public_origin}
    if host:
        allowed |= {f"http://{host}", f"https://{host}"}
    return origin in allowed


def route(pattern: str, methods: Mapping[str, tuple[Handler, str]], kind: str) -> None:
    segments = tuple(pattern.strip("/").split("/")) if pattern != "/" else ("",)
    ROUTES.append(Route(segments, methods, kind))


def match_route(segments: Sequence[str]) -> tuple[Route | None, dict[str, Any]]:
    """Find the route for a path, reading its id parameters as whole numbers."""
    key = tuple(segments)
    for candidate in ROUTES:
        if len(candidate.segments) != len(key):
            continue
        found: dict[str, Any] = {}
        for pattern, value in zip(candidate.segments, key):
            if pattern.startswith("{") and pattern.endswith("}"):
                name = pattern[1:-1]
                if name in ID_PARAMS:
                    if not value.isdigit() or not 1 <= int(value) <= MAX_ID:
                        break
                    found[name] = int(value)
                else:
                    if not value:
                        break
                    found[name] = value
            elif pattern != value:
                break
        else:
            return candidate, found
    return None, {}


class Hub:
    """The product's single ASGI application."""

    def __init__(self) -> None:
        self._tasks: list[asyncio.Task[Any]] = []

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] == "lifespan":
            await self._lifespan(scope, receive, send)
            return
        if scope["type"] == "websocket":
            await self._live_socket(scope, receive, send)
            return
        if scope["type"] != "http":
            return
        response = await self._handle(scope, receive, send)
        if response is not None:
            await response(scope, receive, send)

    async def _live_socket(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        """The live channel, authenticated by its handshake and never by its URL."""
        from .api.live_api import live_socket
        from .auth import caller_for_token

        if scope.get("raw_path", scope["path"].encode()) != b"/api/live":
            await self._deny(send, 404, "not_found")
            return
        headers = {name.decode("latin-1").lower(): value.decode("latin-1")
                   for name, value in scope.get("headers", [])}
        if not same_origin(headers.get("origin"), headers.get("host", "")):
            await self._deny(send, 403, "forbidden")
            return
        protocols = [value.strip() for value in scope.get("subprotocols", [])]
        token = protocols[1] if len(protocols) == 2 and protocols[0] == "bearer" else ""
        caller = None
        if token:
            try:
                caller = await caller_for_token(token)
            except (asyncpg.PostgresError, ConnectionError):
                caller = None
        if caller is None:
            await self._deny(send, 401, "unauthorized")
            return
        await live_socket(caller, receive, send)

    async def _deny(self, send: Any, status: int, code: str) -> None:
        """Refuse a live connection with the shared error body, before any upgrade."""
        await send({
            "type": "websocket.http.response.start",
            "status": status,
            "headers": [(b"content-type", b"application/json")],
        })
        await send({
            "type": "websocket.http.response.body",
            "body": error_response(status, code).body,
        })

    async def _lifespan(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        from .live import DISPATCHER
        from .mail import MAILER

        while True:
            message = await receive()
            if message["type"] == "lifespan.startup":
                await DB.start()
                self._tasks = [
                    asyncio.create_task(MAILER.run()),
                    asyncio.create_task(DISPATCHER.run()),
                ]
                await send({"type": "lifespan.startup.complete"})
            elif message["type"] == "lifespan.shutdown":
                for task in self._tasks:
                    task.cancel()
                for task in self._tasks:
                    with contextlib.suppress(asyncio.CancelledError):
                        await task
                await DB.stop()
                await send({"type": "lifespan.shutdown.complete"})
                return

    async def _handle(self, scope: dict[str, Any], receive: Any, send: Any) -> Response | None:
        from .pages import not_found_page
        from .static_files import static_response

        raw_path: bytes = scope.get("raw_path") or scope["path"].encode("utf-8")
        is_api = raw_path == b"/api" or raw_path.startswith(b"/api/")
        method: str = scope["method"]

        trimmed = raw_path[1:] if raw_path.startswith(b"/") else raw_path
        try:
            segments = [decode_path_segment(part) for part in trimmed.split(b"/")]
        except (UnicodeDecodeError, ValueError):
            return self._miss(is_api)

        if segments[0] == "static":
            if method not in {"GET", "HEAD"}:
                return self._miss(False)
            return static_response(segments[1:], Request(scope, receive), head=method == "HEAD")

        matched, params = match_route(segments)
        if matched is None:
            return self._miss(is_api)

        head_as_get = method == "HEAD" and matched.kind != "api"
        effective_method = "GET" if head_as_get else method
        if effective_method not in matched.methods:
            if matched.kind == "api":
                allow = ", ".join(name for name in METHOD_ORDER if name in matched.methods)
                return error_response(405, "method_not_allowed", None, {"Allow": allow})
            return self._miss(False)

        handler, session = matched.methods[effective_method]
        request = Request(scope, receive)

        origin_refusal = self._origin_refusal(request, matched, effective_method)
        if origin_refusal is not None:
            return origin_refusal

        if not DB.ready and matched.kind == "api" and segments != ["api", "health"]:
            return error_response(503, "rate_limited", None, {"Retry-After": "5"})

        caller: Caller | None = None
        try:
            if session in {"yes", "optional"}:
                caller = await self._caller(request)
                if caller is None and session == "yes":
                    raise ApiError(401, "unauthorized")

            raw_body = b""
            if matched.kind == "api" and effective_method in UNSAFE_METHODS:
                raw_body = await self._read_body(request, segments)

            ctx = Ctx(
                request=request,
                method=effective_method,
                path="/" + "/".join(segments),
                params=params,
                query=Query(scope.get("query_string", b"")),
                caller=caller,
                raw_body=raw_body,
            )
            response = await handler(ctx)
        except ApiError as error:
            if matched.kind == "page":
                return not_found_page()
            response = response_for(error)
        except (asyncpg.PostgresError, ConnectionError, asyncio.TimeoutError):
            LOG.exception("database unavailable for %s", "/".join(segments))
            if matched.kind == "page":
                return not_found_page()
            response = error_response(503, "rate_limited", None, {"Retry-After": "5"})

        if session in {"yes", "optional"}:
            response.headers["Cache-Control"] = "no-store"
            response.headers["Vary"] = "Authorization"
        if head_as_get:
            response = Response(
                b"",
                status_code=response.status_code,
                headers=dict(response.headers),
            )
        return response

    def _miss(self, is_api: bool) -> Response:
        from .pages import not_found_page

        if is_api:
            return error_response(404, "not_found")
        return not_found_page()

    def _origin_refusal(self, request: Request, matched: Route, method: str) -> Response | None:
        if matched.kind != "api":
            return None
        is_live = matched.segments == ("api", "live")
        if method not in UNSAFE_METHODS and not is_live:
            return None
        if same_origin(request.headers.get("origin"), request.headers.get("host", "")):
            return None
        return error_response(403, "forbidden")

    async def _caller(self, request: Request) -> Caller | None:
        from .auth import caller_for_token

        header = request.headers.get("authorization", "")
        if not header.lower().startswith("bearer "):
            return None
        token = header[7:].strip()
        if not token:
            return None
        try:
            return await caller_for_token(token)
        except (asyncpg.PostgresError, ConnectionError):
            return None

    async def _read_body(self, request: Request, segments: Sequence[str]) -> bytes:
        content_type = request.headers.get("content-type", "")
        base_type = content_type.split(";")[0].strip().lower()
        if segments == ["api", "attachments"]:
            if base_type != "multipart/form-data":
                raise ApiError(415, "unsupported_media_type")
            return b""
        chunks: list[bytes] = []
        total = 0
        async for chunk in request.stream():
            total += len(chunk)
            if total > 1_000_000:
                raise ApiError(413, "payload_too_large")
            chunks.append(chunk)
        raw = b"".join(chunks)
        if raw.strip() and base_type != "application/json":
            raise ApiError(415, "unsupported_media_type")
        return raw


APP = Hub()

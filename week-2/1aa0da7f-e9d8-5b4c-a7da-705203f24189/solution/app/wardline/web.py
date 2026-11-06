"""The ASGI request pipeline: routing on raw paths, request limits, the one error shape."""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Self
from urllib.parse import parse_qsl, unquote_to_bytes, urlsplit

from wardline import fields
from wardline.config import CONFIG
from wardline.errors import ApiError, ClientGone, ValidationFailed
from wardline.ledger import encode_target

MAX_JSON = 1_000_000
MAX_FILE = 20_000_000
MAX_MULTIPART = 20_500_000
STALL_SECONDS = 30
STATE_CHANGING = frozenset({"POST", "PUT", "PATCH", "DELETE"})


Scope = dict[str, Any]
Receive = Callable[[], Awaitable[dict[str, Any]]]
Send = Callable[[dict[str, Any]], Awaitable[None]]


class PathId(str):
    """A path id: its text, plus the bytes as decoded once for ledger targets."""

    raw: bytes

    def __new__(cls, raw: bytes) -> Self:
        made = super().__new__(cls, raw.decode("utf-8", "replace"))
        made.raw = raw
        return made


def id_target(value: str) -> str:
    """The encoded ledger target for a path or body id."""
    if isinstance(value, PathId):
        return encode_target(value.raw)
    return encode_target(value.encode("utf-16", "surrogatepass").decode("utf-16", "replace").encode())


@dataclass(slots=True)
class Person:
    id: str
    name: str
    email: str
    role: str
    session_id: str


@dataclass(slots=True)
class Reply:
    status: int
    body: Any = None
    headers: dict[str, str] | None = None


class Request:
    def __init__(self, scope: Scope, receive: Receive, send: Send) -> None:
        self.scope, self.receive, self.send = scope, receive, send
        self.method: str = scope["method"]
        self.raw_path: str = scope.get("raw_path", scope["path"].encode()).decode("latin-1").split("?", 1)[0]
        self.query: dict[str, str] = dict(
            parse_qsl(scope["query_string"].decode("latin-1"), keep_blank_values=True, errors="surrogateescape")
        )
        self.headers: dict[str, str] = {k.decode("latin-1"): v.decode("latin-1") for k, v in scope["headers"]}
        self.params: dict[str, PathId] = {}
        self.person: Person | None = None
        self.break_glass_grant: str | None = None
        self.body_bytes: bytes = b""
        self.started = False

    @property
    def background(self) -> bool:
        return self.headers.get("x-wardline-background") == "1"

    def json_body(self) -> Any:
        """The parsed body; None when it cannot be read as a JSON object."""
        try:
            parsed = json.loads(self.body_bytes.decode("utf-8"))
        except (UnicodeDecodeError, ValueError, RecursionError):
            return None
        return parsed if isinstance(parsed, dict) else None

    def require_body(self) -> dict:
        """The validation stage's body check."""
        parsed = self.json_body()
        if parsed is None:
            raise ValidationFailed({"body": fields.BODY})
        return parsed

    def via(self, detail: dict[str, Any]) -> dict[str, Any]:
        if self.break_glass_grant:
            return {**detail, "via": "break_glass", "grant_id": self.break_glass_grant}
        return detail

    def not_found(self, identifier: str) -> ApiError:
        return ApiError("not_found", denial_target=id_target(identifier))

    def _last_id_target(self) -> str:
        if self.params:
            return id_target(list(self.params.values())[-1])
        return self.raw_path

    def forbidden(self) -> ApiError:
        return ApiError("forbidden", denial_target=self._last_id_target())

    def separation(self) -> ApiError:
        return ApiError("separation_of_duties", denial_target=self._last_id_target())

    def step_up_required(self) -> ApiError:
        return ApiError("step_up_required", denial_target=self._last_id_target())

    async def read_body(self, limit: int, code: str) -> bytes:
        declared = self.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > limit:
            raise ApiError(code)
        chunks, size = [], 0
        while True:
            message = await self.next_message()
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > limit:
                raise ApiError(code)
            chunks.append(chunk)
            if not message.get("more_body"):
                return b"".join(chunks)

    async def client_left(self) -> None:
        """Waits until the client drops. Only for after the body has been read."""
        while (await self.receive())["type"] != "http.disconnect":
            pass

    async def next_message(self) -> dict:
        try:
            message = await asyncio.wait_for(self.receive(), STALL_SECONDS)
        except TimeoutError as error:
            raise ValidationFailed({"body": fields.BODY}) from error
        if message["type"] == "http.disconnect":
            raise ClientGone
        return message

    async def respond(self, status: int, body: bytes, headers: list[tuple[bytes, bytes]]) -> None:
        self.started = True
        await self.send({"type": "http.response.start", "status": status, "headers": headers})
        await self.send({"type": "http.response.body", "body": body})


Handler = Callable[[Request], Awaitable[Reply | None]]


@dataclass(frozen=True, slots=True)
class Route:
    method: str
    parts: tuple[str, ...]
    handler: Handler
    auth: bool
    body: str


ROUTES: list[Route] = []


def route(method: str, template: str, *, auth: bool = True, body: str | None = None) -> Callable[[Handler], Handler]:
    """Register a handler. `body` is `json`, `multipart` or `none`; state-changing routes default to `json`."""

    def register(handler: Handler) -> Handler:
        kind = body or ("json" if method in ("POST", "PUT", "PATCH") else "none")
        ROUTES.append(Route(method, tuple(template.split("/")), handler, auth, kind))
        return handler

    return register


def match_route(path: str) -> list[tuple[Route, dict[str, PathId]]]:
    segments = path.split("/")
    found = []
    for candidate in ROUTES:
        if len(candidate.parts) != len(segments):
            continue
        params: dict[str, PathId] = {}
        for literal, segment in zip(candidate.parts, segments):
            if literal.startswith("{"):
                if not segment:
                    break
                params[literal[1:-1]] = PathId(unquote_to_bytes(segment))
            elif literal != segment:
                break
        else:
            found.append((candidate, params))
    return found


def base_headers(extra: dict[str, str] | None = None) -> list[tuple[bytes, bytes]]:
    merged = {"x-content-type-options": "nosniff", **(extra or {})}
    return [(k.lower().encode("latin-1"), v.encode("latin-1")) for k, v in merged.items()]


def json_headers(extra: dict[str, str] | None = None) -> list[tuple[bytes, bytes]]:
    return base_headers({"content-type": "application/json", "cache-control": "no-store", **(extra or {})})


def privacy_headers(path: str) -> dict[str, str]:
    if path.startswith(("/api/links/", "/api/download/", "/l/")):
        return {"referrer-policy": "no-referrer", "cache-control": "no-store"}
    return {}


def encode_json(body: Any) -> bytes:
    return json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8", "surrogatepass")


def origin_allowed(request: Request) -> bool:
    origin = request.headers.get("origin")
    if origin is None:
        return True
    parts = urlsplit(origin)
    allowed = {request.headers.get("host", "")}
    if CONFIG.public_url:
        allowed.add(urlsplit(CONFIG.public_url).netloc)
    return parts.scheme in ("http", "https") and parts.netloc in allowed


_MEDIA = re.compile(r"\s*([^;\s]+)")


def media_type(request: Request) -> str:
    match = _MEDIA.match(request.headers.get("content-type", ""))
    return match.group(1).lower() if match else ""


async def check_shape(request: Request, matched: Route) -> None:
    if matched.body == "json":
        if media_type(request) != "application/json":
            raise ApiError("unsupported_media_type")
        request.body_bytes = await request.read_body(MAX_JSON, "body_too_large")
    elif matched.body == "multipart":
        if media_type(request) != "multipart/form-data":
            raise ApiError("unsupported_media_type")
        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > MAX_MULTIPART:
            raise ApiError("file_too_large", max_bytes=MAX_FILE)

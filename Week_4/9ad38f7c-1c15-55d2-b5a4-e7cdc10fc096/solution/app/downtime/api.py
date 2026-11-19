"""The published /api surface and its one error precedence.

address -> body size -> content type -> strict JSON -> database -> session -> the handler, which applies
standing, role, required input, unknown things, state conflicts, locks and field rules in that order.
"""

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from email.message import Message
from typing import Any
from urllib.parse import parse_qs

from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from . import accounts, certificate, event, flags, scoring, teams
from .accounts import User
from .db import DB, Unavailable
from .errors import NO_STORE, ApiError
from .inputs import json_object
from .live import LIVE

log = logging.getLogger("downtime.api")

BODY_LIMIT = 16384


@dataclass(frozen=True, slots=True)
class Call:
    request: Request
    params: dict[str, str]
    body: dict[str, Any]
    user: User | None
    token: str | None


Handler = Callable[[Call], Awaitable[Response]]


@dataclass(frozen=True, slots=True)
class Route:
    method: str
    path: str
    handler: Handler
    takes_body: bool = False
    access: str = "player"  # "player" needs a session, "public" reads one if sent, "health" uses neither

    def match(self, segments: list[str]) -> dict[str, str] | None:
        pattern = self.path.strip("/").split("/")
        if len(pattern) != len(segments):
            return None
        params = {}
        for expected, actual in zip(pattern, segments, strict=True):
            if expected.startswith("{"):
                if not actual:
                    return None
                params[expected[1:-1]] = actual
            elif expected != actual:
                return None
        return params


async def _health() -> Response:
    status = await DB.health()
    if status == "ok":
        return JSONResponse({"status": "ok"}, headers=NO_STORE)
    return ApiError(503, status).response()


def _query(call: Call) -> dict[str, list[str]]:
    return parse_qs(call.request.scope["query_string"].decode("latin-1"), keep_blank_values=True,
                    encoding="utf-8", errors="replace")


ROUTES = (
    Route("GET", "/api/health", lambda c: _health(), access="health"),
    Route("POST", "/api/auth/signup", lambda c: accounts.sign_up(c.body), takes_body=True, access="public"),
    Route("POST", "/api/auth/login", lambda c: accounts.sign_in(c.body), takes_body=True, access="public"),
    Route("POST", "/api/auth/logout", lambda c: accounts.sign_out(c.token)),
    Route("GET", "/api/me", lambda c: teams.profile(c.user)),
    Route("GET", "/api/event", lambda c: event.event(), access="public"),
    Route("GET", "/api/event/calendar.ics", lambda c: event.calendar(), access="public"),
    Route("GET", "/api/scenarios", lambda c: event.scenarios(), access="public"),
    Route("GET", "/api/scenarios/{slug}", lambda c: event.scenario(c.user, c.params["slug"]), access="public"),
    Route("POST", "/api/scenarios/{slug}/flag", lambda c: flags.submit(c.user, c.params["slug"], c.body),
          takes_body=True),
    Route("POST", "/api/webinar/flag", lambda c: flags.claim_webinar(c.user, c.body), takes_body=True),
    Route("POST", "/api/teams", lambda c: teams.create(c.user, c.body), takes_body=True),
    Route("POST", "/api/teams/join", lambda c: teams.join(c.user, c.body), takes_body=True),
    Route("POST", "/api/teams/leave", lambda c: teams.leave(c.user)),
    Route("GET", "/api/teams/mine", lambda c: teams.room(c.user)),
    Route("POST", "/api/teams/mine/members/{user_id}/remove",
          lambda c: teams.remove_member(c.user, c.params["user_id"])),
    Route("POST", "/api/teams/mine/invite-code", lambda c: teams.new_invite_code(c.user)),
    Route("GET", "/api/leaderboard", lambda c: scoring.leaderboard(_query(c)), access="public"),
    Route("GET", "/api/stream", lambda c: LIVE.stream(), access="public"),
    Route("GET", "/api/me/certificate", lambda c: certificate.body(c.user)),
    Route("GET", "/api/me/certificate/image", lambda c: certificate.image(c.user)),
)


def _resolve(method: str, path: str) -> tuple[Route, dict[str, str]]:
    segments = path.strip("/").split("/")
    found = [(route, params) for route in ROUTES if (params := route.match(segments)) is not None]
    if not found:
        raise ApiError(404, "not_found")
    wanted = "GET" if method == "HEAD" else method
    for route, params in found:
        if route.method == wanted:
            return route, params
    allowed = sorted({route.method for route, _ in found})
    if "GET" in allowed:
        allowed.append("HEAD")
    raise ApiError(405, "method_not_allowed", headers={"Allow": ", ".join(allowed)})


async def _read_body(request: Request) -> bytes:
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > BODY_LIMIT:
        raise ApiError(413, "payload_too_large")
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > BODY_LIMIT:
            raise ApiError(413, "payload_too_large")
        chunks.append(chunk)
    return b"".join(chunks)


def _check_content_type(request: Request) -> None:
    header = Message()
    header["content-type"] = request.headers.get("content-type", "")
    charset = header.get_param("charset")
    if header.get_content_type() != "application/json" or (
            charset is not None and str(charset).lower() not in ("utf-8", "utf8")):
        raise ApiError(415, "unsupported_media_type")


def _bearer(request: Request) -> str | None:
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    return token.strip() or None if scheme.lower() == "bearer" else None


async def dispatch(request: Request) -> Response:
    try:
        route, params = _resolve(request.method, request.scope["path"])
        raw = await _read_body(request)
        body: dict[str, Any] = {}
        if route.takes_body:
            _check_content_type(request)
            body = json_object(raw)
        token, user = _bearer(request), None
        if route.access != "health":
            if not DB.ready:
                raise Unavailable
            user = await accounts.session_user(token) if token else None
            if route.access == "player" and user is None:
                raise ApiError(401, "unauthenticated")
        return await route.handler(Call(request, params, body, user, token))
    except ApiError as error:
        return error.response()
    except Unavailable:
        return ApiError(503, "unavailable").response()
    except Exception:
        log.exception("unhandled error on %s %s", request.method, request.scope["path"])
        return ApiError(503, "unavailable").response()

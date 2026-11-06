"""The server boundary: transport checks, sessions, the route table and the static browser app.

Order for every API call (brief: Error precedence): transport checks (origin, size, media type),
then the session, then the handler, which checks visibility, role, preconditions, state and
validation in that order.
"""

import hashlib
import json
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from email.parser import BytesHeaderParser
from email.policy import HTTP
from pathlib import Path
from urllib.parse import urlsplit

import asyncpg
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import (
    FileResponse,
    HTMLResponse,
    JSONResponse,
    PlainTextResponse,
    Response,
)
from starlette.routing import Route

from . import access, db, shifts
from .errors import ApiError, Fields, invalid

JSON_LIMIT = 65_536
MULTIPART_LIMIT = 5_100_000
DRAIN_LIMIT = 32 * 1024 * 1024
UNSAFE = {"POST", "PATCH", "PUT", "DELETE"}
COOKIE = "tallow_session"
STATIC = Path(__file__).resolve().parent.parent / "static"
SPA_ROUTES = re.compile(
    r"^/(|sign-in|shifts|leave|leave/new|leave/[\w-]+|sickness|sickness/[\w-]+|rota|cover|accrual|queue|today"
    r"|floors|attendance|pay-periods|exports|audit|profile)$")
PERSON_COLUMNS = "p.id, p.email, p.display_name, p.role, p.home_id, p.unit_id, p.skill"


@dataclass(slots=True)
class Call:
    request: Request
    me: asyncpg.Record | None
    body: dict = field(default_factory=dict)
    raw: bytes = b""
    published: tuple[str, ...] = ()

    def fields(self) -> Fields:
        """Field messages for this body, starting with every key the endpoint does not publish."""
        return Fields(self.body, self.published)

    def query(self, name: str, default: str | None = None) -> str | None:
        return self.request.query_params.get(name, default)

    def path(self, name: str) -> str:
        return self.request.path_params[name]

    def header(self, name: str) -> str | None:
        return self.request.headers.get(name)


Handler = Callable[[Call], Awaitable[Response]]
ROUTES: list[Route] = []


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def reply(payload, status: int = 200, headers: dict | None = None) -> JSONResponse:
    return JSONResponse(payload, status_code=status, headers={"Cache-Control": "no-store", **(headers or {})})


def _check_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if request.method in UNSAFE and origin is not None and urlsplit(origin).netloc != request.headers.get("host"):
        raise ApiError("cross_origin")


async def _read_body(request: Request, limit: int) -> bytes:
    declared = request.headers.get("content-length")
    if declared is not None and (not declared.isdigit() or int(declared) > limit):
        await _drain(request)
        raise ApiError("too_large")
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            await _drain(request)
            raise ApiError("too_large")
        chunks.append(chunk)
    return b"".join(chunks)


async def _drain(request: Request) -> None:
    """Read and drop an oversized body so the client receives the refusal instead of a reset connection."""
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > DRAIN_LIMIT:
            return


def _media_type(request: Request) -> str:
    return request.headers.get("content-type", "").split(";")[0].strip().lower()


async def _signed_in(request: Request) -> asyncpg.Record | None:
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    return await db.pool.fetchrow(f"SELECT {PERSON_COLUMNS} FROM sessions s JOIN people p ON p.id = s.person_id"
                                  " WHERE s.token_hash = $1 AND s.expires_at > now()", token_hash(token))


async def _session(request: Request) -> asyncpg.Record:
    me = await _signed_in(request)
    if me is None:
        raise ApiError("not_signed_in")
    return me


def api(method: str, path: str, *, public: bool = False, roles: tuple[str, ...] = (), multipart: bool = False,
        keys: tuple[str, ...] = ()):
    """Register a handler. `roles` is checked here only for endpoints that address no record; `keys` are the
    body keys the endpoint publishes (brief: Published body keys), judged with the rest of validation."""

    def register(handler: Handler) -> Handler:
        async def endpoint(request: Request) -> Response:
            _check_origin(request)
            raw = b""
            if request.method in UNSAFE:
                raw = await _read_body(request, MULTIPART_LIMIT if multipart else JSON_LIMIT)
                expected = "multipart/form-data" if multipart else "application/json"
                if request.method != "DELETE" and _media_type(request) != expected:
                    raise ApiError("unsupported_media_type")
            me = None if public else await _session(request)
            if roles and me["role"] not in roles:
                raise ApiError("forbidden")
            body = {}
            if raw and not multipart:
                try:
                    body = json.loads(raw)
                except ValueError:
                    raise invalid(body="Send a JSON object.") from None
                if not isinstance(body, dict):
                    raise invalid(body="Send a JSON object.")
            return await handler(Call(request, me, body, raw, keys))

        ROUTES.append(Route(path, endpoint, methods=[method]))
        return handler

    return register


def multipart_file(call: Call, name: str) -> tuple[str, bytes] | None:
    """The (file name, bytes) of one multipart field, split byte-exactly on the declared boundary."""
    content_type = call.header("content-type") or ""
    match = re.search(r'boundary="?([^";]+)"?', content_type)
    if not match:
        return None
    delimiter = b"\r\n--" + match.group(1).encode()
    for part in (b"\r\n" + call.raw).split(delimiter)[1:]:
        if part.startswith(b"--"):
            break
        head, _, content = part.removeprefix(b"\r\n").partition(b"\r\n\r\n")
        headers = BytesHeaderParser(policy=HTTP).parsebytes(head + b"\r\n\r\n")
        if headers.get_param("name", header="content-disposition") == name:
            return _form_filename(headers.get_filename() or ""), content
    return None


# Browsers escape these three characters in a multipart file name (HTML: multipart/form-data encoding).
FORM_ESCAPES = {"%22": '"', "%0D": "\r", "%0A": "\n"}


def _form_filename(value: str) -> str:
    return re.sub("%22|%0D|%0A", lambda m: FORM_ESCAPES[m.group()], value)


async def api_error(_: Request, exc: ApiError) -> Response:
    return exc.response()


async def http_error(request: Request, exc: HTTPException) -> Response:
    if request.url.path.startswith("/api"):
        return ApiError("method_not_allowed" if exc.status_code == 405 else "not_found").response()
    return PlainTextResponse("Not found.", status_code=404)


SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
}


SHELL = (STATIC / "index.html").read_text()


async def _bootstrap(request: Request) -> str:
    """The London date and the homes and units the signed-in caller may see, embedded in the shell."""
    me = await _signed_in(request)
    homes = []
    if me is not None:
        async with db.pool.acquire() as conn:
            visible = await access.home_ids(conn, me)
            for home in await conn.fetch("SELECT * FROM homes WHERE id = ANY($1::text[]) ORDER BY name", list(visible)):
                units = await conn.fetch("SELECT id, name FROM units WHERE home_id = $1 ORDER BY position", home["id"])
                homes.append({"id": home["id"], "name": home["name"], "units": [dict(u) for u in units]})
    return json.dumps({"today": shifts.today().isoformat(), "homes": homes}).replace("<", "\\u003c")


async def browser_app(request: Request) -> Response:
    """Only the built browser assets and the SPA's own routes; everything else is a 404."""
    path = request.url.path
    if path == "/api" or path.startswith("/api/"):
        raise ApiError("not_found")
    if SPA_ROUTES.match(path):
        return HTMLResponse(SHELL.replace("{{bootstrap}}", await _bootstrap(request)),
                            headers={**SECURITY_HEADERS, "Cache-Control": "no-store"})
    if path.startswith("/assets/") and ".." not in path:
        asset = STATIC / path.lstrip("/")
        if asset.is_file():
            return FileResponse(asset, headers={**SECURITY_HEADERS, "Cache-Control": "no-cache"})
    return PlainTextResponse("Not found.", status_code=404)

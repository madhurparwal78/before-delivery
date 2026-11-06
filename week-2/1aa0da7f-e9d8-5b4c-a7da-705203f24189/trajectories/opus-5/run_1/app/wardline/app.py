"""The ASGI application: one origin, one error shape, one dispatcher."""

from __future__ import annotations

import pathlib
import re
import threading
import traceback
from typing import Any

import anyio
import psycopg2
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import Response

# Importing the endpoint modules registers every published route.
from . import api_access, api_exhibits, api_files, api_ledger, api_platform  # noqa: F401
from . import api_releases  # noqa: F401
from . import auth, db, http, storage, workers
from .errors import ApiError, DENIAL_CODES, ValidationFailed
from .http import ROUTES, Context, Param, error_response, json_response, write_denial

STATIC = pathlib.Path(__file__).with_name("static")
SHELL = STATIC / "index.html"

APP_ROUTES = [
    re.compile(r"^/sign-in$"),
    re.compile(r"^/compartments$"),
    re.compile(r"^/compartments/[^/]+$"),
    re.compile(r"^/exhibits/[^/]+$"),
    re.compile(r"^/releases/[^/]+$"),
    re.compile(r"^/reviews$"),
    re.compile(r"^/intake$"),
    re.compile(r"^/ledger$"),
    re.compile(r"^/ledger/review$"),
    re.compile(r"^/audit/chain$"),
]
CONTENT_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".woff2": "font/woff2",
    ".html": "text/html; charset=utf-8",
}

_stop = threading.Event()


def _match(raw_path: str, method: str):
    matched_route = None
    params: dict[str, str] = {}
    path_exists = False
    for candidate in ROUTES:
        found = candidate.pattern.match(raw_path)
        if not found:
            continue
        path_exists = True
        if method in candidate.methods:
            matched_route = candidate
            params = found.groupdict()
            break
    return matched_route, params, path_exists


async def _api(request: Request, raw_path: str) -> Response:
    route, params, path_exists = _match(raw_path, request.method)
    ctx = Context(
        method=request.method,
        raw_path=raw_path,
        params={},
        query={key: value for key, value in request.query_params.items()},
        headers={key.lower(): value for key, value in request.headers.items()},
    )
    try:
        if route is None:
            if path_exists:
                raise ApiError("method_not_allowed")
            raise ApiError("not_found")
        ctx.params = {name: Param(value) for name, value in params.items()}
        ctx.writes_denials = route.denials
        ctx.background = request.headers.get(http.BACKGROUND_HEADER) == "1"
        ctx.proof = request.headers.get(http.PROOF_HEADER) or None
        http.check_origin(request)
        if route.json_body:
            content_type = request.headers.get("content-type")
            if content_type and not content_type.startswith("application/json"):
                raise ApiError("unsupported_media_type")
            raw = await http.read_json_body(request)
            ctx.body = http.parse_json_body(raw)
        if route.auth:
            found = await run_in_threadpool(
                auth.load_session,
                request.cookies.get(auth.SESSION_COOKIE),
                ctx.background,
            )
            if found is None:
                raise ApiError("unauthenticated")
            ctx.user, ctx.session = found
        if route.streaming:
            result = await route.handler(ctx, request)
        else:
            result = await run_in_threadpool(route.handler, ctx)
        return _as_response(result)
    except (ApiError, ValidationFailed) as exc:
        if exc.code in DENIAL_CODES:
            await run_in_threadpool(write_denial, ctx, exc.code, exc.target)
        return error_response(exc)
    except db.DatabaseUnavailable:
        return json_response(503, {"error": "service_unavailable"})
    except psycopg2.Error:
        return json_response(503, {"error": "service_unavailable"})
    except storage.StorageDown:
        return json_response(503, {"error": "storage_unavailable"})
    except anyio.get_cancelled_exc_class():
        raise
    except Exception:
        traceback.print_exc()
        return json_response(503, {"error": "service_unavailable"})


def _as_response(result: Any) -> Response:
    if isinstance(result, Response):
        return result
    if isinstance(result, tuple) and len(result) == 3:
        status, body, headers = result
        return json_response(status, body, headers)
    status, body = result
    return json_response(status, body)


def _static(path: str) -> Response:
    name = path[len("/static/") :]
    if not name or ".." in name or name.startswith("/"):
        return _shell(404)
    target = (STATIC / name).resolve()
    if not str(target).startswith(str(STATIC.resolve())) or not target.is_file():
        return _shell(404)
    media_type = CONTENT_TYPES.get(target.suffix)
    if media_type is None:
        return _shell(404)
    return Response(
        target.read_bytes(),
        media_type=media_type,
        headers={
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-cache",
        },
    )


def _shell(status: int, headers: dict[str, str] | None = None) -> Response:
    out = {"X-Content-Type-Options": "nosniff"}
    out.update(headers or {})
    return Response(
        SHELL.read_bytes(),
        status_code=status,
        media_type="text/html; charset=utf-8",
        headers=out,
    )


def _link_page(token: str) -> Response:
    from .api_releases import LINK_HEADERS, live_link

    try:
        with db.tx() as cur:
            alive = live_link(cur, token) is not None
    except (db.DatabaseUnavailable, psycopg2.Error):
        alive = False
    return _shell(200 if alive else 404, dict(LINK_HEADERS))


async def _page(request: Request, path: str) -> Response:
    if path.startswith("/static/"):
        return _static(path)
    if path == "/":
        return _shell(200)
    if any(pattern.match(path) for pattern in APP_ROUTES):
        return _shell(200)
    if path.startswith("/l/") and path.count("/") == 2:
        return await run_in_threadpool(_link_page, Param(path[3:]).text)
    return _shell(404)


async def application(scope, receive, send) -> None:
    if scope["type"] == "lifespan":
        await _lifespan(scope, receive, send)
        return
    if scope["type"] != "http":
        return
    request = Request(scope, receive)
    raw_path = scope.get("raw_path", b"").decode("latin-1").split("?")[0]
    if not raw_path:
        raw_path = request.url.path
    if raw_path.startswith("/api/"):
        response = await _api(request, raw_path)
    else:
        response = await _page(request, raw_path)
    await response(scope, receive, send)


async def _lifespan(scope, receive, send) -> None:
    while True:
        message = await receive()
        if message["type"] == "lifespan.startup":
            anyio.to_thread.current_default_thread_limiter().total_tokens = 120
            threading.Thread(
                target=db.wait_for_database, args=(_stop,), daemon=True
            ).start()
            threading.Thread(target=workers.status_work, daemon=True).start()
            workers.start(_stop)
            await send({"type": "lifespan.startup.complete"})
        elif message["type"] == "lifespan.shutdown":
            _stop.set()
            await send({"type": "lifespan.shutdown.complete"})
            return

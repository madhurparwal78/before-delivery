"""The ASGI application: boot, background work, API dispatch and the page shell."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import mimetypes
import re
from pathlib import Path

import asyncpg

from wardline import fields, ledger, routes  # noqa: F401  (routes registers the API routes)
from wardline.auth import authenticate
from wardline.db import DB
from wardline.errors import (
    ApiError,
    ClientGone,
    StorageUnavailable,
    ValidationFailed,
)
from wardline.routes.links import link_is_live
from wardline.seed import seed_objects, seed_records
from wardline.web import (
    STATE_CHANGING,
    Receive,
    Reply,
    Request,
    Scope,
    Send,
    base_headers,
    check_shape,
    encode_json,
    json_headers,
    match_route,
    origin_allowed,
    privacy_headers,
)
from wardline.workers import (
    STATUS,
    check_services_once,
    mail_loop,
    status_loop,
    sweep_loop,
)

log = logging.getLogger("wardline")

STATIC_ROOT = Path(__file__).resolve().parent.parent / "static"
RETRY_SECONDS = 2
SHELL_ROUTES = re.compile(
    r"/sign-in|/compartments(/[^/]+)?|/exhibits/[^/]+|/releases/[^/]+|/reviews|/intake|/ledger|/ledger/review|/audit/chain"
)
PAGE_POLICY = {
    "content-security-policy": "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; connect-src 'self'",
    "referrer-policy": "same-origin",
}


class Boot:
    ready = False


def _load_static() -> dict[str, tuple[bytes, str, str]]:
    found = {}
    for path in STATIC_ROOT.rglob("*"):
        if path.is_file():
            data = path.read_bytes()
            kind = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            if path.suffix == ".woff2":
                kind = "font/woff2"
            if path.suffix == ".js":
                kind = "text/javascript"
            charset = "; charset=utf-8" if kind.startswith(("text/", "application/json")) else ""
            found["/static/" + path.relative_to(STATIC_ROOT).as_posix()] = (
                data, kind + charset, f'"{hashlib.sha256(data).hexdigest()[:32]}"',
            )
    return found


STATIC = _load_static()
SHELL = (STATIC_ROOT / "index.html").read_bytes()


async def _boot() -> None:
    while True:
        try:
            await DB.connect()
            await DB.apply_schema()
            await seed_records()
            break
        except (asyncpg.PostgresError, asyncpg.InterfaceError, OSError, TimeoutError) as error:
            log.warning("waiting for the database: %s", error)
            await asyncio.sleep(RETRY_SECONDS)
    await check_services_once()
    tasks = [asyncio.ensure_future(mail_loop()), asyncio.ensure_future(sweep_loop())]
    complete = await seed_objects()
    Boot.ready = True
    while not complete:
        await asyncio.sleep(RETRY_SECONDS)
        complete = await seed_objects()
    await asyncio.gather(*tasks)


def _error_reply(code: str) -> Reply:
    error = ApiError(code)
    return Reply(error.status, error.body)


async def _send_error(request: Request, code: str, extra: dict[str, str] | None = None) -> None:
    reply = _error_reply(code)
    await request.respond(reply.status, encode_json(reply.body), json_headers(extra))


async def _send_page(request: Request, status: int, extra: dict[str, str] | None = None) -> None:
    headers = base_headers({
        **PAGE_POLICY,
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache",
        **(extra or {}),
    })
    await request.respond(status, SHELL, headers)


async def _serve_public(request: Request) -> None:
    path = request.raw_path
    if request.method != "GET":
        await _send_error(request, "method_not_allowed")
        return
    if path in STATIC:
        data, kind, etag = STATIC[path]
        if request.headers.get("if-none-match") == etag:
            await request.respond(304, b"", base_headers({"etag": etag}))
            return
        await request.respond(200, data, base_headers({"content-type": kind, "etag": etag, "cache-control": "no-cache"}))
        return
    if path.startswith("/l/") and path.count("/") == 2:
        live = Boot.ready and await link_is_live(_link_token(path))
        await _send_page(request, 200 if live else 404, privacy_headers(path))
        return
    if path == "/":
        await request.respond(302, b"", base_headers({"location": "/sign-in"}))
        return
    await _send_page(request, 200 if SHELL_ROUTES.fullmatch(path) else 404)


def _link_token(path: str) -> str:
    return path[len("/l/"):]


async def _write_denial(request: Request, error: ApiError) -> None:
    person = request.person
    async with DB.tx() as conn:
        await ledger.append(
            conn,
            actor_id=person.id,
            session_id=person.session_id,
            action="access.denied",
            target=error.denial_target,
            detail=request.via({"method": request.method, "path": request.raw_path[:1000], "code": error.code}),
        )


async def _run_api(request: Request) -> None:
    extra = privacy_headers(request.raw_path)
    reply: Reply | None
    try:
        reply = await _dispatch(request)
    except ApiError as error:
        if error.denial_target is not None and request.person is not None:
            try:
                await _write_denial(request, error)
            except (asyncpg.PostgresError, asyncpg.InterfaceError, OSError, TimeoutError) as failure:
                log.warning("database unavailable: %s", failure)
                await _send_error(request, "service_unavailable", extra)
                return
        headers = dict(extra)
        if error.retry_after is not None:
            headers["retry-after"] = str(error.retry_after)
        reply = Reply(error.status, error.body, headers)
    except ValidationFailed as error:
        reply = Reply(422, {"errors": error.errors})
    except StorageUnavailable as error:
        log.warning("storage unavailable: %s", error)
        reply = _error_reply("storage_unavailable")
    except ClientGone:
        return
    except (asyncpg.PostgresError, asyncpg.InterfaceError, OSError, TimeoutError) as error:
        log.warning("database unavailable: %s", error)
        reply = _error_reply("service_unavailable")
    except Exception:
        log.exception("unexpected failure")
        reply = _error_reply("service_unavailable")
    if reply is None or request.started:
        return
    headers = {**extra, **(reply.headers or {})}
    if reply.body is None:
        await request.respond(reply.status, b"", base_headers({"cache-control": "no-store", **headers}))
        return
    await request.respond(reply.status, encode_json(reply.body), json_headers(headers))


async def _dispatch(request: Request) -> Reply | None:
    candidates = match_route(request.raw_path)
    if not candidates:
        if request.raw_path.startswith("/api/links/"):
            raise ApiError("method_not_allowed")
        raise ApiError("not_found")
    chosen = next((c for c in candidates if c[0].method == request.method), None)
    if chosen is None:
        raise ApiError("method_not_allowed")
    matched, request.params = chosen
    if request.method in STATE_CHANGING and not origin_allowed(request):
        raise ApiError("forbidden_origin")
    await check_shape(request, matched)
    if matched.auth:
        request.person = await authenticate(request)
    return await matched.handler(request)


async def _lifespan(receive: Receive, send: Send) -> None:
    runner: asyncio.Future | None = None
    while True:
        message = await receive()
        if message["type"] == "lifespan.startup":
            runner = asyncio.gather(_boot(), status_loop())
            await send({"type": "lifespan.startup.complete"})
        else:
            if runner is not None:
                runner.cancel()
            await send({"type": "lifespan.shutdown.complete"})
            return


async def application(scope: Scope, receive: Receive, send: Send) -> None:
    if scope["type"] == "lifespan":
        await _lifespan(receive, send)
        return
    request = Request(scope, receive, send)
    path = request.raw_path
    if path == "/api/health":
        status, body = (200, {"status": "ok"}) if Boot.ready else (503, {"status": "starting"})
        await request.respond(status, encode_json(body), json_headers())
    elif path == "/api/status":
        body = {"storage": "up" if STATUS.storage_up else "down", "mail": "up" if STATUS.mail_up else "down"}
        await request.respond(200, encode_json(body), json_headers())
    elif not path.startswith("/api/"):
        await _serve_public(request)
    elif not Boot.ready:
        await _send_error(request, "service_unavailable")
    else:
        await _run_api(request)

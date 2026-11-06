"""The ASGI application: boot (wait for PostgreSQL, schema, seed), security headers, static files, pages and /api."""
import logging
import mimetypes
from pathlib import Path

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import Response

from . import api, db, pages, routes_data, seed  # pages imports routes_account, registering its routes

log = logging.getLogger("tessel")
STATIC = {f"/static/{f.name}": (f.read_bytes(), mimetypes.guess_type(f.name)[0] or "application/octet-stream")
          for f in (Path(__file__).parent / "static").iterdir() if f.is_file()}
SECURITY_HEADERS = {"X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin",
                    "X-Frame-Options": "DENY"}


def _boot() -> None:
    db.wait_until_reachable()
    db.migrate()
    seed.seed()
    routes_data.start_export_notices()
    log.info("Tessel is ready")


def _static(request: Request) -> Response:
    found = STATIC.get(request.url.path)
    if not found or request.method not in ("GET", "HEAD"):
        return pages.not_found()
    body, kind = found
    return Response(body, media_type=kind + ("; charset=utf-8" if kind.startswith("text/") or kind.endswith("javascript")
                                             else ""), headers={"Cache-Control": "no-cache"})


async def app(scope, receive, send):
    if scope["type"] == "lifespan":
        while True:
            message = await receive()
            if message["type"] == "lifespan.startup":
                await run_in_threadpool(_boot)
                await send({"type": "lifespan.startup.complete"})
            elif message["type"] == "lifespan.shutdown":
                await send({"type": "lifespan.shutdown.complete"})
                return
    if scope["type"] != "http":
        return
    request = Request(scope, receive)
    path = request.url.path
    if path == "/api" or path.startswith("/api/"):
        response = await api.handle(request)
    else:
        try:
            response = _static(request) if path.startswith("/static/") else await pages.handle(request)
        except Exception:  # noqa: BLE001 -- a page never answers 500 or shows a trace
            log.exception("page failure on %s %s", request.method, path)
            response = pages.unavailable()
        for name, value in SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
    await response(scope, receive, send)

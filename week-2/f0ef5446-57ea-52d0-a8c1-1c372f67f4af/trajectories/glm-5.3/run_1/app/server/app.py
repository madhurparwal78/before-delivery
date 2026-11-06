"""One origin for pages and API. The server never sends cross-origin
access headers, and no page requests another origin."""
from __future__ import annotations

import logging
import threading
import time
import traceback

from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, Response
from starlette.routing import Route

from . import api, db, keycloak, media, pages, schema, state
from . import deliverer

log = logging.getLogger("relayo.server")

_JSON = "application/json; charset=utf-8"


def _api_response(response: api.ApiResponse, path: str,
                  method: str) -> Response:
    headers = dict(response.headers)
    if path.startswith(api.PRIVATE_PREFIXES):
        headers["Cache-Control"] = "no-store"
        headers.pop("ETag", None)
        headers.pop("Last-Modified", None)
    body = b"" if method == "HEAD" else response.body
    return Response(
        body, status_code=response.status, headers=headers,
        media_type=_JSON,
    )


async def api_endpoint(request: Request) -> Response:
    path = request.url.path
    method = request.method.upper()
    headers = {key.lower(): value for key, value in request.headers.items()}
    query: dict[str, list[str]] = {}
    for key in request.query_params.keys():
        query[key] = request.query_params.getlist(key)
    body = await request.body()

    def run() -> api.ApiResponse:
        try:
            return api.handle(path, method, headers, query, body)
        except api.ApiError as exc:
            response = api.error_response(exc.status, exc.code, **exc.extra)
            response.private = path.startswith(api.PRIVATE_PREFIXES)
            return response
        except db.DatabaseUnavailable:
            return api.error_response(503, "service_unavailable")
        except Exception:
            log.error("api error on %s %s\n%s", method, path,
                      traceback.format_exc())
            return api.error_response(500, "internal_error")

    response = await run_in_threadpool(run)
    return _api_response(response, path, method)


async def media_endpoint(request: Request) -> Response:
    path = request.url.path
    method = request.method.upper()

    def run():
        try:
            content, headers = media.serve(path)
            return content, headers, 200
        except media.NotFound:
            page, status = pages.not_found()
            return page, {"Content-Type": "text/html; charset=utf-8"}, status
        except db.DatabaseUnavailable:
            return b"", {}, 503

    content, headers, status = await run_in_threadpool(run)
    body = b"" if method == "HEAD" else content
    return Response(body, status_code=status, headers=headers)


async def page_endpoint(request: Request) -> Response:
    path = request.url.path
    method = request.method.upper()
    if method not in ("GET", "HEAD"):
        return Response("", status_code=405, headers={"Allow": "GET, HEAD"})
    if not state.ready():
        page = _env_outage()
        return HTMLResponse(page, status_code=503)

    def run():
        try:
            return pages.render(path)
        except db.DatabaseUnavailable:
            return None, 503
        except Exception:
            log.error("page error on %s\n%s", path, traceback.format_exc())
            return pages.not_found()

    content, status = await run_in_threadpool(run)
    if content is None:
        if status == 503:
            return HTMLResponse(_env_outage(), status_code=503)
        content, status = pages.not_found()
    if method == "HEAD":
        return Response(b"", status_code=status,
                        media_type="text/html; charset=utf-8")
    return HTMLResponse(content, status_code=status)


def _env_outage() -> str:
    return (
        "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<title>Relayo</title></head><body>"
        "<p>Partner applications are unavailable right now. Try again in a"
        " minute.</p></body></html>"
    )


async def static_endpoint(request: Request) -> Response:
    """Site assets: css, js and images, from this origin only."""
    from . import assets

    content, content_type, status = assets.serve(request.url.path)
    return Response(content, status_code=status,
                    media_type=content_type or "text/plain")


def _heartbeat() -> None:
    """Ping the database behind /api/health (DP-01): health answers 503
    while PostgreSQL is unreachable."""
    from . import state

    def beat():
        while True:
            try:
                with db.connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("SELECT 1")
                        cur.fetchone()
                state.set_database(True)
            except Exception:
                state.set_database(False)
            time.sleep(2)

    threading.Thread(target=beat, name="relayo-heartbeat", daemon=True).start()


def _startup() -> None:
    _heartbeat()

    def prepare():
        while True:
            try:
                with db.connection() as conn:
                    with conn.transaction():
                        schema.apply_schema(conn)
                        schema.seed_corpus(conn)
                keycloak.seed()
                state.mark_ready()
                deliverer.start()
                log.info("relayo ready: schema, corpus and accounts seeded")
                return
            except Exception as exc:
                log.warning("startup retrying: %s", exc)
                time.sleep(3)

    threading.Thread(target=prepare, name="relayo-startup", daemon=True).start()


def build() -> Starlette:
    _startup()
    routes = [
        Route("/api/{rest:path}", api_endpoint, methods=[
            "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS",
        ]),
        Route("/media/{rest:path}", media_endpoint, methods=["GET", "HEAD"]),
        Route("/css/{rest:path}", static_endpoint, methods=["GET"]),
        Route("/js/{rest:path}", static_endpoint, methods=["GET"]),
        Route("/img/{rest:path}", static_endpoint, methods=["GET"]),
        Route("/{rest:path}", page_endpoint, methods=[
            "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE",
        ]),
    ]
    return Starlette(routes=routes)

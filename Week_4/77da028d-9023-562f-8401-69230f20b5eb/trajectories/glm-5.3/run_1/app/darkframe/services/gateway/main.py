"""Gateway routes for pages, the API tree, middleware wiring and entrypoint."""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from http.cookies import SimpleCookie
from pathlib import Path

import httpx
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, RedirectResponse, Response
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from darkframe.common.http import ApiError, echo_request_id
from darkframe.config import load_config
from darkframe.services.gateway import app as gateway_app
from darkframe.services.gateway.app import (
    VERSION, create_workspace, health, imager_for_key, json_body, lock_workspace,
    me, proxy, unlock, JSON_LIMIT, UPLOAD_LIMIT,
)

config = load_config()
STATIC_ROOT = Path(os.environ.get("DARKFRAME_STATIC", "/app/darkframe/static"))

NO_KEY = {("POST", "/api/workspaces"), ("POST", "/api/unlock"), ("GET", "/api/shared"), ("GET", "/api/health")}
JSON_ROUTES = {
    "POST /api/workspaces", "POST /api/unlock", "POST /api/lock-workspace", "GET /api/me",
    "PATCH /api/site", "PUT /api/site/horizon", "POST /api/plans", "DELETE /api/plans",
    "PUT /api/plans", "POST /api/projects", "PATCH /api/projects", "PUT /api/projects",
    "POST /api/projects", "POST /api/sessions", "POST /api/sessions", "PATCH /api/sessions",
    "POST /api/batches", "POST /api/calibration-sets", "PATCH /api/calibration-sets",
    "POST /api/calibration-sets", "PUT /api/reminders", "POST /api/batches",
    "POST /api/calibration", "DELETE /api/batches",
}
UPLOAD_ROUTES = {"PUT /api/batches", "PUT /api/calibration-sets"}


class Boundary(BaseHTTPMiddleware):
    """Request ids, auth, body limits, content types and the same-origin rule."""

    async def dispatch(self, request: Request, call_next):
        request.state.request_id = echo_request_id(request)
        path = request.url.path
        method = request.method
        if path.startswith("/internal"):
            return error(404, "not_found", "There is nothing at that address.", request.state.request_id)
        if path == "/api/health" and method == "GET":
            return await call_next(request)
        # Cross-origin guard for state changes.
        origin = request.headers.get("origin")
        if origin and method not in ("GET", "HEAD", "OPTIONS"):
            host = request.headers.get("host", "")
            try:
                from urllib.parse import urlparse

                if urlparse(origin).netloc != host:
                    return error(403, "cross_origin", "Requests must come from Darkframe itself.", request.state.request_id)
            except Exception:
                return error(403, "cross_origin", "Requests must come from Darkframe itself.", request.state.request_id)
        if path.startswith("/api"):
            # Body limits by route shape.
            is_upload = method == "PUT" and (path.startswith("/api/batches/") and "/frames/" in path) or (
                method == "PUT" and path.startswith("/api/calibration-sets/") and path.endswith("/master"))
            length = int(request.headers.get("content-length") or 0)
            limit = UPLOAD_LIMIT if is_upload else JSON_LIMIT
            if length > limit:
                return error(413, "too_large", "That request body is too large.", request.state.request_id)
            if method in ("POST", "PUT", "PATCH", "DELETE"):
                ctype = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
                if is_upload:
                    allowed = {"image/png", "image/jpeg", "image/fits", "image/fits", "application/octet-stream"}
                    if method == "PUT" and path.startswith("/api/calibration-sets/"):
                        allowed = {"image/fits", "application/octet-stream"}
                    elif method == "PUT":
                        allowed = {"image/png", "image/jpeg", "image/fits"}
                    if ctype not in allowed:
                        return error(415, "unsupported_media_type", "Send the body in a supported format.", request.state.request_id)
                else:
                    if ctype and ctype != "application/json":
                        return error(415, "unsupported_media_type", "Send the body as application/json.", request.state.request_id)
            # Authentication.
            key = bearer(request) or cookie_key(request)
            needs_key = (method, path) not in NO_KEY and not (method == "GET" and path.startswith("/api/shared"))
            if path == "/api/lock-workspace":
                needs_key = True
            ident = imager_for_key(key) if key else None
            if needs_key and not ident:
                return error(401, "unauthenticated", "Unlock your workspace first.", request.state.request_id)
            request.state.ident = ident
            request.state.key = key
        return await call_next(request)


def bearer(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip() or None
    return None


def cookie_key(request: Request) -> str | None:
    raw = request.headers.get("cookie", "")
    if not raw:
        return None
    try:
        jar = SimpleCookie()
        jar.load(raw)
        morsel = jar.get("darkframe_key")
        return morsel.value if morsel else None
    except Exception:
        return None


def error(status: int, code: str, message: str, request_id: str) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}},
                        status_code=status, headers={"X-Request-Id": request_id})


async def api_route(request: Request):
    path = request.url.path
    method = request.method
    if path == "/api/workspaces" and method == "POST":
        return await create_workspace(request)
    if path == "/api/unlock" and method == "POST":
        return await unlock(request)
    if path == "/api/lock-workspace" and method == "POST":
        return await lock_workspace(request)
    if path == "/api/me" and method == "GET":
        return await me(request)
    if path == "/api/health" and method == "GET":
        return await health(request)
    if path.startswith("/api/shared") and method in ("POST", "PUT", "PATCH", "DELETE"):
        return error(405, "read_only", "Shared project links are read-only.", request.state.request_id)
    if path.startswith("/api/shared") and method == "GET":
        return await proxy(request)
    if method == "GET" and path == "/api/shared":
        return error(404, "not_found", "There is no shared project at that address.", request.state.request_id)
    return await proxy(request)


PAGES = {
    "/": "index.html",
    "/plan": "plan.html",
    "/projects": "projects.html",
    "/sessions": "sessions.html",
    "/library": "library.html",
    "/site": "site.html",
    "/unlock": "unlock.html",
}


async def page(request: Request):
    name = PAGES.get(request.url.path.rstrip("/") or "/", "plan.html")
    target = STATIC_ROOT / name
    if not target.is_file():
        target = STATIC_ROOT / "plan.html"
    return FileResponse(target, headers={"X-Request-Id": request.state.request_id})


async def index_page(request: Request):
    """`/` sends a locked browser to /unlock and an unlocked one to /plan."""
    key = request.cookies.get("darkframe_key") or ""
    from darkframe.services.gateway.app import imager_for_key

    ident = imager_for_key(key) if key else None
    if ident:
        return RedirectResponse("/plan", status_code=302, headers={"X-Request-Id": request.state.request_id})
    return RedirectResponse("/unlock", status_code=302, headers={"X-Request-Id": request.state.request_id})


async def shared_page(request: Request):
    target = STATIC_ROOT / "shared.html"
    return FileResponse(target, headers={"X-Request-Id": request.state.request_id})


async def project_page(request: Request):
    target = STATIC_ROOT / "project.html"
    return FileResponse(target, headers={"X-Request-Id": request.state.request_id})


async def not_found(request: Request, exc: Exception):
    rid = getattr(request.state, "request_id", "") or ""
    return error(404, "not_found", "There is nothing at that address.", rid)


def create_app():
    import httpx

    @asynccontextmanager
    async def lifespan(app):
        gateway_app.client = httpx.AsyncClient()
        yield
        await gateway_app.client.aclose()

    routes = [
        Route("/api/{rest:path}", api_route, methods=["GET", "POST", "PUT", "PATCH", "DELETE"]),
        Route("/", index_page),
        Route("/plan", page),
        Route("/projects", page),
        Route("/projects/{project_id}", project_page),
        Route("/sessions", page),
        Route("/library", page),
        Route("/site", page),
        Route("/unlock", page),
        Route("/s/{token}", shared_page),
        Mount("/static", StaticFiles(directory=str(STATIC_ROOT)), name="static"),
        Mount("/vendor", StaticFiles(directory=str(STATIC_ROOT / "vendor")), name="vendor"),
    ]
    app = Starlette(routes=routes, middleware=[Middleware(Boundary)],
                    exception_handlers={404: not_found, ApiError: api_error_handler},
                    lifespan=lifespan)
    return app

async def api_error_handler(request: Request, exc: ApiError):
    rid = getattr(request.state, "request_id", "") or ""
    return error(exc.status, exc.code, exc.message, rid)


def serve() -> None:
    import uvicorn

    uvicorn.run(create_app(), host="0.0.0.0", port=config.public_port, log_level="warning")

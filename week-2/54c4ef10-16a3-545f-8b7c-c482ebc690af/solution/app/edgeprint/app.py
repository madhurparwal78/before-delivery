"""Assemble the Starlette application: routes, the cross-origin guard, the single error handler and start-up."""

import asyncio
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from typing import cast
from urllib.parse import urlsplit

from starlette.applications import Starlette
from starlette.exceptions import HTTPException
from starlette.requests import ClientDisconnect, Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles
from starlette.types import ASGIApp, Receive, Scope, Send

from . import accounts, pages, routes_alignment, routes_frames, routes_readings, routes_rolls, routes_scans
from .analysis import AnalysisCache
from .config import Settings, load_settings
from .db import Database
from .errors import ApiError, handle_api_error, method_not_allowed, not_found
from .storage import Storage

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


class CrossOriginGuard:
    """Refuse a state-changing request whose Origin differs from the app's own origin."""

    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.public_origin = urlsplit(settings.public_url).netloc if settings.public_url else None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] in UNSAFE_METHODS:
            headers = {k.decode().lower(): v.decode() for k, v in scope["headers"]}
            origin = headers.get("origin")
            if origin and urlsplit(origin).netloc not in (headers.get("host"), self.public_origin):
                refusal = await handle_api_error(Request(scope), ApiError(403, "cross_origin"))
                await refusal(scope, receive, send)
                return
        await self.app(scope, receive, send)


async def health(request: Request) -> JSONResponse:
    if request.app.state.db.ready:
        return JSONResponse({"status": "ok"})
    return JSONResponse({"status": "starting"}, status_code=503)


async def storage_status(request: Request) -> JSONResponse:
    reachable = await request.app.state.storage.reachable()
    return JSONResponse({"storage": "ok" if reachable else "unavailable"})


async def api_not_found(_request: Request) -> JSONResponse:
    raise not_found()


async def http_error(request: Request, error: Exception) -> Response:
    """Starlette's own 404 and 405 answers, in the API error shape under /api."""
    status = cast(HTTPException, error).status_code
    if request.url.path.startswith("/api/"):
        return await handle_api_error(request, not_found() if status == 404 else method_not_allowed())
    return Response(status_code=status)


async def client_gone(_request: Request, _error: Exception) -> Response:
    return Response(status_code=499)


def create_app(settings: Settings | None = None) -> Starlette:
    settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: Starlette) -> AsyncIterator[None]:
        connecting = asyncio.create_task(app.state.db.connect())
        yield
        connecting.cancel()
        await app.state.db.close()

    routes = [
        Route("/api/health", health), Route("/api/storage", storage_status),
        Route("/api/auth/signup", accounts.sign_up, methods=["POST"]),
        Route("/api/auth/signin", accounts.sign_in, methods=["POST"]),
        Route("/api/auth/signout", accounts.sign_out, methods=["POST"]),
        Route("/api/me", accounts.me),
        Route("/api/rolls", routes_rolls.list_rolls, methods=["GET"]),
        Route("/api/rolls", routes_rolls.create_roll, methods=["POST"]),
        Route("/api/rolls/{roll_id}", routes_rolls.get_roll, methods=["GET"]),
        Route("/api/rolls/{roll_id}", routes_rolls.update_roll, methods=["PATCH"]),
        Route("/api/rolls/{roll_id}/entries", routes_rolls.list_entries, methods=["GET"]),
        Route("/api/rolls/{roll_id}/entries", routes_rolls.create_entry, methods=["POST"]),
        Route("/api/entries/{entry_id}", routes_rolls.update_entry, methods=["PATCH"]),
        Route("/api/entries/{entry_id}", routes_rolls.delete_entry, methods=["DELETE"]),
        Route("/api/rolls/{roll_id}/contact-sheet", routes_rolls.contact_sheet),
        Route("/api/rolls/{roll_id}/curve", routes_rolls.roll_curve),
        Route("/api/rolls/{roll_id}/scans", routes_scans.list_scans, methods=["GET"]),
        Route("/api/rolls/{roll_id}/scans", routes_scans.upload_scan, methods=["POST"]),
        Route("/api/scans/{scan_id}", routes_scans.get_scan),
        Route("/api/scans/{scan_id}/original", routes_scans.download_original),
        Route("/api/scans/{scan_id}/preview/{slice}", routes_scans.download_preview),
        Route("/api/scans/{scan_id}/calibration", routes_scans.calibrate, methods=["POST"]),
        Route("/api/scans/{scan_id}/frames/detect", routes_scans.detect_frames, methods=["POST"]),
        Route("/api/scans/{scan_id}/reading", routes_readings.read_cell),
        Route("/api/scans/{scan_id}/readings", routes_readings.pin_reading, methods=["POST"]),
        Route("/api/frames/{frame_id}", routes_frames.get_frame, methods=["GET"]),
        Route("/api/frames/{frame_id}", routes_frames.update_frame, methods=["PATCH"]),
        Route("/api/frames/{frame_id}/accept-width", routes_frames.accept_width, methods=["POST"]),
        Route("/api/rolls/{roll_id}/alignment/proposal", routes_alignment.propose_alignment, methods=["POST"]),
        Route("/api/rolls/{roll_id}/alignment", routes_alignment.get_alignment, methods=["GET"]),
        Route("/api/rolls/{roll_id}/alignment", routes_alignment.save_alignment, methods=["PUT"]),
        Route("/api/{path:path}", api_not_found),
        Route("/static/js/domain.js", pages.domain_module),
        Mount("/static", StaticFiles(directory=pages.STATIC), name="static"),
        Route("/{path:path}", pages.shell),
    ]
    app = Starlette(routes=routes, lifespan=lifespan, exception_handlers={
        ApiError: handle_api_error, HTTPException: http_error, ClientDisconnect: client_gone})
    app.state.settings = settings
    app.state.db = Database(settings)
    app.state.storage = Storage(settings)
    app.state.analyses = AnalysisCache(app.state.storage)
    app.add_middleware(CrossOriginGuard, settings=settings)
    return app

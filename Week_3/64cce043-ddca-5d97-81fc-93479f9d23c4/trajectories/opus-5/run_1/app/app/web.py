"""The server: screens, sign-in routes, the JSON API and the static assets."""
from __future__ import annotations

import urllib.parse
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from starlette.applications import Starlette
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import RedirectResponse, Response
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from . import auth
from .api import api_routes
from .config import SESSION_COOKIE, Settings
from .errors import ApiError
from .pages import error_page, landing_page, not_found_page, shell
from .sessions import Caller, resolve_caller
from .state import AppState
from .store import load_view

STATIC_DIRECTORY = Path(__file__).with_name("static")

OWNER_SCREENS: dict[str, tuple[str, str]] = {
    "/vault": ("vault", "Ledger"),
    "/vault/breaches": ("breaches", "Breaches"),
    "/vault/rules": ("rules", "Rules"),
    "/vault/contact": ("contact", "Trusted contact"),
    "/vault/account": ("account", "Account"),
}
RECORD_SCREENS: dict[str, tuple[str, str]] = {
    "/vault/holdings": ("holding", "Holding"),
    "/vault/breaches": ("breach", "Breach"),
}


def build_app(settings: Settings) -> Starlette:
    state = AppState(settings)

    @asynccontextmanager
    async def lifespan(_app: Starlette) -> AsyncIterator[None]:
        await state.startup()
        try:
            yield
        finally:
            await state.shutdown()

    async def caller_of(request: Request) -> Caller | None:
        return await resolve_caller(
            state.db, state.settings, request.cookies.get(SESSION_COOKIE), touch=True
        )

    async def landing(request: Request) -> Response:
        caller = await caller_of(request)
        if caller is not None:
            return RedirectResponse(caller.home_path, status_code=302)
        return landing_page(request.query_params.get("next"))

    async def owner_screen(request: Request) -> Response:
        caller = await caller_of(request)
        if caller is None:
            return sign_in_first(request)
        if caller.is_contact:
            return RedirectResponse("/shared", status_code=302)
        screen, title = OWNER_SCREENS[request.url.path]
        return shell(screen, title)

    async def record_screen(request: Request) -> Response:
        caller = await caller_of(request)
        if caller is None:
            return sign_in_first(request)
        if caller.is_contact:
            return RedirectResponse("/shared", status_code=302)
        screen, title = RECORD_SCREENS[request.url.path.rsplit("/", 1)[0]]
        async with state.db.pool.acquire() as connection:
            view = await load_view(connection, caller.vault_id)
        record_id = request.path_params["id"]
        found = view.holding(record_id) if screen == "holding" else view.breach(record_id)
        if found is None:
            return not_found_page()
        return shell(screen, title)

    async def shared_screen(request: Request) -> Response:
        caller = await caller_of(request)
        if caller is None:
            return sign_in_first(request)
        if not caller.is_contact:
            return RedirectResponse("/vault", status_code=302)
        return shell("shared", "Shared vault")

    async def login(request: Request) -> Response:
        return await auth.login(state, request)

    async def callback(request: Request) -> Response:
        return await auth.callback(state, request)

    async def logout(request: Request) -> Response:
        return await auth.logout(state, request)

    async def unknown_api(_request: Request) -> Response:
        return ApiError("not_found").response()

    async def unknown_page(_request: Request) -> Response:
        return not_found_page()

    async def unroutable(request: Request, _exc: Exception) -> Response:
        """A method or path this brief does not publish is simply not there."""
        if request.url.path.startswith("/api"):
            return ApiError("not_found").response()
        return not_found_page()

    async def unhandled(request: Request, _exc: Exception) -> Response:
        if request.url.path.startswith("/api"):
            return ApiError("internal").response()
        return error_page()

    every_method = ["GET", "POST", "PUT", "PATCH", "DELETE"]
    routes = [
        Route("/", landing),
        *[Route(path, owner_screen) for path in OWNER_SCREENS],
        Route("/vault/holdings/{id}", record_screen),
        Route("/vault/breaches/{id}", record_screen),
        Route("/shared", shared_screen),
        Route("/auth/login", login),
        Route("/auth/callback", callback),
        Route("/auth/logout", logout, methods=["POST"]),
        *api_routes(state),
        Mount("/static", StaticFiles(directory=str(STATIC_DIRECTORY))),
        Route("/api/{path:path}", unknown_api, methods=every_method),
        Route("/{path:path}", unknown_page, methods=every_method),
    ]
    return Starlette(
        routes=routes,
        lifespan=lifespan,
        exception_handlers={HTTPException: unroutable, Exception: unhandled},
    )


def sign_in_first(request: Request) -> Response:
    """A signed-out screen request remembers where it was going."""
    requested = request.url.path
    if request.url.query:
        requested = f"{requested}?{request.url.query}"
    return RedirectResponse(
        f"/?next={urllib.parse.quote(requested, safe='')}", status_code=302
    )

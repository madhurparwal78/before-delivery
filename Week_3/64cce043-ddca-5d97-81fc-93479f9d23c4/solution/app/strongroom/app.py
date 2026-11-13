"""The ASGI application: routes, the server boundary and the background work."""
from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import api, auth, config, db, events, pages
from .errors import ApiError, error_response
from .realm import Realm, RealmUnavailable
from .state import State

log = logging.getLogger("strongroom")
STATIC = Path(__file__).parent / "static"
BODY_LIMIT = 65_536
WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
REALM_RETRY_S = 30


class Boundary:
    """413, 415 and 403 cross_origin, checked before anything else on every write."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] not in WRITE_METHODS:
            await self.app(scope, receive, send)
            return
        request = Request(scope)
        declared = request.headers.get("content-length", "")
        body, oversized = b"", declared.isdigit() and int(declared) > BODY_LIMIT
        while not oversized:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body += message.get("body", b"")
            oversized = len(body) > BODY_LIMIT
            if not message.get("more_body"):
                break
        media = request.headers.get("content-type", "").split(";")[0].strip().lower()
        origin = request.headers.get("origin")
        refusal = ("too_large" if oversized else
                   "unsupported_media_type" if body.strip() and media != "application/json" else
                   "cross_origin" if origin is not None and not auth.same_origin(request, origin) else None)
        if refusal is not None:
            await error_response(ApiError(refusal))(scope, receive, send)
            return
        replayed = False

        async def replay() -> Message:
            nonlocal replayed
            if replayed:
                return await receive()
            replayed = True
            return {"type": "http.request", "body": body, "more_body": False}

        await self.app(scope, replay, send)


async def _api_error(_request: Request, error: Exception) -> Response:
    return error_response(error)


async def _internal(request: Request, error: Exception) -> Response:
    log.exception("unhandled error on %s %s", request.method, request.url.path, exc_info=error)
    return error_response(ApiError("internal"))


async def _api_not_found(_request: Request) -> Response:
    return error_response(ApiError("not_found"))


async def _start(state: State) -> None:
    pool = await db.connect_pool(state.config)
    await db.migrate_and_seed(pool, state.config)
    state.pool = pool


async def _retry_realm_logouts(state: State) -> None:
    """A revoke during an identity outage still ends the realm sessions once the realm answers again."""
    while True:
        await asyncio.sleep(REALM_RETRY_S)
        if state.pool is None:
            continue
        try:
            async with state.pool.acquire() as conn:
                queued = [r["user_id"] for r in await conn.fetch("SELECT user_id FROM realm_logout")]
            for user_id in queued:
                await state.realm.end_sessions(user_id)
                async with state.pool.acquire() as conn:
                    await conn.execute("DELETE FROM realm_logout WHERE user_id = $1", user_id)
        except RealmUnavailable:
            continue


async def _seed_realm(state: State) -> None:
    try:
        await state.realm.ensure_seeded(db.SEED_ACCOUNTS)
    except RealmUnavailable:
        log.warning("realm unreachable at start; seeded accounts are checked again at sign-in")


def create_app() -> Starlette:
    settings = config.load()
    state = State(settings, Realm(settings))

    @asynccontextmanager
    async def lifespan(_app: Starlette) -> AsyncIterator[None]:
        tasks = [asyncio.create_task(_start(state)),
                 asyncio.create_task(_retry_realm_logouts(state)), asyncio.create_task(_seed_realm(state))]
        yield
        for task in tasks:
            task.cancel()
        await state.realm.close()
        if state.pool is not None:
            await state.pool.close()

    routes = [
        Route("/api/health", api.health),
        Route("/api/status", api.status),
        Route("/api/me", api.me),
        Route("/api/kinds", api.kinds),
        Route("/api/exposure", api.exposure),
        Route("/api/holdings", api.list_holdings, methods=["GET"]),
        Route("/api/holdings", api.create_holding, methods=["POST"]),
        Route("/api/holdings/{id}", api.get_holding, methods=["GET"]),
        Route("/api/holdings/{id}", api.update_holding, methods=["PATCH"]),
        Route("/api/holdings/{id}", api.delete_holding, methods=["DELETE"]),
        Route("/api/rules", api.list_rules, methods=["GET"]),
        Route("/api/rules", api.create_rule, methods=["POST"]),
        Route("/api/rules/order", api.reorder_rules, methods=["PUT"]),
        Route("/api/rules/preview", api.preview_rules, methods=["POST"]),
        Route("/api/rules/{id}", api.update_rule, methods=["PATCH"]),
        Route("/api/rules/{id}", api.delete_rule, methods=["DELETE"]),
        Route("/api/breaches", api.list_breaches, methods=["GET"]),
        Route("/api/breaches", api.create_breach, methods=["POST"]),
        Route("/api/breaches/preview", api.preview_breach, methods=["POST"]),
        Route("/api/breaches/{id}", api.get_breach, methods=["GET"]),
        Route("/api/breaches/{id}", api.update_breach, methods=["PATCH"]),
        Route("/api/breaches/{id}", api.delete_breach, methods=["DELETE"]),
        Route("/api/steps/{id}/{action:str}", api.change_step, methods=["POST"]),
        Route("/api/grant", api.get_grant, methods=["GET"]),
        Route("/api/grant", api.create_grant, methods=["POST"]),
        Route("/api/grant", api.narrow_grant, methods=["PATCH"]),
        Route("/api/grant", api.revoke_grant, methods=["DELETE"]),
        Route("/api/contact/grant", api.contact_grant),
        Route("/api/account/password", api.change_password, methods=["POST"]),
        Route("/api/events", events.events),
        Route("/api/{rest:path}", _api_not_found, methods=["GET", "POST", "PUT", "PATCH", "DELETE"]),
        Route("/auth/login", auth.login),
        Route("/auth/callback", auth.callback),
        Route("/auth/logout", auth.logout, methods=["POST"]),
        Mount("/assets", StaticFiles(directory=STATIC)),
        Route("/{rest:path}", pages.screen),
    ]
    app = Starlette(routes=routes, lifespan=lifespan,
                    exception_handlers={ApiError: _api_error, Exception: _internal})
    app.state.strongroom = state
    app.add_middleware(Boundary)
    return app

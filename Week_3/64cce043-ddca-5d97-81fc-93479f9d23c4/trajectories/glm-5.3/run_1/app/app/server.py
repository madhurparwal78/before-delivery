"""The server: routes, middleware, static assets and the entry point."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import pathlib
import sys
from typing import Optional

from aiohttp import web

from .config import Config, load_config
from .db.base import Database
from .db.seed import apply_schema_and_seed
from .auth.identity import Identity
from .auth.tokens import TokenVerifier
from .auth.store import Store
from .core.vault_reader import VaultReader
from .core.vault_writer import VaultWriter
from .api import account as account_routes
from .api import breaches as breach_routes
from .api import grant as grant_routes
from .api import holdings as holding_routes
from .api import rules as rule_routes
from .api import steps as step_routes
from .api.auth_routes import callback, login, logout
from urllib.parse import quote

from .api.boundary import (
    check_same_origin,
    current_context,
    read_content_type,
    request_origin,
)
from .api.events import EventHub, events_stream
from .errors import ApiError, access_ended, error_response, internal_error, signed_out, not_found
from .core.grant_state import grant_status

log = logging.getLogger("strongroom.server")

STATIC_DIR = pathlib.Path(__file__).parent / "static"

# Routes that need no session.


@web.middleware
async def api_middleware(request: web.Request, handler):
    """The API boundary: error shape, precedence and session checks."""
    if not request.path.startswith("/api/"):
        return await handler(request)
    try:
        # 1. Boundary checks run first: 413, 415 and 403 cross_origin.
        check_same_origin(request)
        # 2. Public routes answer without a session: health and status.
        if request.path in ("/api/health", "/api/status"):
            return await handler(request)
        if request.method in ("POST", "PUT", "PATCH"):
            await read_content_type(request)
        # 3. 401 signed_out, including an idle-expired session.
        ctx = await current_context(request)
        if ctx is None:
            raise signed_out()
        request["ctx"] = ctx
        # 4. 403 access_ended for a contact whose grant has ended, on every
        #    route except the ones that still answer.
        if ctx.account.role == "contact" and request.path not in (
            "/api/me", "/api/contact/grant", "/api/events", "/api/health", "/api/status", "/api/kinds"
        ):
            grant, status, _remaining = await _contact_grant_state(request)
            if grant is None or status != "active":
                raise access_ended()
        return await handler(request)
    except ApiError as err:
        return error_response(err)
    except web.HTTPException:
        raise
    except asyncio.CancelledError:
        raise
    except Exception:
        log.exception("unhandled error on %s", request.path)
        return error_response(internal_error())


async def _contact_grant_state(request: web.Request):
    reader = request.app["reader"]
    ctx = request["ctx"]
    vault_id = ctx.account.vault_id
    if vault_id is None:
        return None, "expired", 0
    grant = await reader.grant_for_vault(vault_id)
    if grant is None:
        return None, "expired", 0
    db_now = await request.app["db"].fetchval("SELECT now()")
    status, remaining = grant_status(grant, db_now)
    return grant, status, remaining


def index_page(request: web.Request) -> web.Response:
    return _serve_static("index.html")


def _serve_static(name: str) -> web.Response:
    """Serve a file inside the static dir, refusing anything outside it."""
    base = STATIC_DIR.resolve()
    path = (STATIC_DIR / name).resolve()
    if not str(path).startswith(str(base) + os.sep) and str(path) != str(base):
        return web.Response(status=404, text="Not found.")
    if not path.is_file():
        return web.Response(status=404, text="Not found.")
    if name.endswith(".html"):
        return web.Response(body=path.read_bytes(), content_type="text/html", charset="utf-8")
    if name.endswith(".js"):
        return web.Response(body=path.read_bytes(), content_type="application/javascript", charset="utf-8")
    if name.endswith(".css"):
        return web.Response(body=path.read_bytes(), content_type="text/css", charset="utf-8")
    if name.endswith((".woff2", ".woff", ".ttf")):
        return web.Response(body=path.read_bytes(), content_type="font/ttf")
    return web.Response(body=path.read_bytes(), content_type="application/octet-stream")


async def spa_route(request: web.Request) -> web.Response:
    """The single-page screens: /vault, /shared and their record routes.

    A signed-out request for a vault or shared screen answers 302 to /?next=...
    with the requested path and query percent-encoded as one query value.
    A record route the caller cannot name answers the published 404 page, so
    an outsider learns nothing from it.
    """
    path = request.path
    session_id = request.cookies.get("strongroom_session")
    role: str | None = None
    if session_id:
        store: Store = request.app["store"]
        account = await store.load_session(session_id)
        if account is not None:
            role = account.role
    if role is None:
        target = quote(path + (("?" + request.query_string) if request.query_string else ""), safe="")
        raise web.HTTPFound(f"/?next={target}")
    if role == "owner" and _is_record_route(path):
        if not await _record_route_visible(request, role, path):
            return _not_found_page()
    if role == "contact" and _is_record_route(path):
        if not await _record_route_visible(request, role, path):
            return _not_found_page()
    return _serve_static("app.html")


def _is_record_route(path: str) -> bool:
    """Whether the path names a holding or breach by id."""
    parts = [p for p in path.split("/") if p]
    return len(parts) == 3 and parts[0] == "vault" and parts[1] in ("holdings", "breaches")


async def _record_route_visible(request: web.Request, role: str, path: str) -> bool:
    """Whether the named record is inside the caller's view."""
    from .auth.store import Context  # noqa: F401  (typing only)

    ctx = await current_context(request)
    if ctx is None or ctx.account.vault_id is None:
        return False
    record_id = [p for p in path.split("/") if p][-1]
    reader: VaultReader = request.app["reader"]
    if path.startswith("/vault/holdings/"):
        holding = await reader.holding_by_id(ctx.account.vault_id, record_id)
        if holding is None:
            return False
        if role == "contact":
            grant, status, _rem = await _contact_grant_state_for(request, ctx)
            if grant is None or status != "active":
                return False
            return holding["level"] in grant.levels
        return True
    if path.startswith("/vault/breaches/"):
        breach = await reader.breach_by_id(ctx.account.vault_id, record_id)
        return breach is not None
    return False


async def _contact_grant_state_for(request: web.Request, ctx):
    reader: VaultReader = request.app["reader"]
    vault_id = ctx.account.vault_id
    grant = await reader.grant_for_vault(vault_id)
    if grant is None:
        return None, "expired", 0
    db_now = await request.app["db"].fetchval("SELECT now()")
    return grant, *grant_status(grant, db_now)


def _not_found_page() -> web.Response:
    body = (
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf\">"
        "<title>Not found</title>"
        "<link rel=\"stylesheet\" href=\"/static/app.css\">"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"></head>"
        "<body class=\"auth-page\"><main class=\"auth-panel\">"
        "<h1 class=\"screen-title\">Not found</h1>"
        "<p>This record does not exist or is not in your view.</p>"
        "<p><a href=\"/vault\" id=\"back\">Back to ledger</a></p>"
        "</main></body></html>"
    )
    return web.Response(status=404, text=body, content_type="text/html", charset="utf-8")


def not_found_page(request: web.Request) -> web.Response:
    return web.Response(status=404, text="Not found.")


def build_app(cfg: Config) -> web.Application:
    db = Database(cfg)
    identity = Identity(cfg)
    verifier = TokenVerifier(identity, cfg)
    store = Store(db)
    reader = VaultReader(db)
    writer = VaultWriter(db)
    hub = EventHub(db)

    app = web.Application(
        middlewares=[api_middleware],
        client_max_size=1 + 1024 * 1024,  # the middleware enforces the exact limit
    )
    app["cfg"] = cfg
    app["db"] = db
    app["identity"] = identity
    app["verifier"] = verifier
    app["store"] = store
    app["reader"] = reader
    app["writer"] = writer
    app["hub"] = hub
    app["ready"] = False

    # --- Sign-in routes (HTML redirects, not JSON)
    app.router.add_get("/auth/login", login)
    app.router.add_get("/auth/callback", callback)
    app.router.add_post("/auth/logout", logout)

    # --- JSON API
    app.router.add_get("/api/health", account_routes.get_health)
    app.router.add_get("/api/status", account_routes.get_status)
    app.router.add_get("/api/me", account_routes.get_me)
    app.router.add_get("/api/kinds", account_routes.get_kinds)
    app.router.add_get("/api/holdings", holding_routes.list_holdings)
    app.router.add_post("/api/holdings", holding_routes.create_holding)
    app.router.add_get("/api/holdings/{id}", holding_routes.get_holding)
    app.router.add_patch("/api/holdings/{id}", holding_routes.patch_holding)
    app.router.add_delete("/api/holdings/{id}", holding_routes.delete_holding)
    app.router.add_get("/api/rules", rule_routes.list_rules)
    app.router.add_post("/api/rules", rule_routes.create_rule)
    app.router.add_patch("/api/rules/{id}", rule_routes.patch_rule)
    app.router.add_delete("/api/rules/{id}", rule_routes.delete_rule)
    app.router.add_put("/api/rules/order", rule_routes.put_rule_order)
    app.router.add_post("/api/rules/preview", rule_routes.post_rule_preview)
    app.router.add_get("/api/breaches", breach_routes.list_breaches)
    app.router.add_post("/api/breaches", breach_routes.create_breach)
    app.router.add_post("/api/breaches/preview", breach_routes.post_breach_preview)
    app.router.add_get("/api/breaches/{id}", breach_routes.get_breach)
    app.router.add_patch("/api/breaches/{id}", breach_routes.patch_breach)
    app.router.add_delete("/api/breaches/{id}", breach_routes.delete_breach)
    app.router.add_get("/api/exposure", step_routes.get_exposure)
    app.router.add_post("/api/steps/{id}/done", step_routes.post_step_done)
    app.router.add_post("/api/steps/{id}/reopen", step_routes.post_step_reopen)
    app.router.add_get("/api/grant", grant_routes.get_grant)
    app.router.add_post("/api/grant", grant_routes.post_grant)
    app.router.add_patch("/api/grant", grant_routes.patch_grant)
    app.router.add_delete("/api/grant", grant_routes.delete_grant)
    app.router.add_get("/api/contact/grant", grant_routes.get_contact_grant)
    app.router.add_post("/api/account/password", account_routes.post_change_password)
    app.router.add_get("/api/events", events_stream)

    # --- Static assets and screens
    app.router.add_get("/", index_page)
    app.router.add_get("/vault", spa_route)
    app.router.add_get("/vault/{tail:.*}", spa_route)
    app.router.add_get("/shared", spa_route)
    app.router.add_get("/static/{name:.+}", static_file)
    app.router.add_get("/{tail:.*}", not_found_page)

    return app


async def static_file(request: web.Request) -> web.Response:
    """Only the built static assets are served; never source, manifest or credentials."""
    name = request.match_info.get("name", "")
    if name.startswith(".") or ".." in name or "\\" in name:
        return web.Response(status=404, text="Not found.")
    return _serve_static(name)


async def on_startup(app: web.Application) -> None:
    cfg: Config = app["cfg"]
    db: Database = app["db"]
    identity: Identity = app["identity"]
    await identity.start()
    # The database is retried every 2 seconds until it connects.
    while True:
        if await db.connect():
            break
        await asyncio.sleep(2)
    await apply_schema_and_seed(db, identity)
    app["hub"].db = db
    await app["hub"].start()
    app["ready"] = True
    log.info("strongroom listening on port %s", cfg.public_port)


async def on_cleanup(app: web.Application) -> None:
    await app["hub"].stop()
    await app["identity"].close()
    await app["db"].close()


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    cfg = load_config()
    app = build_app(cfg)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    web.run_app(
        app,
        host="0.0.0.0",
        port=cfg.public_port,
        print=None,
        access_log=None,
    )


if __name__ == "__main__":
    main()

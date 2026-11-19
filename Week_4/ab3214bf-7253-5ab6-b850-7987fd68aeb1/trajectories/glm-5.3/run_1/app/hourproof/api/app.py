"""The ASGI application: routes, sessions, the body limit and the ledger read.
"""
from __future__ import annotations

import inspect
import json
from typing import Any

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from .. import clock, config
from . import errors
from .analyst import (
    allocation_post, cancellations_get, cancellations_post, exclusion_put, gaps_repair,
    holdings_sync, hours_spread, merit_order_put, pull_meters, resume, submit,
    substitution_put,
)
from .public import (
    corrections_pull, health, public_statement, public_statement_bytes,
    sealed_scores, window_statement_bytes,
)
from .routes import (
    Ctx, apply_deadline_transitions, get_window_for, grains_get, hours_get, lots_get,
    me, sign_in, sign_out, window_get, windows_list,
)
from .verifier import (
    firms_get, group_scores, policy_put, review_complete, review_return, rotate_key,
    sample_get, sample_put, sign_window, verifier_put,
)

SESSION_COOKIE = "hourproof_session"


def _with_server_now(payload: dict[str, Any]) -> JSONResponse:
    if "server_now" not in payload:
        payload = {**payload, "server_now": clock.now().strftime("%Y-%m-%dT%H:%M:%SZ")}
    return JSONResponse(payload)


def api_error_response(err: errors.ApiError) -> JSONResponse:
    return JSONResponse(err.body(), status_code=err.status)


async def _read_json(request: Request) -> Any:
    raw = await request.body()
    if not raw:
        return {}
    if len(raw) > config.MAX_BODY_BYTES:
        raise errors.ApiError(413, "BODY_TOO_LARGE")
    try:
        return json.loads(raw)
    except Exception:
        return {}


async def _ctx(request: Request, conn) -> Ctx:
    token = request.cookies.get(SESSION_COOKIE)
    user = None
    if token:
        row = await conn.fetchrow(
            "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1",
            token,
        )
        user = dict(row) if row else None
    body = await _read_json(request) if request.method in ("POST", "PUT", "PATCH") else {}
    return Ctx(user, body, conn, request.method)


async def _handle(request: Request, fn, **kwargs) -> Response:
    from ..db import pool
    async with pool().acquire() as conn:
        async with conn.transaction():
            try:
                ctx = await _ctx(request, conn)
                result = fn(ctx, **kwargs)
                if inspect.isawaitable(result):
                    result = await result
                if isinstance(result, tuple) and len(result) == 2 and isinstance(result[0], int):
                    status, payload = result
                    payload = {**payload, "server_now": clock.now().strftime("%Y-%m-%dT%H:%M:%SZ")}
                    return JSONResponse(payload, status_code=status)
                return _with_server_now(result)
            except errors.ApiError as err:
                return api_error_response(err)


def _cookie(token: str) -> dict[str, Any]:
    return {"key": SESSION_COOKIE, "value": token, "httponly": True,
            "samesite": "lax", "path": "/"}


async def sign_in_route(request: Request) -> Response:
    from ..db import pool
    async with pool().acquire() as conn:
        async with conn.transaction():
            try:
                ctx = await _ctx(request, conn)
                payload, token = await sign_in(ctx)
                response = _with_server_now(payload)
                response.set_cookie(**_cookie(token))
                return response
            except errors.ApiError as err:
                return api_error_response(err)


async def sign_out_route(request: Request) -> Response:
    from ..db import pool
    async with pool().acquire() as conn:
        async with conn.transaction():
            try:
                ctx = await _ctx(request, conn)
                result = await sign_out(ctx, request.cookies.get(SESSION_COOKIE))
                response = _with_server_now(result)
                response.delete_cookie(SESSION_COOKIE, path="/")
                return response
            except errors.ApiError as err:
                return api_error_response(err)


def _pdf_route(fetch, key_name: str):
    async def handler(request: Request) -> Response:
        from ..db import pool
        async with pool().acquire() as conn:
            try:
                ctx = await _ctx(request, conn)
                data = await fetch(ctx, request.path_params[key_name])
                return Response(data, media_type="application/pdf")
            except errors.ApiError as err:
                return api_error_response(err)
    return handler


async def ledger_get(ctx: Ctx, window_id: str) -> dict[str, Any]:
    from .service import balances_for
    await ctx.any_signed_in()
    window = await get_window_for(ctx, window_id)
    balances = await balances_for(ctx.conn, window_id)
    size = 50
    total = await ctx.conn.fetchval(
        "SELECT COUNT(*) FROM ledger_entries WHERE window_id = $1", window_id
    )
    page = 1
    try:
        requested = int(ctx.request_page or 1)
        if requested > 0:
            page = requested
    except Exception:
        page = 1
    page_count = max(1, (total + size - 1) // size)
    page = min(page, page_count)
    offset = (page - 1) * size
    rows = await ctx.conn.fetch(
        "SELECT * FROM ledger_entries WHERE window_id = $1"
        " ORDER BY at DESC, movement_id DESC OFFSET $2 LIMIT $3",
        window_id, offset, size,
    )
    entries = [{
        "movement_id": r["movement_id"], "kind": r["kind"], "account": r["account"],
        "wh": r["wh"], "lot_id": r["lot_id"], "bundle_id": r["bundle_id"],
        "line_id": r["line_id"], "label": r["label"],
        "at": r["at"].strftime("%Y-%m-%dT%H:%M:%SZ"),
    } for r in rows]
    return {
        "opening_wh": balances["opening_wh"],
        "balances": {
            "holdings_wh": balances["holdings_wh"],
            "allocated_wh": balances["allocated_wh"],
            "cancelled_wh": balances["cancelled_wh"],
            "loss_wh": balances["loss_wh"],
        },
        "entries": entries,
        "page": page,
        "page_count": page_count,
    }


def _req_route(build):
    async def handler(request: "Request") -> "Response":
        inner = build(request)
        return await _handle(request, inner)
    return handler

def _make_route(_ignore, inner):
    async def handler(request: "Request") -> "Response":
        return await _handle(request, inner)
    return handler


def _wr(fn):
    async def handler(request: "Request") -> "Response":
        async def inner(ctx: Ctx):
            return await fn(ctx, request.path_params["window_id"])
        return await _handle(request, inner)
    return handler

def routes() -> list[Route]:
    def h(fn, **kw):
        async def handler(request: Request) -> Response:
            return await _handle(request, fn, **kw)
        return handler

    async def ledger_route(request: Request) -> Response:
        page = request.query_params.get("page")
        async def runner(ctx: Ctx) -> dict[str, Any]:
            ctx.request_page = page
            return await ledger_get(ctx, request.path_params["window_id"])
        return await _handle(request, runner)

    async def cancellations_route(request: Request) -> Response:
        window_id = request.path_params["window_id"]
        async def runner(ctx: Ctx) -> dict[str, Any]:
            if ctx.method == "GET":
                return await cancellations_get(ctx, window_id)
            return await cancellations_post(ctx, window_id)
        return await _handle(request, runner)

    return [
        Route("/api/auth/sign-in", sign_in_route, methods=["POST"]),
        Route("/api/auth/sign-out", sign_out_route, methods=["POST"]),
        Route("/api/me", h(me), methods=["GET"]),
        Route("/api/windows", _req_route(lambda r: lambda ctx: windows_list(ctx, r.query_params.get("state"))), methods=["GET"]),
        Route("/api/windows/{window_id}", _wr(window_get), methods=["GET"]),
        Route("/api/windows/{window_id}/grains/{grain}", _req_route(lambda r: lambda ctx: grains_get(ctx, r.path_params["window_id"],
                                      r.path_params["grain"])), methods=["GET"]),
        Route("/api/windows/{window_id}/hours/{hour_text}", _req_route(lambda r: lambda ctx: hours_get(ctx, r.path_params["window_id"],
                                      r.path_params["hour_text"])), methods=["GET"]),
        Route("/api/windows/{window_id}/meters/pull", _wr(pull_meters), methods=["POST"]),
        Route("/api/windows/{window_id}/gaps/repair", _wr(gaps_repair), methods=["POST"]),
        Route("/api/windows/{window_id}/hours/{hour_text}/substitution", _req_route(lambda r: lambda ctx: substitution_put(ctx, r.path_params["window_id"],
                                             r.path_params["hour_text"])), methods=["PUT"]),
        Route("/api/windows/{window_id}/hours/spread", _wr(hours_spread), methods=["POST"]),
        Route("/api/windows/{window_id}/lots", _wr(lots_get), methods=["GET"]),
        Route("/api/windows/{window_id}/merit-order", _wr(merit_order_put), methods=["PUT"]),
        Route("/api/windows/{window_id}/lots/{lot_id}/exclusion", _req_route(lambda r: lambda ctx: exclusion_put(ctx, r.path_params["window_id"],
                                         r.path_params["lot_id"])), methods=["PUT"]),
        Route("/api/windows/{window_id}/allocation", _wr(allocation_post), methods=["POST"]),
        Route("/api/windows/{window_id}/holdings/sync", _wr(holdings_sync), methods=["POST"]),
        Route("/api/windows/{window_id}/submit", _wr(submit), methods=["POST"]),
        Route("/api/windows/{window_id}/resume", _wr(resume), methods=["POST"]),
        Route("/api/windows/{window_id}/sample", _wr(sample_get), methods=["GET"]),
        Route("/api/windows/{window_id}/sample/{hour_text}", _req_route(lambda r: lambda ctx: sample_put(ctx, r.path_params["window_id"],
                                      r.path_params["hour_text"])), methods=["PUT"]),
        Route("/api/windows/{window_id}/review/return", _wr(review_return), methods=["POST"]),
        Route("/api/windows/{window_id}/review/complete", _wr(review_complete), methods=["POST"]),
        Route("/api/windows/{window_id}/cancellations", cancellations_route,
              methods=["POST", "GET"]),
        Route("/api/windows/{window_id}/sign", _wr(sign_window), methods=["POST"]),
        Route("/api/windows/{window_id}/attestation.pdf", _pdf_route(
            window_statement_bytes, "window_id"), methods=["GET"]),
        Route("/api/windows/{window_id}/verifier", _wr(verifier_put), methods=["PUT"]),
        Route("/api/windows/{window_id}/ledger", ledger_route, methods=["GET"]),
        Route("/api/sites/{site_id}/corrections/pull", _req_route(lambda r: lambda ctx: corrections_pull(ctx, r.path_params["site_id"])), methods=["POST"]),
        Route("/api/sites/{site_id}/policy", _req_route(lambda r: lambda ctx: policy_put(ctx, r.path_params["site_id"])), methods=["PUT"]),
        Route("/api/firms", h(firms_get), methods=["GET"]),
        Route("/api/firms/{firm_id}/keys/rotate", _req_route(lambda r: lambda ctx: rotate_key(ctx, r.path_params["firm_id"])), methods=["POST"]),
        Route("/api/group/scores", h(group_scores), methods=["GET"]),
        Route("/api/public/statements/{code}", _req_route(lambda r: lambda ctx: public_statement(ctx, r.path_params["code"])), methods=["GET"]),
        Route("/api/public/sealed-scores", h(sealed_scores), methods=["GET"]),
        Route("/check/{code}/attestation.pdf", _pdf_route(
            public_statement_bytes, "code"), methods=["GET"]),
        Route("/api/health", lambda r: JSONResponse(health()), methods=["GET"]),
    ]


async def create_app() -> Starlette:
    from ..db import start_pool, wait_for_database
    from .. import seed as seed_module
    from .. import first_serve
    await wait_for_database()
    await start_pool()
    from ..db import pool
    async with pool().acquire() as conn:
        async with conn.transaction():
            await seed_module.seed(conn)
            await first_serve.first_serve_allocation(conn)
    from .static_files import spa_routes
    return Starlette(routes=routes() + spa_routes())

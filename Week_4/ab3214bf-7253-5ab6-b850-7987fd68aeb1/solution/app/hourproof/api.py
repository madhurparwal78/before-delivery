"""The HTTP surface: JSON endpoints, the two PDF routes and the single-page shell."""

from __future__ import annotations

import json
import re
import sys
import traceback
from collections.abc import Awaitable, Callable
from contextlib import AbstractAsyncContextManager
from pathlib import Path

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response
from starlette.routing import BaseRoute, Mount, Route
from starlette.staticfiles import StaticFiles

from . import analyst, cancellation, oversight, restatement, review, sealing
from .clock import parse_hour
from .desk import LANDING, Desk, User
from .errors import ApiError, validation, wrong_state
from .jsontypes import JsonObject
from .scoring import GRAINS
from .views import grain_json, hour_json, lot_json, window_json

BODY_LIMIT = 1_000_000
STATIC = Path(__file__).parent / "static"
SESSION_COOKIE = "hp_session"
PAGE_SIZE = 200
SHELL_ROUTES = re.compile(r"^/(sign-in|windows(/[^/]+(/(lots|ledger))?)?|review(/[^/]+)?|group|check(/[^/]+)?)?$")
Reply = JsonObject | tuple[int, JsonObject] | Response
Handler = Callable[[Request, Desk, "User | None", JsonObject], Awaitable[Reply]]


async def read_body(request: Request) -> bytes:
    """The raw body, refused past the published size limit."""
    total, chunks = 0, []
    async for chunk in request.stream():
        total += len(chunk)
        if total <= BODY_LIMIT:
            chunks.append(chunk)
        elif total > 16 * BODY_LIMIT:
            break
    if total > BODY_LIMIT:
        raise ApiError("BODY_TOO_LARGE")
    return b"".join(chunks)


def parse_body(raw: bytes) -> JsonObject:
    """An empty body reads as no fields; anything but a JSON object is refused as a validation error."""
    if not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
    except ValueError as error:
        raise validation() from error
    if not isinstance(parsed, dict):
        raise validation()
    return parsed


def json_reply(payload: JsonObject, status: int = 200) -> JSONResponse:
    return JSONResponse(payload, status_code=status, media_type="application/json; charset=utf-8")


def error_reply(desk: Desk, error: ApiError) -> JSONResponse:
    return json_reply({**error.body(), "server_now": desk.server_now()}, error.status)


def endpoint(handler: Handler, *, public: bool = False) -> Callable[[Request], Awaitable[Response]]:
    async def route(request: Request) -> Response:
        desk: Desk = request.app.state.desk
        try:
            if any("\x00" in str(value) for value in request.path_params.values()):
                raise ApiError("NOT_FOUND")
            raw = await read_body(request) if request.method in ("POST", "PUT") else b""
            user = None if public else await desk.authenticate(request.cookies.get(SESSION_COOKIE))
            result = await handler(request, desk, user, parse_body(raw))
        except ApiError as error:
            return error_reply(desk, error)
        except Exception:
            traceback.print_exc(file=sys.stderr)
            return error_reply(desk, ApiError("INTERNAL"))
        if isinstance(result, Response):
            return result
        status, payload = result if isinstance(result, tuple) else (200, result)
        return json_reply({**payload, "server_now": desk.server_now()}, status)

    return route


# ---- sessions -----------------------------------------------------------------------------------------------


async def sign_in(request: Request, desk: Desk, user: None, body: JsonObject) -> Response:
    signed, token = await desk.sign_in(body.get("email"), body.get("password"))
    response = json_reply(
        {"user": signed.public(), "landing_url": LANDING[signed.role], "server_now": desk.server_now()}
    )
    response.set_cookie(SESSION_COOKIE, token, httponly=True, samesite="lax", path="/")
    return response


async def sign_out(request: Request, desk: Desk, user: User, body: JsonObject) -> Reply:
    await desk.sign_out(request.cookies[SESSION_COOKIE])
    return {"signed_out": True}


async def me(request: Request, desk: Desk, user: User, body: JsonObject) -> Reply:
    return {"user": user.public()}


# ---- reads --------------------------------------------------------------------------------------------------


def _with_factors(desk: Desk, views: list[JsonObject]) -> list[JsonObject]:
    for view in views:
        if view["residual_emissions_g"] is None:
            desk.schedule_factors(view["id"])
    return views


async def list_windows(request: Request, desk: Desk, user: User, body: JsonObject) -> Reply:
    ctx = desk.context()
    found = await desk.visible_windows(user, request.query_params.get("state"))
    return {"windows": _with_factors(desk, [window_json(window, ctx) for window in found])}


async def get_window(request: Request, desk: Desk, user: User, body: JsonObject) -> Reply:
    window_id = request.path_params["window_id"]
    window = await desk.window_for_read(user, window_id)
    view = window_json(window, desk.context())
    if view["residual_emissions_g"] is None and await desk.fetch_factors_if_due(window_id):
        view = window_json(await desk.window_for_read(user, window_id), desk.context())
    return view


async def get_grain(request: Request, desk: Desk, user: User, body: JsonObject) -> Reply:
    window = await desk.window_for_read(user, request.path_params["window_id"])
    grain = request.path_params["grain"]
    if grain not in GRAINS:
        raise ApiError("NOT_FOUND")
    return grain_json(window, grain, desk.context())


async def get_hour(request: Request, desk: Desk, user: User, body: JsonObject) -> Reply:
    window = await desk.window_for_read(user, request.path_params["window_id"])
    hour = parse_hour(request.path_params["hour"])
    if hour is None or hour not in window.rows:
        raise ApiError("NOT_FOUND")
    return hour_json(window, hour, desk.context())


async def get_lots(request: Request, desk: Desk, user: User, body: JsonObject) -> Reply:
    window = await desk.window_for_read(user, request.path_params["window_id"])
    ctx = desk.context()
    return {"lots": lot_json(window, window.allocation(ctx.now), ctx)}


async def get_ledger(request: Request, desk: Desk, user: User, body: JsonObject) -> Reply:
    window_id = request.path_params["window_id"]
    await desk.window_for_read(user, window_id)
    page_text = request.query_params.get("page", "1")
    page = int(page_text) if page_text.isdigit() and int(page_text) >= 1 else 1
    balances = await desk.pool.fetch(
        "SELECT account, sum(wh)::bigint AS total FROM ledger_entries WHERE window_id = $1 GROUP BY account", window_id
    )
    by_account = {row["account"]: row["total"] for row in balances}
    opening = await desk.pool.fetchval(
        "SELECT coalesce(sum(wh), 0)::bigint FROM ledger_entries WHERE window_id = $1 AND kind = 'deposit' "
        "AND account = 'holdings'",
        window_id,
    )
    count = await desk.pool.fetchval("SELECT count(*) FROM ledger_entries WHERE window_id = $1", window_id)
    rows = await desk.pool.fetch(
        "SELECT * FROM ledger_entries WHERE window_id = $1 ORDER BY at DESC, movement_id DESC, seq ASC LIMIT $2 OFFSET $3",
        window_id,
        PAGE_SIZE,
        (page - 1) * PAGE_SIZE,
    )
    entries = [
        {
            "movement_id": row["movement_id"],
            "kind": row["kind"],
            "account": row["account"],
            "wh": row["wh"],
            "lot_id": row["lot_id"],
            "bundle_id": row["bundle_id"],
            "line_id": row["line_id"],
            "label": row["label"],
            "at": row["at"].strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        for row in rows
    ]
    return {
        "opening_wh": opening,
        "balances": {
            "holdings_wh": by_account.get("holdings", 0),
            "allocated_wh": by_account.get("allocated", 0),
            "cancelled_wh": by_account.get("cancelled", 0),
            "loss_wh": by_account.get("loss", 0),
        },
        "entries": entries,
        "page": page,
        "page_count": max(1, -(-count // PAGE_SIZE)),
    }


async def get_sample(request: Request, desk: Desk, user: User, body: JsonObject) -> Reply:
    return await review.read_sample(desk, user, request.path_params["window_id"])


async def get_lines(request: Request, desk: Desk, user: User, body: JsonObject) -> Reply:
    return await cancellation.list_lines(desk, user, request.path_params["window_id"])


async def window_pdf(request: Request, desk: Desk, user: User, body: JsonObject) -> Reply:
    window = await desk.window_for_read(user, request.path_params["window_id"])
    if window.state not in ("Sealed", "Restated"):
        raise wrong_state(window.state)
    return pdf_response(await sealing.statement_pdf(desk, window.columns["statement_code"]))


def pdf_response(content: bytes) -> Response:
    return Response(content, media_type="application/pdf", headers={"Cache-Control": "no-store"})


# ---- analyst writes -----------------------------------------------------------------------------------------


def window_action(action: Callable[[Desk, User, str, JsonObject], Awaitable[JsonObject]]) -> Handler:
    async def handler(request: Request, desk: Desk, user: User, body: JsonObject) -> Reply:
        return await action(desk, user, request.path_params["window_id"], body)

    return handler


async def put_substitution(request: Request, desk: Desk, user: User, body: JsonObject) -> Reply:
    return await analyst.substitute(desk, user, request.path_params["window_id"], request.path_params["hour"], body)


async def put_exclusion(request: Request, desk: Desk, user: User, body: JsonObject) -> Reply:
    return await analyst.set_exclusion(
        desk, user, request.path_params["window_id"], request.path_params["lot_id"], body
    )


async def put_result(request: Request, desk: Desk, user: User, body: JsonObject) -> Reply:
    return await review.record_result(desk, user, request.path_params["window_id"], request.path_params["hour"], body)


async def post_cancellations(request: Request, desk: Desk, user: User, body: JsonObject) -> Reply:
    return await cancellation.submit_cancellations(desk, user, request.path_params["window_id"])


async def post_complete(request: Request, desk: Desk, user: User, body: JsonObject) -> Reply:
    return await review.complete_review(desk, user, request.path_params["window_id"])


async def post_sign(request: Request, desk: Desk, user: User, body: JsonObject) -> Reply:
    view, held = await sealing.sign_window(desk, user, request.path_params["window_id"], body)
    code = view["statement_code"]
    if held == "sealed":
        return {"window": view, "statement_code": code, "landing_url": f"/check/{code}"}
    return 202, {"window": view, "statement_code": code, "message": sealing.HELD_COPY[held]}


# ---- sites, firms, group ------------------------------------------------------------------------------------


async def post_corrections(request: Request, desk: Desk, user: User, body: JsonObject) -> Reply:
    return await restatement.pull_corrections(desk, user, request.path_params["site_id"])


async def put_policy(request: Request, desk: Desk, user: User, body: JsonObject) -> Reply:
    return await oversight.set_policy(desk, user, request.path_params["site_id"], body)


async def get_firms(request: Request, desk: Desk, user: User, body: JsonObject) -> Reply:
    return await oversight.list_firms(desk, user)


async def post_rotate(request: Request, desk: Desk, user: User, body: JsonObject) -> Reply:
    return await sealing.rotate_key(desk, user, request.path_params["firm_id"])


async def get_group(request: Request, desk: Desk, user: User, body: JsonObject) -> Reply:
    return await oversight.group_scores(desk, user)


# ---- public -------------------------------------------------------------------------------------------------


async def get_statement(request: Request, desk: Desk, user: None, body: JsonObject) -> Reply:
    return await sealing.statement_json(desk, request.path_params["code"])


async def get_sealed_scores(request: Request, desk: Desk, user: None, body: JsonObject) -> Reply:
    return await sealing.sealed_scores(desk)


async def public_pdf(request: Request, desk: Desk, user: None, body: JsonObject) -> Reply:
    return pdf_response(await sealing.statement_pdf(desk, request.path_params["code"]))


async def health(request: Request) -> Response:
    return JSONResponse({"status": "ok"})


async def unknown_api(request: Request) -> Response:
    return error_reply(request.app.state.desk, ApiError("NOT_FOUND"))


async def shell(request: Request) -> Response:
    status = 200 if SHELL_ROUTES.match(request.url.path) else 404
    return FileResponse(STATIC / "index.html", status_code=status, headers={"Cache-Control": "no-cache"})


def routes() -> list[BaseRoute]:
    def api(path: str, handler: Handler, methods: list[str], *, public: bool = False) -> Route:
        return Route(path, endpoint(handler, public=public), methods=methods)

    window = "/api/windows/{window_id}"
    return [
        Route("/api/health", health),
        api("/api/auth/sign-in", sign_in, ["POST"], public=True),
        api("/api/auth/sign-out", sign_out, ["POST"]),
        api("/api/me", me, ["GET"]),
        api("/api/windows", list_windows, ["GET"]),
        api(window, get_window, ["GET"]),
        api(f"{window}/grains/{{grain}}", get_grain, ["GET"]),
        api(f"{window}/hours/spread", window_action(analyst.spread), ["POST"]),
        api(f"{window}/hours/{{hour}}", get_hour, ["GET"]),
        api(f"{window}/hours/{{hour}}/substitution", put_substitution, ["PUT"]),
        api(f"{window}/meters/pull", window_action(analyst.pull_meters), ["POST"]),
        api(f"{window}/gaps/repair", window_action(analyst.repair), ["POST"]),
        api(f"{window}/lots", get_lots, ["GET"]),
        api(f"{window}/merit-order", window_action(analyst.reorder), ["PUT"]),
        api(f"{window}/lots/{{lot_id}}/exclusion", put_exclusion, ["PUT"]),
        api(f"{window}/allocation", window_action(analyst.rerun), ["POST"]),
        api(f"{window}/ledger", get_ledger, ["GET"]),
        api(f"{window}/holdings/sync", window_action(analyst.sync_holdings), ["POST"]),
        api(f"{window}/submit", window_action(analyst.submit), ["POST"]),
        api(f"{window}/resume", window_action(analyst.resume), ["POST"]),
        api(f"{window}/sample", get_sample, ["GET"]),
        api(f"{window}/sample/{{hour}}", put_result, ["PUT"]),
        api(f"{window}/review/return", window_action(review.return_window), ["POST"]),
        api(f"{window}/review/complete", post_complete, ["POST"]),
        api(f"{window}/cancellations", post_cancellations, ["POST"]),
        api(f"{window}/cancellations", get_lines, ["GET"]),
        api(f"{window}/sign", post_sign, ["POST"]),
        api(f"{window}/attestation.pdf", window_pdf, ["GET"]),
        api(f"{window}/verifier", window_action(oversight.assign_verifier), ["PUT"]),
        api("/api/sites/{site_id}/corrections/pull", post_corrections, ["POST"]),
        api("/api/sites/{site_id}/policy", put_policy, ["PUT"]),
        api("/api/firms", get_firms, ["GET"]),
        api("/api/firms/{firm_id}/keys/rotate", post_rotate, ["POST"]),
        api("/api/group/scores", get_group, ["GET"]),
        api("/api/public/statements/{code}", get_statement, ["GET"], public=True),
        api("/api/public/sealed-scores", get_sealed_scores, ["GET"], public=True),
        api("/check/{code}/attestation.pdf", public_pdf, ["GET"], public=True),
        Route("/api/{rest:path}", unknown_api, methods=["GET", "POST", "PUT", "DELETE", "PATCH"]),
        Mount("/static", StaticFiles(directory=STATIC), name="static"),
        Route("/{rest:path}", shell, methods=["GET", "HEAD"]),
    ]


def build_app(lifespan: Callable[[Starlette], AbstractAsyncContextManager[None]]) -> Starlette:
    return Starlette(routes=routes(), lifespan=lifespan)

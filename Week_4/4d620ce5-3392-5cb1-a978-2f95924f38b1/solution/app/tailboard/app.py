"""HTTP surface: the server boundary, the one error precedence, the routes, and the app shell."""

import asyncio
import contextlib
import hashlib
import json
import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import timedelta
from pathlib import Path
from urllib.parse import urlsplit

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import FileResponse, PlainTextResponse, Response, StreamingResponse
from starlette.routing import Route as StarletteRoute

from . import (clock, db, directives, events, exports, imports, notices, packs, people, rules, search, seed,
               storage, threads, views)
from .config import settings
from .errors import ApiError, invalid

STATIC = Path(__file__).resolve().parent.parent / "static"
SHELL = STATIC / "index.html"
LIMITS = {"json": 65_536, "none": 65_536, "pdf": 5_000_000, "evidence": 5_000_000, "csv": 1_000_000}
MEDIA = {"pdf": {"application/pdf"}, "evidence": set(threads.EVIDENCE_TYPES), "csv": {"text/csv"},
         "json": {"application/json"}}
KEY_PATTERN = re.compile(r"[\x20-\x7e]{1,100}")
COOKIE = "tb_session"
API_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
}
log = logging.getLogger("tailboard")


@dataclass
class Ctx:
    request: Request
    params: dict
    user: dict | None
    body: dict
    raw: bytes
    content_type: str
    conn: object = None
    after_commit: list = field(default_factory=list)

    @property
    def query(self):
        return self.request.query_params


@dataclass(frozen=True)
class Route:
    method: str
    pattern: re.Pattern
    handler: Callable[[Ctx], Awaitable]
    body: str = "none"
    keyed: bool = False
    public: bool = False


def json_response(status: int, payload, headers: dict | None = None) -> Response:
    return Response(db.dumps(payload), status_code=status, media_type="application/json; charset=utf-8",
                    headers=headers)


def error_response(error: ApiError) -> Response:
    return json_response(error.status, error.body())


# Handlers ---------------------------------------------------------------------------------------------------------

async def health(ctx: Ctx):
    await ctx.conn.fetchval("SELECT 1")
    return 200, {"status": "ok"}


async def session_create(ctx: Ctx):
    user, token = await people.sign_in(ctx.conn, ctx.body)
    response = json_response(200, {"user": user})
    response.set_cookie(COOKIE, token, httponly=True, samesite="strict", path="/")
    return response


async def session_get(ctx: Ctx):
    return 200, {"user": views.user_of(ctx.user)}


async def session_delete(ctx: Ctx):
    await people.sign_out(ctx.conn, ctx.request.cookies[COOKIE])
    response = Response(status_code=204)
    response.delete_cookie(COOKIE, path="/", httponly=True, samesite="strict")
    return response


async def document_upload(ctx: Ctx):
    return await directives.upload_document(ctx.conn, ctx.user, ctx.raw)


async def directive_list(ctx: Ctx):
    fleet = await views.load_fleet(ctx.conn)
    return 200, {"directives": [views.directive_json(fleet, fleet.directives[i]) for i in fleet.order]}


async def _directive(ctx: Ctx) -> tuple[views.Fleet, dict]:
    fleet = await views.load_fleet(ctx.conn)
    d = fleet.directives.get(ctx.params["id"])
    if d is None:
        raise ApiError("not_found")
    return fleet, d


async def directive_get(ctx: Ctx):
    fleet, d = await _directive(ctx)
    return 200, {"directive": views.directive_json(fleet, d)}


async def directive_create(ctx: Ctx):
    return await directives.ingest_directive(ctx.conn, ctx.user, ctx.body)


async def revision_create(ctx: Ctx):
    return await directives.ingest_revision(ctx.conn, ctx.user, ctx.params["id"], ctx.body)


async def withdrawal_create(ctx: Ctx):
    return 200, await directives.withdraw(ctx.conn, ctx.user, ctx.params["id"], ctx.body)


async def directive_export(ctx: Ctx):
    fleet, d = await _directive(ctx)
    rows, _ = await exports.regulator_rows(ctx.conn, fleet, d["id"])
    name = f"{d['authority']}-{d['number']}-{rules.tag(d['current_revision'])}".replace(" ", "-")
    return Response(exports.csv_bytes(rows), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{name}.csv"'})


async def board_get(ctx: Ctx):
    fleet = await views.load_fleet(ctx.conn)
    directive_id, as_of = ctx.query.get("directive_id"), ctx.query.get("as_of")
    if directive_id is not None and directive_id not in fleet.directives:
        raise ApiError("not_found")
    if as_of is None:
        return 200, await views.board(ctx.conn, fleet, directive_id)
    if directive_id is None:
        raise invalid({"as_of": "as_of needs directive_id."})
    revision = int(as_of[1:]) if re.fullmatch(r"R[1-9]\d{0,5}", as_of) else None
    snapshot = revision and await ctx.conn.fetchrow(
        "SELECT * FROM board_snapshots WHERE directive_id = $1 AND revision = $2", directive_id, revision)
    if not snapshot:
        raise ApiError("not_found", f"No snapshot under {as_of}.")
    return 200, {"generated_at": clock.iso(fleet.now), "as_of": as_of, "directives": [snapshot["entry"]],
                 "tails": views.tails_json(fleet), "cells": snapshot["cells"], "totals": snapshot["entry"]["counts"]}


async def tails_list(ctx: Ctx):
    return 200, {"tails": views.tails_json(await views.load_fleet(ctx.conn))}


async def hours_create(ctx: Ctx):
    return 201, await threads.log_hours(ctx.conn, ctx.user, ctx.params["reg"], ctx.body)


async def thread_list(ctx: Ctx):
    fleet = await views.load_fleet(ctx.conn)
    q = ctx.query
    rows = await ctx.conn.fetch(
        "SELECT * FROM threads WHERE ($1::text IS NULL OR directive_id = $1) AND ($2::text IS NULL OR registration = $2)"
        " ORDER BY registration, directive_id", q.get("directive_id"), q.get("registration"))
    found = await views.threads_json(ctx.conn, fleet, rows)
    if q.get("state"):
        found = [t for t in found if t["state"] == q["state"]]
    return 200, {"threads": found}


async def thread_get(ctx: Ctx):
    fleet = await views.load_fleet(ctx.conn)
    if not await ctx.conn.fetchval("SELECT 1 FROM threads WHERE id = $1", ctx.params["id"]):
        raise ApiError("not_found")
    return 200, {"thread": await views.thread_json(ctx.conn, fleet, ctx.params["id"])}


async def claim(ctx: Ctx):
    return await threads.claim(ctx.conn, ctx.user, ctx.params["id"])


async def release(ctx: Ctx):
    return 200, await threads.release(ctx.conn, ctx.user, ctx.params["id"])


async def evidence_create(ctx: Ctx):
    return 201, await threads.attach_evidence(ctx.conn, ctx.user, ctx.params["id"], ctx.raw, ctx.content_type)


async def inspection_create(ctx: Ctx):
    return await threads.sign_inspection(ctx.conn, ctx.user, ctx.params["id"], ctx.body)


async def countersign_create(ctx: Ctx):
    return await threads.countersign(ctx.conn, ctx.user, ctx.params["id"], ctx.body)


async def deferral_create(ctx: Ctx):
    return await threads.defer(ctx.conn, ctx.user, ctx.params["id"], ctx.body)


async def effectivity_create(ctx: Ctx):
    return 200, await threads.effectivity(ctx.conn, ctx.user, ctx.params["id"], ctx.body)


async def reopen_create(ctx: Ctx):
    return 200, await threads.reopen(ctx.conn, ctx.user, ctx.params["id"], ctx.body)


async def people_list(ctx: Ctx):
    rows = await ctx.conn.fetch("SELECT * FROM users ORDER BY seq")
    return 200, {"people": [views.user_of(u) for u in rows]}


async def scope_put(ctx: Ctx):
    return 200, await people.set_scope(ctx.conn, ctx.user, ctx.params["id"], ctx.body)


async def erasure_create(ctx: Ctx):
    return 200, await people.erase(ctx.conn, ctx.user, ctx.params["id"], ctx.body, ctx.after_commit)


async def import_create(ctx: Ctx):
    return await imports.run(ctx.conn, ctx.user, ctx.raw)


async def import_list(ctx: Ctx):
    rows = await ctx.conn.fetch("SELECT result FROM imports ORDER BY seq DESC")
    return 200, {"imports": [r["result"] for r in rows]}


async def pack_create(ctx: Ctx):
    return await packs.request(ctx.conn, ctx.user, ctx.body)


async def pack_list(ctx: Ctx):
    fleet = await views.load_fleet(ctx.conn)
    rows = await ctx.conn.fetch("SELECT * FROM packs ORDER BY seq DESC")
    return 200, {"packs": [packs.pack_json(fleet, p) for p in rows]}


async def pack_get(ctx: Ctx):
    fleet = await views.load_fleet(ctx.conn)
    p = await ctx.conn.fetchrow("SELECT * FROM packs WHERE id = $1", ctx.params["id"])
    if p is None:
        raise ApiError("not_found")
    return 200, {"pack": packs.pack_json(fleet, p)}


async def pack_file(ctx: Ctx):
    data, media, name = await packs.download(ctx.conn, ctx.params["id"], ctx.params["part"])
    return Response(data, media_type=media, headers={"Content-Disposition": f'attachment; filename="{name}"'})


async def notice_list(ctx: Ctx):
    status = ctx.query.get("status")
    rows = await ctx.conn.fetch("SELECT * FROM notices WHERE ($1::text IS NULL OR status = $1) ORDER BY seq DESC",
                                status)
    return 200, {"notices": [notices.notice_json(n) for n in rows]}


async def search_get(ctx: Ctx):
    return 200, {"results": await search.search(ctx.conn, ctx.query.get("q"))}


async def audit_list(ctx: Ctx):
    fleet = await views.load_fleet(ctx.conn)
    rows = await ctx.conn.fetch(
        "SELECT * FROM audit WHERE ($1::text IS NULL OR directive_id = $1) AND ($2::text IS NULL OR thread_id = $2)"
        " ORDER BY at DESC, seq DESC", ctx.query.get("directive_id"), ctx.query.get("thread_id"))
    return 200, {"entries": [{"id": a["id"], "at": clock.iso(a["at"]), "actor": views.person(fleet, a["actor_id"]) or views.SYSTEM_ACTOR,
                              "action": a["action"], "directive_id": a["directive_id"], "thread_id": a["thread_id"],
                              "detail": a["detail"]} for a in rows]}


ID = r"(?P<id>[^/]+)"
ROUTES = [Route(m, re.compile(p), h, **kw) for m, p, h, kw in [
    ("GET", r"/api/health", health, {"public": True}),
    ("POST", r"/api/session", session_create, {"body": "json", "public": True}),
    ("GET", r"/api/session", session_get, {}),
    ("DELETE", r"/api/session", session_delete, {}),
    ("GET", r"/api/events", None, {}),
    ("POST", r"/api/documents", document_upload, {"body": "pdf"}),
    ("GET", r"/api/directives", directive_list, {}),
    ("POST", r"/api/directives", directive_create, {"body": "json"}),
    ("GET", rf"/api/directives/{ID}", directive_get, {}),
    ("POST", rf"/api/directives/{ID}/revisions", revision_create, {"body": "json"}),
    ("POST", rf"/api/directives/{ID}/withdrawal", withdrawal_create, {"body": "json"}),
    ("GET", rf"/api/directives/{ID}/export\.csv", directive_export, {}),
    ("GET", r"/api/board", board_get, {}),
    ("GET", r"/api/tails", tails_list, {}),
    ("POST", r"/api/tails/(?P<reg>[^/]+)/flight-hours", hours_create, {"body": "json"}),
    ("GET", r"/api/threads", thread_list, {}),
    ("GET", rf"/api/threads/{ID}", thread_get, {}),
    ("POST", rf"/api/threads/{ID}/claim", claim, {"body": "json", "keyed": True}),
    ("POST", rf"/api/threads/{ID}/release", release, {"body": "json"}),
    ("POST", rf"/api/threads/{ID}/evidence", evidence_create, {"body": "evidence"}),
    ("POST", rf"/api/threads/{ID}/inspection", inspection_create, {"body": "json", "keyed": True}),
    ("POST", rf"/api/threads/{ID}/countersign", countersign_create, {"body": "json", "keyed": True}),
    ("POST", rf"/api/threads/{ID}/deferral", deferral_create, {"body": "json", "keyed": True}),
    ("POST", rf"/api/threads/{ID}/effectivity", effectivity_create, {"body": "json"}),
    ("POST", rf"/api/threads/{ID}/reopen", reopen_create, {"body": "json"}),
    ("GET", r"/api/people", people_list, {}),
    ("PUT", rf"/api/engineers/{ID}/scope", scope_put, {"body": "json"}),
    ("POST", rf"/api/people/{ID}/erasure", erasure_create, {"body": "json"}),
    ("POST", r"/api/imports", import_create, {"body": "csv", "keyed": True}),
    ("GET", r"/api/imports", import_list, {}),
    ("POST", r"/api/packs", pack_create, {"body": "json", "keyed": True}),
    ("GET", r"/api/packs", pack_list, {}),
    ("GET", rf"/api/packs/{ID}", pack_get, {}),
    ("GET", rf"/api/packs/{ID}/(?P<part>pdf|csv)", pack_file, {}),
    ("GET", r"/api/notices", notice_list, {}),
    ("GET", r"/api/search", search_get, {}),
    ("GET", r"/api/audit", audit_list, {}),
]]


# Pipeline ---------------------------------------------------------------------------------------------------------

def _route(method: str, path: str) -> tuple[Route, dict]:
    matches = [(r, m) for r in ROUTES if (m := r.pattern.fullmatch(path))]
    if not matches:
        if path.startswith("/api/audit/") and method in ("PUT", "PATCH", "DELETE"):
            raise ApiError("method_not_allowed")
        raise ApiError("not_found")
    for r, m in matches:
        if r.method == method:
            return r, m.groupdict()
    raise ApiError("method_not_allowed")


async def _read_body(request: Request, limit: int) -> bytes:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise ApiError("payload_too_large")
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise ApiError("payload_too_large")
        chunks.append(chunk)
    return b"".join(chunks)


def _check_media(route: Route, content_type: str, raw: bytes) -> None:
    if route.body == "none" or (route.body == "json" and not raw):
        return
    if content_type not in MEDIA[route.body]:
        raise ApiError("unsupported_media_type")


def _check_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if origin is None or request.method in ("GET", "HEAD"):
        return
    own = {f"{request.url.scheme}://{request.headers.get('host', '')}", urlsplit(settings.public_url)._replace(
        path="", query="", fragment="").geturl()}
    if origin not in own:
        raise ApiError("forbidden", "Requests from another origin are refused.")


def _not_finite(name: str):
    raise ValueError(f"{name} is not a JSON number")


def _fingerprint(method: str, path: str, route: Route, body: dict, raw: bytes) -> str:
    payload = json.dumps(body, sort_keys=True, separators=(",", ":")) if route.body == "json" else raw.hex()
    return hashlib.sha256(f"{method}\n{path}\n{payload}".encode()).hexdigest()


async def _replayed(conn, user_id: str, method: str, path: str, key: str, fingerprint: str) -> Response | None:
    await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", f"{user_id}|{method}|{path}|{key}")
    await conn.execute("DELETE FROM idempotency WHERE user_id = $1 AND method = $2 AND path = $3 AND key = $4 "
                       "AND created_at <= $5", user_id, method, path, key, clock.now() - timedelta(hours=24))
    stored = await conn.fetchrow("SELECT * FROM idempotency WHERE user_id = $1 AND method = $2 AND path = $3 "
                                 "AND key = $4", user_id, method, path, key)
    if stored is None:
        return None
    if stored["fingerprint"] != fingerprint:
        raise ApiError("idempotency_mismatch")
    return json_response(stored["status"], stored["body"], {"Idempotent-Replayed": "true"})


async def _stream(request: Request) -> Response:
    token = request.cookies.get(COOKIE)

    async def still_signed_in() -> bool:
        async with db.pool.acquire() as conn:
            return await people.session_user(conn, token) is not None
    return StreamingResponse(events.stream(still_signed_in), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


async def dispatch(request: Request) -> Response:
    method, path = request.method, request.url.path
    route, params = _route(method, path)
    raw = await _read_body(request, LIMITS[route.body])
    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    _check_media(route, content_type, raw)
    _check_origin(request)

    async with db.pool.acquire() as conn:
        user = None if route.public else await people.session_user(conn, request.cookies.get(COOKIE))
    if not route.public and user is None:
        raise ApiError("unauthenticated")
    if route.handler is None:
        return await _stream(request)
    key = request.headers.get("idempotency-key") if route.keyed else None
    if route.keyed and key is None:
        raise ApiError("idempotency_key_required")
    if key is not None and not KEY_PATTERN.fullmatch(key):
        raise ApiError("idempotency_key_invalid")
    if any("\x00" in value for value in params.values()):  # names no stored row, and Postgres refuses it as a parameter
        raise ApiError("not_found")
    body = {}
    if route.body == "json" and raw:
        try:
            body = json.loads(raw, parse_constant=_not_finite)
        except (UnicodeDecodeError, ValueError):
            body = None

    ctx = Ctx(request, params, user, body if isinstance(body, dict) else {}, raw, content_type)
    async with db.pool.acquire() as conn:
        async with conn.transaction():
            ctx.conn = conn
            fingerprint = _fingerprint(method, path, route, body, raw)
            if key is not None and (replay := await _replayed(conn, user["id"], method, path, key, fingerprint)):
                return replay
            try:
                async with conn.transaction():
                    if route.body == "json" and not isinstance(body, dict):
                        raise invalid({"body": "Send a JSON object."})
                    result = await route.handler(ctx)
            except ApiError as error:
                if key is None:
                    raise
                # A keyed refusal is the original response too (brief: API, Idempotency): its work is rolled
                # back to the savepoint, and the refusal itself is stored for replay.
                ctx.after_commit.clear()
                result = (error.status, error.body())
            if isinstance(result, Response):
                return result
            status, payload = result
            if key is not None:
                await conn.execute(
                    "INSERT INTO idempotency (user_id, method, path, key, fingerprint, status, body, created_at) "
                    "VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
                    user["id"], method, path, key, fingerprint, status, payload, clock.now())
        for step in ctx.after_commit:
            await step(conn)
    return json_response(status, payload)


async def api(request: Request) -> Response:
    try:
        response = await dispatch(request)
    except ApiError as error:
        response = error_response(error)
    except Exception:
        log.exception("unhandled error on %s %s", request.method, request.url.path)
        response = json_response(500, {"error": {"code": "internal", "message": "Something went wrong."}})
    response.headers.update(SECURITY_HEADERS)
    return response


async def asset(request: Request) -> Response:
    target = (STATIC / "assets" / request.path_params["path"]).resolve()
    if not target.is_file() or not target.is_relative_to(STATIC / "assets"):
        return PlainTextResponse("Not found", status_code=404)
    return FileResponse(target, headers={"Cache-Control": "no-cache", **SECURITY_HEADERS})


async def shell(_request: Request) -> Response:
    return FileResponse(SHELL, media_type="text/html; charset=utf-8",
                        headers={"Cache-Control": "no-cache", **SECURITY_HEADERS})


# Lifecycle --------------------------------------------------------------------------------------------------------

async def _every(seconds: float, step: Callable[[], Awaitable[None]], name: str) -> None:
    while True:
        try:
            await step()
        except Exception:
            log.exception("%s pass failed", name)
        await asyncio.sleep(seconds)


async def _ensure_bucket() -> None:
    while True:
        try:
            await storage.ensure_bucket()
            return
        except storage.StorageUnavailable:
            await asyncio.sleep(10)


@contextlib.asynccontextmanager
async def lifespan(_app):
    await db.connect()
    await db.migrate(seed.apply)
    tasks = [asyncio.create_task(c) for c in (
        events.listen_forever(), _ensure_bucket(), _every(0.5, notices.send_due, "notices"),
        _every(0.5, packs.retry_due, "packs"))]
    yield
    for task in tasks:
        task.cancel()
    await db.pool.close()


app = Starlette(
    routes=[StarletteRoute("/api/{path:path}", api, methods=API_METHODS),
            StarletteRoute("/api", api, methods=API_METHODS),
            StarletteRoute("/assets/{path:path}", asset, methods=["GET", "HEAD"]),
            StarletteRoute("/{path:path}", shell, methods=["GET", "HEAD"])],
    lifespan=lifespan,
)

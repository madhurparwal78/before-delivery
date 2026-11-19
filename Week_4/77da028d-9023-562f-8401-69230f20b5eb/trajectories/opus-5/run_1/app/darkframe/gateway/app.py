"""The public gateway: authentication, the boundary, the proxy and health."""

from __future__ import annotations

import asyncio
import json
from urllib.parse import urlsplit

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from .. import objectstore
from ..config import CONFIG, LEDGER, PUSH_DISPATCHER, SKY_ENGINE, VERSION
from ..errors import ApiError, service_unavailable, unauthenticated
from ..httpclient import HttpError, request as http_request
from ..seed import SEED_IMAGERS, SEED_MARKER
from ..service import IMAGER_HEADER, call_service
from ..validate import Fields
from ..webkit import (
    MASTER_CONTENT_TYPES,
    RequestIdMiddleware,
    UPLOAD_CONTENT_TYPES,
    api_error_handler,
    json_response,
    read_json_body,
    read_upload_body,
    request_id_of,
    unhandled_handler,
)
from . import static, workspaces

HEALTH_TIMEOUT = 1.0
MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

ROUTE_SERVICES: tuple[tuple[str, str], ...] = (
    ("/api/site", SKY_ENGINE),
    ("/api/sky/", SKY_ENGINE),
    ("/api/tonight", SKY_ENGINE),
    ("/api/plans/", SKY_ENGINE),
    ("/api/reminders/", SKY_ENGINE),
    ("/api/projects", LEDGER),
    ("/api/sessions", LEDGER),
    ("/api/batches/", LEDGER),
    ("/api/frames/", LEDGER),
    ("/api/calibration-sets", LEDGER),
    ("/api/shared/", LEDGER),
    ("/api/pushes", PUSH_DISPATCHER),
)


def _service_for(path: str) -> str | None:
    for prefix, service in ROUTE_SERVICES:
        if path == prefix.rstrip("/") or path.startswith(prefix):
            return service
    return None


def _cross_origin(request: Request) -> bool:
    origin = request.headers.get("origin")
    if not origin or request.method not in MUTATING_METHODS:
        return False
    host = request.headers.get("host", "")
    return urlsplit(origin).netloc != host


def _cross_origin_error() -> ApiError:
    return ApiError(
        403, "cross_origin", "Requests must come from Darkframe itself."
    )


def _key_of(request: Request) -> str:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return request.cookies.get(workspaces.COOKIE_NAME, "")


async def _imager_id(request: Request) -> str:
    key = _key_of(request)
    if not key:
        raise unauthenticated()
    row = await workspaces.imager_for_key(key)
    if row is None:
        raise unauthenticated()
    return row["id"]


def _is_upload(method: str, path: str) -> bool:
    return method == "PUT" and (
        "/frames/" in path or path.endswith("/master")
    )


async def _read_body(request: Request) -> tuple[bytes, str]:
    path = request.url.path
    if _is_upload(request.method, path):
        allowed = (
            UPLOAD_CONTENT_TYPES if "/frames/" in path else MASTER_CONTENT_TYPES
        )
        payload = await read_upload_body(request, allowed)
        return (payload, request.headers.get("content-type", ""))
    body = await read_json_body(request)
    if not body:
        return (b"", "application/json")
    return (json.dumps(body).encode(), "application/json")


# --- workspace routes -------------------------------------------------------


async def create_workspace(request: Request) -> Response:
    body = await read_json_body(request)
    if _cross_origin(request):
        raise _cross_origin_error()
    fields = Fields(body)
    name = fields.text("name", 1, 80)
    site = body.get("site")
    if not isinstance(site, dict):
        fields.fail("site", "Describe the observing site.")
    fields.done()
    imager_id, key = await workspaces.create_workspace(name)
    reply = await call_service(
        CONFIG.base_url(SKY_ENGINE),
        "POST",
        "/internal/sites",
        body=json.dumps({"imager_id": imager_id, "site": site}).encode(),
        request_id=request_id_of(request),
    )
    if reply.status >= 400:
        await workspaces.DATABASE.execute(
            "delete from gateway.imagers where id = $1", imager_id
        )
        return Response(
            reply.body,
            status_code=reply.status,
            media_type="application/json",
        )
    return json_response({"imager_id": imager_id, "name": name, "key": key}, 201)


async def unlock(request: Request) -> Response:
    body = await read_json_body(request)
    if _cross_origin(request):
        raise _cross_origin_error()
    key = body.get("key")
    row = await workspaces.imager_for_key(key) if isinstance(key, str) else None
    if row is None:
        raise ApiError(401, "invalid_key", "That workspace key is not recognised.")
    response = Response(status_code=204)
    response.set_cookie(
        workspaces.COOKIE_NAME,
        key,
        httponly=True,
        samesite="strict",
        path="/",
        max_age=60 * 60 * 24 * 365,
    )
    return response


async def lock_workspace(request: Request) -> Response:
    if _cross_origin(request):
        raise _cross_origin_error()
    response = Response(status_code=204)
    response.delete_cookie(workspaces.COOKIE_NAME, path="/")
    return response


async def read_me(request: Request) -> Response:
    key = _key_of(request)
    row = await workspaces.imager_for_key(key) if key else None
    if row is None:
        raise unauthenticated()
    return json_response({"imager_id": row["id"], "name": row["name"]})


# --- health -----------------------------------------------------------------


async def _service_health(service: str) -> dict[str, object]:
    try:
        reply = await http_request(
            "GET",
            f"{CONFIG.base_url(service)}/internal/health",
            timeout=HEALTH_TIMEOUT,
        )
        if reply.status == 200:
            return {"status": "ok", "version": json.loads(reply.body)["version"]}
    except HttpError:
        pass
    return {"status": "down", "version": None}


async def _ntfy_health() -> bool:
    try:
        reply = await http_request(
            "GET", f"{CONFIG.ntfy_url.rstrip('/')}/v1/health", timeout=HEALTH_TIMEOUT
        )
        return reply.status < 500
    except HttpError:
        return False


async def read_health(request: Request) -> Response:
    sky, ledger, dispatcher, postgres, minio, ntfy = await asyncio.gather(
        _service_health(SKY_ENGINE),
        _service_health(LEDGER),
        _service_health(PUSH_DISPATCHER),
        workspaces.DATABASE.healthy(),
        objectstore.healthy(),
        _ntfy_health(),
    )
    detail = {
        "version": VERSION,
        "services": {
            "gateway": {"status": "ok", "version": VERSION},
            "sky-engine": sky,
            "ledger": ledger,
            "push-dispatcher": dispatcher,
        },
        "dependencies": {
            "postgres": "ok" if postgres else "down",
            "minio": "ok" if minio else "down",
            "ntfy": "ok" if ntfy else "down",
        },
    }
    healthy = (
        sky["status"] == "ok" and ledger["status"] == "ok" and postgres
    )
    if healthy:
        return json_response({"status": "ok", **detail})
    return json_response({"status": "unavailable", **detail}, 503)


# --- the proxy --------------------------------------------------------------


async def proxy(request: Request) -> Response:
    path = request.url.path
    service = _service_for(path)
    if service is None:
        raise ApiError(404, "not_found", "That record does not exist.")
    shared = path.startswith("/api/shared/")
    if shared and request.method != "GET":
        return json_response(
            {
                "error": {
                    "code": "read_only",
                    "message": "Shared project links are read-only.",
                }
            },
            405,
        )
    payload, content_type = await _read_body(request)
    if _cross_origin(request):
        raise _cross_origin_error()
    imager_id = "" if shared else await _imager_id(request)

    target = "/internal" + path[len("/api"):]
    if request.url.query:
        target = f"{target}?{request.url.query}"
    headers = {}
    key = request.headers.get("idempotency-key")
    if key:
        headers["Idempotency-Key"] = key
    try:
        reply = await http_request(
            request.method,
            f"{CONFIG.base_url(service)}{target}",
            headers={
                **headers,
                **({IMAGER_HEADER: imager_id} if imager_id else {}),
                "X-Request-Id": request_id_of(request),
                **({"Content-Type": content_type} if payload else {}),
            },
            body=payload,
            timeout=5.0,
        )
    except HttpError:
        raise service_unavailable(service)
    if (
        service == LEDGER
        and request.method in MUTATING_METHODS
        and reply.status < 300
        and imager_id
    ):
        await _ask_for_reevaluation(imager_id, request_id_of(request))
    return Response(
        reply.body,
        status_code=reply.status,
        media_type=reply.headers.get("content-type", "application/json"),
    )


async def _ask_for_reevaluation(imager_id: str, request_id: str) -> None:
    try:
        await call_service(
            CONFIG.base_url(SKY_ENGINE),
            "POST",
            "/internal/reevaluate",
            body=json.dumps({"imager_id": imager_id}).encode(),
            request_id=request_id,
            timeout=2.0,
        )
    except HttpError:
        pass


# --- seeding ----------------------------------------------------------------


async def seed_workspaces() -> None:
    payload = json.dumps({"imagers": SEED_IMAGERS}).encode()
    for service in (SKY_ENGINE, LEDGER):
        reply = await call_service(
            CONFIG.base_url(service),
            "POST",
            "/internal/seed",
            body=payload,
            timeout=60.0,
        )
        if reply.status >= 300:
            raise HttpError(f"seeding {service} answered {reply.status}")
    if await workspaces.claim_seed(SEED_MARKER):
        for imager in SEED_IMAGERS:
            await workspaces.insert_seed_imager(
                imager["imager_id"], imager["name"], imager["key"]
            )


async def _seed_when_ready() -> None:
    while True:
        try:
            await seed_workspaces()
            return
        except (HttpError, OSError, ApiError):
            await asyncio.sleep(2.0)


async def _start_seeding() -> None:
    asyncio.create_task(_seed_when_ready())


async def gateway_not_found(request: Request, exc: Exception) -> Response:
    if request.url.path.startswith("/api/"):
        return json_response(
            {"error": {"code": "not_found", "message": "That record does not exist."}},
            404,
        )
    return Response("Not found", status_code=404, media_type="text/plain")


ROUTES = [
    Route("/api/workspaces", create_workspace, methods=["POST"]),
    Route("/api/unlock", unlock, methods=["POST"]),
    Route("/api/lock-workspace", lock_workspace, methods=["POST"]),
    Route("/api/me", read_me, methods=["GET"]),
    Route("/api/health", read_health, methods=["GET"]),
    Route(
        "/api/{rest:path}",
        proxy,
        methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    ),
    Route("/{rest:path}", static.serve, methods=["GET", "HEAD"]),
]

app = Starlette(
    routes=ROUTES,
    middleware=[Middleware(RequestIdMiddleware)],
    exception_handlers={
        ApiError: api_error_handler,
        404: gateway_not_found,
        Exception: unhandled_handler,
    },
    on_startup=[_start_seeding],
)

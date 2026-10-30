"""The API surface: the route table and the one request dispatcher."""
import json

from .. import auth, db, httpbase, idempotency
from ..domain import keys
from ..errors import TesselError, validation_error
from . import admin, data, public
from .registry import Context, Table

TABLE = Table()
for route in public.routes() + data.routes() + admin.routes():
    TABLE.add(route)


def _check_version(request):
    header = request.header("API-Version")
    if header is None:
        raise TesselError("API_VERSION_REQUIRED")
    if header != "2":
        raise TesselError("UNSUPPORTED_API_VERSION")


def _parse_body(request):
    raw = request.raw_body()
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise TesselError("MALFORMED_JSON")
    if not isinstance(parsed, dict):
        raise validation_error(None, "The request body must be a JSON object")
    return parsed


def _as_response(request, result):
    if isinstance(result, httpbase.Response):
        return result
    return httpbase.api_success(request, result[1], result[0])


def _run(request, extra):
    """Apply the one error-precedence order, then call the handler."""
    _, entry, params = TABLE.match(request.path)
    if entry is None:
        raise TesselError("ROUTE_NOT_FOUND")
    route = entry["methods"].get(request.method)
    if route is None:
        return httpbase.method_not_allowed(request, entry["methods"].keys())
    if route.versioned:
        _check_version(request)
    ctx = Context(request, route, params)
    if route.needs_credential:
        ctx.actor = auth.resolve_credential(request)
        auth.require_role(ctx.actor, route.role, route.session_only)
    if route.rate_limited and ctx.actor is not None and ctx.actor.is_key:
        with db.tx() as cur:
            extra.update(
                keys.query_allowance(
                    cur, ctx.actor.key["id"], ctx.actor.organization["plan"]
                )
            )
    try:
        request.raw_body()
    except httpbase.BodyTooLarge:
        raise TesselError("PAYLOAD_TOO_LARGE")
    if route.reads_body:
        ctx.body = _parse_body(request)

    key = idempotency.read_header(request) if route.idempotent else None
    if key is None:
        response = _as_response(request, route.handler(ctx))
        extra.update(ctx.headers)
        return response

    organization_id = ctx.actor.organization_id
    digest = idempotency.digest_of(ctx.body)
    stored = idempotency.claim(organization_id, route.path, key, digest)
    if stored is not None:
        status, payload = stored
        response = httpbase.api_success(request, payload, status)
        response.add("Idempotent-Replayed", "true")
        return response
    try:
        result = route.handler(ctx)
    except BaseException:
        idempotency.abandon(organization_id, route.path, key)
        raise
    idempotency.finish(
        organization_id,
        route.path,
        key,
        result[0],
        result[1],
        ctx.idempotency_database_id,
    )
    extra.update(ctx.headers)
    return _as_response(request, result)


def dispatch(request):
    extra = {}
    try:
        response = _run(request, extra)
    except TesselError as refusal:
        response = httpbase.api_refusal(request, refusal)
    sent = {name for name, _ in response.headers}
    for name, value in extra.items():
        if name not in sent:
            response.add(name, value)
    response.add("Cache-Control", "no-store")
    return response

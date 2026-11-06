"""Request context and the single error-precedence pipeline of the whole API."""
import hashlib
import json
import time

from . import routing
from .envelope import error_response
from .textutil import ApiError

MAX_BODY = 2097152
ROLE_RANK = {"viewer": 0, "editor": 1, "owner": 2}


class Ctx:
    def __init__(self, request, app, params, spec):
        self.request = request
        self.app = app
        self.db = app["db"]["pool"]
        self.params = params
        self.spec = spec
        self.started = time.monotonic()
        self.actor = None
        self.body = None
        self.query = request.query
        self.rate_headers = None

    def json(self, status=200, data=None, headers=None, idem_replayed=False):
        from .envelope import json_api_response
        hdrs = dict(headers or {})
        if self.rate_headers:
            hdrs.update(self.rate_headers)
        if idem_replayed:
            hdrs["Idempotent-Replayed"] = "true"
        return json_api_response(status=status, data=data, error=None, headers=hdrs,
                                 started=self.started)


def fail(status, code, message, field=None, headers=None):
    raise ApiError(status, code, message, field, headers)


def require_role(ctx, spec):
    actor = ctx.actor
    need = spec["role"]
    if need is None:
        # member-session-only route
        if actor["key_id"] is not None:
            fail(403, "FORBIDDEN_ROLE", "Your role cannot do this")
        return actor
    if actor["key_id"] is not None:
        if need == "owner" or ROLE_RANK[actor["role"]] < ROLE_RANK[need]:
            fail(403, "FORBIDDEN_ROLE", "Your role cannot do this")
    elif ROLE_RANK[actor["role"]] < ROLE_RANK[need]:
        fail(403, "FORBIDDEN_ROLE", "Your role cannot do this")
    return actor


async def authenticate(request, ctx):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        fail(401, "UNAUTHENTICATED", "Sign in or send an API key")
    secret = auth[7:].strip()
    if not secret:
        fail(401, "UNAUTHENTICATED", "Sign in or send an API key")
    db = ctx.db
    digest = hashlib.sha256(("t1:" + secret).encode("utf-8")).hexdigest()
    row = await db.fetchrow(
        "SELECT s.id AS session_id, s.revoked_at, m.email, m.role, m.organization_id, m.id AS member_id "
        "FROM app.sessions s JOIN app.members m ON m.id = s.member_id "
        "WHERE s.token_digest = $1", digest)
    if row is not None:
        if row["revoked_at"] is None:
            return {"member_id": row["member_id"], "organization_id": row["organization_id"],
                    "email": row["email"], "role": row["role"], "key_id": None,
                    "key_scope": None, "session_id": row["session_id"]}
        fail(401, "INVALID_API_KEY", "This credential is not valid")
    key = await db.fetchrow(
        "SELECT id, organization_id, role, revoked_at FROM app.api_keys WHERE secret_digest = $1",
        digest)
    if key is not None:
        if key["revoked_at"] is None:
            scope = await db.fetch(
                "SELECT d.name FROM app.key_databases kd "
                "JOIN app.databases d ON d.id = kd.database_id "
                "WHERE kd.api_key_id = $1 ORDER BY d.name", key["id"])
            await db.execute("UPDATE app.api_keys SET last_used_at = now() WHERE id = $1", key["id"])
            return {"member_id": None, "organization_id": key["organization_id"],
                    "email": None, "role": key["role"], "key_id": key["id"],
                    "key_scope": [r["name"] for r in scope], "session_id": None}
        fail(401, "INVALID_API_KEY", "This credential is not valid")
    fail(401, "INVALID_API_KEY", "This credential is not valid")


async def key_query_limit(ctx):
    """The per-key rolling 60-second query limit of the plan in force."""
    from .textutil import plan_query_limit
    actor = ctx.actor
    db = ctx.db
    plan = await db.fetchval("SELECT plan FROM app.organizations WHERE id = $1",
                             actor["organization_id"])
    limit = plan_query_limit(plan)
    now_ts = await db.fetchval("SELECT now()")
    row = await db.fetchrow(
        "SELECT window_start, count FROM app.query_usage WHERE api_key_id = $1",
        actor["key_id"])
    if row is None:
        await db.execute(
            "INSERT INTO app.query_usage (api_key_id, window_start, count) VALUES ($1, $2, 1) "
            "ON CONFLICT (api_key_id) DO NOTHING", actor["key_id"], now_ts)
        row = await db.fetchrow(
            "SELECT window_start, count FROM app.query_usage WHERE api_key_id = $1",
            actor["key_id"])
    elapsed = (now_ts - row["window_start"]).total_seconds()
    if elapsed >= 60:
        await db.execute(
            "UPDATE app.query_usage SET window_start = $2, count = 1 WHERE api_key_id = $1",
            actor["key_id"], now_ts)
        count_after = 1
    else:
        if row["count"] >= limit:
            ctx.rate_headers = {"RateLimit-Limit": str(limit), "RateLimit-Remaining": "0"}
            retry = max(1, min(60, int(60 - elapsed) + 1))
            fail(429, "RATE_LIMITED", "Too many requests. Try again in %d seconds." % retry,
                 headers={"Retry-After": str(retry)})
        await db.execute(
            "UPDATE app.query_usage SET count = count + 1 WHERE api_key_id = $1",
            actor["key_id"])
        count_after = row["count"] + 1
    ctx.rate_headers = {"RateLimit-Limit": str(limit),
                        "RateLimit-Remaining": str(max(0, limit - count_after))}


async def read_raw_body(request):
    data = await request.read()
    if len(data) > MAX_BODY:
        fail(413, "PAYLOAD_TOO_LARGE", "The request body is over 2 MB")
    return data


async def parse_body(ctx):
    raw = await read_raw_body(ctx.request)
    if not raw.strip():
        fail(400, "MALFORMED_JSON", "The request body is not valid JSON")
    try:
        body = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        fail(400, "MALFORMED_JSON", "The request body is not valid JSON")
    if not isinstance(body, dict):
        fail(400, "VALIDATION_ERROR", "Invalid value", None)
    return body


async def dispatch(request):
    app = request.app
    spec, params, err = routing.match(request.method, request.path)
    if err is not None:
        return error_response(err, request, time.monotonic())
    ctx = Ctx(request, app, params, spec)
    try:
        if spec["versioned"]:
            v = request.headers.get("API-Version")
            if v is None:
                fail(400, "API_VERSION_REQUIRED", "Send the header API-Version: 2")
            if v != "2":
                fail(400, "UNSUPPORTED_API_VERSION", "Only API-Version 2 is supported")
        if spec["role"] == "public":
            ctx.actor = None
        else:
            ctx.actor = await authenticate(request, ctx)
            require_role(ctx, spec)
        if spec.get("query_limited") and ctx.actor["key_id"] is not None:
            await key_query_limit(ctx)
        if spec["takes_body"]:
            ctx.body = await parse_body(ctx)
        return await spec["handler"](ctx)
    except ApiError as e:
        resp = error_response(e, request, ctx.started)
        if ctx.rate_headers and e.code != "RATE_LIMITED":
            resp.headers.update(ctx.rate_headers)
        return resp
    except Exception:
        import traceback
        traceback.print_exc()
        return error_response(ApiError(500, "INTERNAL", "Something went wrong"),
                              request, ctx.started)

"""The /api surface: route table, the one error-precedence dispatcher, the envelope, credentials,
idempotent retries and the per-key query limit."""
import hashlib
import json
import logging
import math
import re
import time
import uuid
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Callable

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import Response

from . import db, security, text
from .refusals import ApiError, invalid

log = logging.getLogger("tessel.api")

MAX_BODY = 2_097_152
ROLE_RANK = {"viewer": 1, "editor": 2, "owner": 3}
KEY_QUERY_LIMIT = {"ship": 20, "scale": 200}
IDEMPOTENCY_KEY = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


@dataclass
class Principal:
    kind: str                       # "member" (a session) or "key"
    org_id: int
    org_name: str
    plan: str
    role: str
    email: str | None = None
    member_id: int | None = None
    session_id: int | None = None
    key_id: int | None = None
    scope: frozenset | None = None  # database ids a scoped key reaches; None reaches every database


@dataclass
class Answer:
    data: object
    status: int = 200
    headers: dict = field(default_factory=dict)


@dataclass
class Ctx:
    request_id: str
    headers: object
    query: dict
    path: dict
    body: dict | None = None
    principal: Principal | None = None
    tx: db.Tx | None = None
    out_headers: dict = field(default_factory=dict)
    after: list = field(default_factory=list)
    idempotency_database_id: int | None = None

    def header(self, name: str) -> str | None:
        return self.headers.get(name)


@dataclass
class Route:
    method: str
    template: str
    handler: Callable
    who: str                 # anyone | session | viewer | editor | owner
    body: bool
    idempotent: bool
    key_limited: bool
    pattern: re.Pattern


ROUTES: list[Route] = []


def route(method: str, template: str, who: str, body: bool = False, idempotent: bool = False,
          key_limited: bool = False):
    pattern = re.compile("^" + re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", template) + "$")

    def register(fn):
        ROUTES.append(Route(method, template, fn, who, body, idempotent, key_limited, pattern))
        return fn
    return register


# ---- envelope -----------------------------------------------------------------------------------

def _headers_for(path: str, extra: dict) -> dict:
    out = {"Content-Type": "application/json; charset=utf-8"}
    if path.startswith(("/api/v2", "/api/auth")):
        out["Cache-Control"] = "no-store"
    out.update(extra)
    return out


def _envelope(request_id: str, started: float, data=None, error: ApiError | None = None) -> bytes:
    payload = {"success": error is None, "data": data,
               "error": None if error is None else {"code": error.code, "message": error.message, "field": error.field},
               "meta": {"request_id": request_id, "latency_ms": int((time.monotonic() - started) * 1000)}}
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()


def refusal_response(path: str, request_id: str, started: float, err: ApiError, extra: dict | None = None,
                     bodyless: bool = False) -> Response:
    headers = _headers_for(path, {**(extra or {}), **err.headers})
    content = b"" if bodyless else _envelope(request_id, started, error=err)
    return Response(content, status_code=err.status, headers=headers)


# ---- credentials --------------------------------------------------------------------------------

def principal_for(token: str) -> Principal | None:
    """The live session or API key a bearer value names; a key's use is recorded as it authenticates."""
    digest = security.digest(token)
    with db.tx() as t:
        if token.startswith("tsl_"):
            row = t.one("UPDATE api_keys k SET last_used_at = clock_timestamp() FROM organizations o "
                        "WHERE k.secret_digest = :d AND k.revoked_at IS NULL AND o.id = k.organization_id "
                        "RETURNING k.id, k.role, k.scoped, o.id AS org_id, o.name AS org_name, o.plan", d=digest)
            if not row:
                return None
            scope = None
            if row["scoped"]:
                scope = frozenset(r["database_id"] for r in t.rows(
                    "SELECT database_id FROM api_key_databases WHERE key_id = :k", k=row["id"]))
            return Principal("key", row["org_id"], row["org_name"], row["plan"], row["role"], key_id=row["id"],
                             scope=scope)
        row = t.one("SELECT s.id AS sid, m.id AS mid, m.email, m.role, o.id AS org_id, o.name AS org_name, o.plan "
                    "FROM sessions s JOIN members m ON m.id = s.member_id JOIN organizations o "
                    "ON o.id = m.organization_id WHERE s.token_digest = :d AND s.revoked_at IS NULL", d=digest)
    if not row:
        return None
    return Principal("member", row["org_id"], row["org_name"], row["plan"], row["role"], email=row["email"],
                     member_id=row["mid"], session_id=row["sid"])


def _authenticate(ctx: Ctx) -> Principal:
    raw = ctx.header("authorization")
    if raw is None:
        raise ApiError("UNAUTHENTICATED")
    scheme, _, token = raw.strip().partition(" ")
    principal = principal_for(token.strip()) if scheme.lower() == "bearer" and token.strip() else None
    if principal is None:
        raise ApiError("INVALID_API_KEY")
    return principal


def _authorize(who: str, p: Principal) -> None:
    if who in ("session", "owner") and p.kind != "member":
        raise ApiError("FORBIDDEN_ROLE")
    if who in ROLE_RANK and ROLE_RANK[p.role] < ROLE_RANK[who]:
        raise ApiError("FORBIDDEN_ROLE")


def _key_query_limit(ctx: Ctx) -> None:
    """Per-key rolling 60-second query allowance by the plan in force; a 429 is not counted."""
    p = ctx.principal
    with db.tx() as t:
        t.run("SELECT pg_advisory_xact_lock(1, :k::int)", k=p.key_id)
        plan = t.one("SELECT plan FROM organizations WHERE id = :o", o=p.org_id)["plan"]
        limit = KEY_QUERY_LIMIT[plan]
        recent = t.rows("SELECT at FROM key_queries WHERE key_id = :k AND at > clock_timestamp() - interval '60 seconds' "
                        "ORDER BY at", k=p.key_id)
        if len(recent) >= limit:
            wait = (recent[len(recent) - limit]["at"] + timedelta(seconds=60) - text.now()).total_seconds()
            n = max(1, min(60, math.ceil(wait)))
            ctx.out_headers.update({"RateLimit-Limit": str(limit), "RateLimit-Remaining": "0"})
            raise ApiError("RATE_LIMITED", headers={"Retry-After": str(n)}, n=n)
        t.run("INSERT INTO key_queries (key_id) VALUES (:k)", k=p.key_id)
    ctx.out_headers.update({"RateLimit-Limit": str(limit), "RateLimit-Remaining": str(max(0, limit - len(recent) - 1))})


def _parse_body(raw: bytes) -> dict:
    def no_constants(name):
        raise ValueError(name)
    try:
        value = json.loads(raw.decode("utf-8"), parse_constant=no_constants)
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise ApiError("MALFORMED_JSON") from None
    if not isinstance(value, dict):
        raise invalid(None, "Send a JSON object")
    return value


# ---- idempotent retries -------------------------------------------------------------------------

def _idempotent(r: Route, ctx: Ctx, key: str) -> Answer:
    """Replay the first recorded answer for (organization, route, key); decided under an advisory lock."""
    if not IDEMPOTENCY_KEY.match(key):
        raise invalid("Idempotency-Key", "Use 1 to 64 letters, digits, _ or -")
    digest = hashlib.sha256(json.dumps(ctx.body, sort_keys=True, separators=(",", ":"),
                                       ensure_ascii=False).encode()).hexdigest()
    org = ctx.principal.org_id
    with db.tx() as t:
        t.run("SET LOCAL lock_timeout = '10s'")
        try:
            t.run("SELECT pg_advisory_xact_lock(5, hashtext(:k))", k=f"{org}:{r.template}:{key}")
        except Exception as exc:
            if db.error_code(exc) == "55P03":
                raise ApiError("IDEMPOTENCY_IN_PROGRESS") from None
            raise
        t.run("DELETE FROM idempotency_records WHERE organization_id = :o AND route = :r AND key = :k AND "
              "created_at < clock_timestamp() - interval '24 hours'", o=org, r=r.template, k=key)
        stored = t.one("SELECT request_digest, status, data FROM idempotency_records WHERE organization_id = :o AND "
                       "route = :r AND key = :k", o=org, r=r.template, k=key)
        if stored:
            if stored["request_digest"] != digest:
                raise ApiError("IDEMPOTENCY_KEY_REUSED")
            return Answer(json.loads(stored["data"]), stored["status"], {"Idempotent-Replayed": "true"})
        ctx.tx = t
        answer = r.handler(ctx)
        t.run("INSERT INTO idempotency_records (organization_id, route, key, request_digest, status, data, database_id) "
              "VALUES (:o, :r, :k, :d, :s, :data, :db)", o=org, r=r.template, k=key, d=digest, s=answer.status,
              data=json.dumps(answer.data, ensure_ascii=False), db=ctx.idempotency_database_id)
    return answer


# ---- the dispatcher -----------------------------------------------------------------------------

def _execute(r: Route, ctx: Ctx, raw: bytes):
    """Steps 3 to 14 of the precedence rule; route and method were settled by the caller."""
    if r.template.startswith("/api/v2"):
        version = ctx.header("api-version")
        if version is None:
            raise ApiError("API_VERSION_REQUIRED")
        if version.strip() != "2":
            raise ApiError("UNSUPPORTED_API_VERSION")
    if r.who != "anyone":
        ctx.principal = _authenticate(ctx)
        _authorize(r.who, ctx.principal)
        if r.key_limited and ctx.principal.kind == "key":
            _key_query_limit(ctx)
    if len(raw) > MAX_BODY:
        raise ApiError("PAYLOAD_TOO_LARGE")
    if r.body:
        ctx.body = _parse_body(raw)
    key = ctx.header("idempotency-key")
    if r.idempotent and key is not None:
        answer = _idempotent(r, ctx, key)
    else:
        with db.tx() as t:
            ctx.tx = t
            answer = r.handler(ctx)
    for action in ctx.after:
        action()
    return answer


async def _read_body(request: Request) -> bytes:
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_BODY:
            return b"x" * (MAX_BODY + 1)
        chunks.append(chunk)
    return b"".join(chunks)


async def handle(request: Request) -> Response:
    started = time.monotonic()
    request_id = str(uuid.uuid4())
    path = request.url.path
    matches = [(r, m) for r in ROUTES if (m := r.pattern.match(path))]
    if not matches:
        return refusal_response(path, request_id, started, ApiError("ROUTE_NOT_FOUND"))
    chosen = next(((r, m) for r, m in matches if r.method == request.method), None)
    if chosen is None:
        allow = ", ".join(sorted({r.method for r, _ in matches}))
        return refusal_response(path, request_id, started, ApiError("METHOD_NOT_ALLOWED", method=request.method),
                                {"Allow": allow}, bodyless=request.method == "HEAD")
    r, match = chosen
    ctx = Ctx(request_id, request.headers, dict(request.query_params), match.groupdict())
    raw = await _read_body(request)
    try:
        result = await run_in_threadpool(_execute, r, ctx, raw)
    except ApiError as err:
        return refusal_response(path, request_id, started, err, ctx.out_headers)
    except Exception:  # noqa: BLE001 -- never a 500 or a trace: an unexpected failure answers in the envelope
        log.exception("unexpected failure on %s %s", request.method, path)
        return refusal_response(path, request_id, started, ApiError("UNAVAILABLE"), ctx.out_headers)
    if isinstance(result, Response):
        return result
    headers = _headers_for(path, {**ctx.out_headers, **result.headers})
    return Response(_envelope(request_id, started, data=result.data), status_code=result.status, headers=headers)


# ---- shared by handlers -------------------------------------------------------------------------

def audit(t: db.Tx, org_id: int, actor: str, action: str, target: str, detail: str = "") -> None:
    """One audit event, written in the caller's transaction."""
    t.run("INSERT INTO audit_events (organization_id, actor, action, target, detail) VALUES (:o, :a, :ac, :t, :d)",
          o=org_id, a=actor, ac=action, t=target, d=detail)

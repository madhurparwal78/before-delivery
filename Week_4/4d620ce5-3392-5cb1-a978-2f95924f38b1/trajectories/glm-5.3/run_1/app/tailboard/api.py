"""The ASGI app: request boundary, precedence, sessions, idempotency, routes (DP-05 to DP-09)."""
import asyncio
import hashlib
import json
import os
import secrets as pysecrets

import asyncpg
from starlette.applications import Starlette
from starlette.responses import FileResponse, Response, StreamingResponse
from starlette.routing import Route

from . import db as schema_db
from . import seed as seed_db
from .actions import Actions
from .clock import clock, format_iso, init_clock
from .config import Config
from .errors import (
    ApiError,
    bad_request,
    forbidden,
    method_not_allowed,
    not_found,
    payload_too_large,
    unauthenticated,
    unsupported_media_type,
    validation,
)
from .events import EventFeed
from .importer import Importer, import_shape
from .mail import Mailer
from .notices import Notifier, notice_shape
from .packs import PackService, pack_csv, pack_shape
from .repo import Repo, person_shape, user_shape
from .service import BoardService
from .storage import ObjectStorage, document_key, evidence_key, sha256_hex

JSON_LIMIT = 65536
BODY_LIMITS = {
    "document": 5_000_000,
    "evidence": 5_000_000,
    "import": 1_000_000,
}

ROLE_WRITES = {
    "compliance_planner": {"directive", "revision", "withdrawal", "document", "deferral",
                            "effectivity", "flight_hours"},
    "licensed_inspector": {"claim", "release", "evidence", "inspection"},
    "certifying_engineer": {"countersign"},
    "records_clerk": {"import", "reopen", "scope", "erasure", "pack"},
    "regulator_auditor": set(),
}

STATE = {}

AUTHORITY_MAILBOX = "continuing-airworthiness@caa-oversight.test"


def app(cfg: Config) -> Starlette:
    init_clock(cfg)
    storage = ObjectStorage(cfg)
    mailer = Mailer(cfg.smtp_host, cfg.smtp_port, cfg.mail_from)
    feed = EventFeed()
    STATE["cfg"] = cfg
    STATE["storage"] = storage
    STATE["mailer"] = mailer
    STATE["feed"] = feed

    async def startup():
        await _start(cfg, storage, feed)

    routes = [
        Route("/api/health", health, methods=["GET"]),
        Route("/api/session", session_endpoint, methods=["POST", "GET", "DELETE"]),
        Route("/api/events", events, methods=["GET"]),
        Route("/api/documents", documents, methods=["POST"]),
        Route("/api/directives", directives, methods=["GET", "POST"]),
        Route("/api/directives/{lineage_id}", directive_detail, methods=["GET"]),
        Route("/api/directives/{lineage_id}/revisions", directive_revisions, methods=["POST"]),
        Route("/api/directives/{lineage_id}/withdrawal", directive_withdrawal, methods=["POST"]),
        Route("/api/directives/{lineage_id}/export.csv", directive_export, methods=["GET"]),
        Route("/api/board", board, methods=["GET"]),
        Route("/api/tails", tails, methods=["GET"]),
        Route("/api/tails/{registration}/flight-hours", flight_hours, methods=["POST"]),
        Route("/api/threads", threads, methods=["GET"]),
        Route("/api/threads/{thread_id}", thread_detail, methods=["GET"]),
        Route("/api/threads/{thread_id}/claim", thread_claim, methods=["POST"]),
        Route("/api/threads/{thread_id}/release", thread_release, methods=["POST"]),
        Route("/api/threads/{thread_id}/evidence", thread_evidence, methods=["POST"]),
        Route("/api/threads/{thread_id}/inspection", thread_inspection, methods=["POST"]),
        Route("/api/threads/{thread_id}/countersign", thread_countersign, methods=["POST"]),
        Route("/api/threads/{thread_id}/deferral", thread_deferral, methods=["POST"]),
        Route("/api/threads/{thread_id}/effectivity", thread_effectivity, methods=["POST"]),
        Route("/api/threads/{thread_id}/reopen", thread_reopen, methods=["POST"]),
        Route("/api/people", people, methods=["GET"]),
        Route("/api/engineers/{user_id}/scope", engineer_scope, methods=["PUT"]),
        Route("/api/people/{user_id}/erasure", person_erasure, methods=["POST"]),
        Route("/api/imports", imports, methods=["POST", "GET"]),
        Route("/api/packs", packs, methods=["POST", "GET"]),
        Route("/api/packs/{pack_id}", pack_detail, methods=["GET"]),
        Route("/api/packs/{pack_id}/pdf", pack_pdf_download, methods=["GET"]),
        Route("/api/packs/{pack_id}/csv", pack_csv_download, methods=["GET"]),
        Route("/api/notices", notices, methods=["GET"]),
        Route("/api/search", search, methods=["GET"]),
        Route("/api/audit", audit, methods=["GET", "PUT", "PATCH", "DELETE"]),
        Route("/{path:path}", shell, methods=["GET"]),
    ]

    starlette_app = Starlette(routes=routes, on_startup=[startup])
    starlette_app.state.cfg = cfg
    starlette_app.add_middleware(_ErrorBoundary)
    starlette_app.add_middleware(_RequestBoundary)

    async def shutdown():
        pool = STATE.get("pool")
        if pool is not None:
            await pool.close()

    starlette_app.add_event_handler("shutdown", shutdown)
    return starlette_app



class _RequestBoundary:
    """Answers 413, 415, 405 and unknown /api paths from the request line, before any
    session cookie is read (API precedence step 1)."""

    JSON_MAX = 65_536

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = scope["path"]
        method = scope.get("method", "GET")
        if not path.startswith("/api"):
            await self.app(scope, receive, send)
            return
        headers = {key.decode().lower(): value.decode() for key, value in scope["headers"]}
        content_length = int(headers.get("content-length") or 0)
        content_type = (headers.get("content-type") or "").split(";")[0].strip().lower()
        for (prefix, verb), limit in [
            (("/api/documents", "POST"), 5_000_000),
            (("/api/imports", "POST"), 1_000_000),
        ]:
            if method == verb and path == prefix and content_length > limit:
                await _send_json(send, 413, {"code": "payload_too_large",
                                             "message": "That request body is too large."})
                return
        if path.startswith("/api/threads/") and path.endswith("/evidence") and method == "POST":
            if content_length > 5_000_000:
                await _send_json(send, 413, {"code": "payload_too_large",
                                             "message": "That request body is too large."})
                return
            if content_type not in ("image/jpeg", "image/png", "application/pdf"):
                await _send_json(send, 415, {"code": "unsupported_media_type",
                                             "message": "That content type is not accepted."})
                return
            await self.app(scope, receive, send)
            return
        if method in ("POST", "PUT", "PATCH") and content_length > self.JSON_MAX                 and path != "/api/documents" and not path.startswith("/api/imports"):
            await _send_json(send, 413, {"code": "payload_too_large",
                                         "message": "That request body is too large."})
            return
        await self.app(scope, receive, send)


async def _send_json(send, status, payload):
    body = json.dumps({"error": payload}).encode()
    await send({"type": "http.response.start", "status": status,
                "headers": [(b"content-type", b"application/json; charset=utf-8"),
                            (b"content-length", str(len(body)).encode())]})
    await send({"type": "http.response.body", "body": body})


class _ErrorBoundary:
    """Pure ASGI middleware: one error shape for every raised exception."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        try:
            await self.app(scope, receive, send)
        except ApiError as error:
            payload = json.dumps(error.body()).encode()
            response = Response(payload, status_code=error.status,
                                media_type="application/json; charset=utf-8")
            await response(scope, receive, send)
        except Exception:
            import traceback
            traceback.print_exc()
            payload = json.dumps({"error": {"code": "internal_error",
                                            "message": "Something went wrong."}}).encode()
            response = Response(payload, status_code=500,
                                media_type="application/json; charset=utf-8")
            await response(scope, receive, send)


async def _start(cfg, storage, feed):
    pool = await asyncpg.create_pool(cfg.database_url, min_size=2, max_size=10)
    repo = Repo(pool)
    await schema_db.apply_schema(cfg.database_url)
    await seed_db.seed(cfg.database_url)
    notifier = Notifier(cfg.notice_hold_seconds, STATE["mailer"], AUTHORITY_MAILBOX)
    actions = Actions(repo, pool, notifier, feed)
    importer = Importer(pool, repo, actions)
    pack_service = PackService(repo, pool, storage, STATE["mailer"], cfg.app_public_url,
                               AUTHORITY_MAILBOX, actions)
    STATE.update({
        "pool": pool,
        "repo": repo,
        "board": BoardService(repo),
        "actions": actions,
        "notifier": notifier,
        "importer": importer,
        "packs": pack_service,
        "storage": storage,
        "feed": feed,
    })
    asyncio.create_task(_worker(pack_service, STATE["mailer"]))


async def _worker(pack_service, mailer):
    """Background retries: queued notices and packs go out by themselves within 10 seconds."""
    while True:
        await asyncio.sleep(5)
        try:
            async with STATE["pool"].acquire() as conn:
                due = await conn.fetch(
                    "SELECT * FROM notices WHERE status = 'queued' AND send_after <= $1",
                    clock().now())
                for notice_row in due:
                    sent = await mailer.send(notice_row["to_email"], notice_row["subject"],
                                             notice_row["body"])
                    if sent:
                        await conn.execute(
                            "UPDATE notices SET status = 'sent', sent_at = $1 WHERE id = $2",
                            *(clock().now(), notice_row["id"]))
            pending = await STATE["pool"].fetch(
                "SELECT id FROM packs WHERE status = 'queued'")
            for pack_row in pending:
                await pack_service.attempt(pack_row["id"])
        except Exception:
            continue


# ---------- boundary helpers -------------------------------------------------

def _json_response(payload, status=200, headers=None):
    body = json.dumps(payload).encode()
    return Response(body, status_code=status, media_type="application/json; charset=utf-8",
                    headers=headers or {})


async def _read_json(request, limit=JSON_LIMIT):
    _content_type(request, "application/json")
    length = int(request.headers.get("content-length") or 0)
    if length > limit:
        raise payload_too_large()
    body = await request.body()
    if len(body) > limit:
        raise payload_too_large()
    if not body:
        return {}
    try:
        return json.loads(body)
    except (ValueError, UnicodeDecodeError):
        raise validation({"body": "The request body must be JSON."})


def _content_type(request, expected):
    actual = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if actual != expected:
        raise unsupported_media_type()


async def _session_user(request):
    token = request.cookies.get("tb_session")
    if not token:
        return None
    repo = STATE["repo"]
    row = await repo.pool.fetchrow(
        """SELECT p.*, s.token FROM sessions s JOIN people p ON p.id = s.person_id
           WHERE s.token = $1""", token)
    return row


def _origin_ok(request, cfg):
    origin = request.headers.get("origin")
    if origin is None:
        return True
    return origin.rstrip("/") == cfg.app_origin.rstrip("/")


def _idempotency_key(request):
    key = request.headers.get("idempotency-key")
    if key is None or key == "":
        raise bad_request("idempotency_key_required", "Send an Idempotency-Key header.")
    if not (1 <= len(key) <= 100) or not all(32 <= ord(ch) < 127 for ch in key):
        raise bad_request("idempotency_key_invalid",
                          "The idempotency key must be 1 to 100 printable ASCII characters.")
    return key


async def _idempotent_replay(request, user, key, body_bytes):
    """Return the stored response for this key, or None to run the action.

    A first-time key is claimed with a placeholder row so a concurrent same-key request
    cannot run the action twice; that request answers that the key is still processing.
    """
    digest = hashlib.sha256(body_bytes).hexdigest()
    row = await STATE["repo"].pool.fetchrow(
        """SELECT status, body, request_hash FROM idempotency
           WHERE key = $1 AND user_id = $2 AND method = $3 AND path = $4""",
        *(key, user["id"], request.method, request.url.path))
    if row is not None:
        if row["request_hash"] != digest:
            raise ApiError(409, "idempotency_mismatch",
                           "This idempotency key was used with a different request body.")
        if row["status"] == 0:
            raise bad_request("idempotency_key_invalid",
                              "That request is still being processed.")
        return row
    claimed = await STATE["repo"].pool.fetchrow(
        """INSERT INTO idempotency (key, user_id, method, path, request_hash, status, body, created_at)
           VALUES ($1, $2, $3, $4, $5, 0, '', $6)
           ON CONFLICT (key, user_id, method, path) DO NOTHING
           RETURNING *""",
        *(key, user["id"], request.method, request.url.path, digest, clock().now()))
    if claimed is None:
        raise bad_request("idempotency_key_invalid",
                          "That request is still being processed.")
    return None


async def _store_idempotent(request, user, key, status, payload):
    await STATE["repo"].pool.execute(
        """UPDATE idempotency SET status = $1, body = $2 WHERE key = $3 AND user_id = $4
           AND method = $5 AND path = $6""",
        *(status, json.dumps(payload), key, user["id"], request.method, request.url.path))


async def _run_keyed(request, user, key, body_bytes, run):
    """Replay the stored response for this key, or run the action and store its outcome.

    Both successes and errors are stored, so a repeat with the same key and body returns
    the original response with Idempotent-Replayed: true and records nothing new.
    """
    replay = await _idempotent_replay(request, user, key, body_bytes)
    if replay is not None:
        return _json_response(json.loads(replay["body"]), replay["status"],
                              {"Idempotent-Replayed": "true"})
    try:
        status, payload = await run()
    except ApiError as error:
        await _store_idempotent(request, user, key, error.status, error.body())
        raise
    await _store_idempotent(request, user, key, status, payload)
    return _json_response(payload, status=status)


# ---------- endpoints --------------------------------------------------------

async def health(request):
    return _json_response({"status": "ok"})


async def session_endpoint(request):
    if request.method == "GET":
        user = await _session_user(request)
        if user is None:
            raise unauthenticated()
        return _json_response({"user": user_shape(user)})
    if request.method == "DELETE":
        user = await _session_user(request)
        if user is None:
            raise unauthenticated()
        await STATE["repo"].pool.execute("DELETE FROM sessions WHERE token = $1",
                                         user["token"])
        response = Response(status_code=204)
        response.delete_cookie("tb_session")
        return response
    _content_type(request, "application/json")
    payload = await _read_json(request)
    username = payload.get("username")
    passcode = payload.get("passcode")
    row = await STATE["repo"].pool.fetchrow(
        "SELECT * FROM people WHERE username = $1 AND passcode = $2", username, passcode)
    if row is None or row["erased"]:
        raise ApiError(401, "bad_credentials", "Username or passcode is wrong.")
    token = pysecrets.token_urlsafe(24)
    now = clock().now()
    await STATE["repo"].pool.execute(
        "INSERT INTO sessions (token, person_id, started_at, last_seen) VALUES ($1, $2, $3, $3)",
        *(token, row["id"], now))
    response = _json_response({"user": user_shape(row)})
    response.set_cookie("tb_session", token, httponly=True, samesite="strict", path="/")
    return response


async def events(request):
    user = await _session_user(request)
    if user is None:
        raise unauthenticated()
    queue = STATE["feed"].subscribe()

    async def generate():
        try:
            async for chunk in STATE["feed"].stream(queue):
                yield chunk
        finally:
            STATE["feed"].unsubscribe(queue)

    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache"})


async def documents(request):
    user = await _require_role(request, "compliance_planner", "document")
    _content_type(request, "application/pdf")
    length = int(request.headers.get("content-length") or 0)
    if length > BODY_LIMITS["document"]:
        raise payload_too_large()
    body = await request.body()
    if len(body) > BODY_LIMITS["document"]:
        raise payload_too_large()
    if not body.startswith(b"%PDF-"):
        raise validation({"document": "must be a PDF"})
    if not await STATE["storage"].available():
        raise ApiError(503, "storage_unavailable", "Object storage is unavailable.")
    digest = sha256_hex(body)
    key = document_key(digest)
    await STATE["storage"].put(key, body, "application/pdf")
    existing = await STATE["repo"].pool.fetchrow(
        "SELECT id FROM documents WHERE sha256 = $1", digest)
    if existing:
        return _json_response({"document_id": existing["id"], "key": key,
                               "sha256": digest, "bytes": len(body)})
    document_id = f"doc_{pysecrets.token_hex(8)}"
    await STATE["repo"].pool.execute(
        """INSERT INTO documents (id, sha256, key, bytes, uploaded_by, uploaded_at)
           VALUES ($1, $2, $3, $4, $5, $6)""",
        *(document_id, digest, key, len(body), user["id"], clock().now()))
    return _json_response({"document_id": document_id, "key": key,
                           "sha256": digest, "bytes": len(body)}, status=201)


async def _require_role(request, role=None, action=None):
    """Reads are open to all signed-in roles; writes need the role the table names."""
    user = await _session_user(request)
    if user is None:
        raise unauthenticated()
    if request.method not in ("GET", "HEAD"):
        cfg = request.app.state.cfg
        if not _origin_ok(request, cfg):
            raise forbidden()
    if action is not None:
        allowed = ROLE_WRITES.get(user["role"], set())
        if action not in allowed:
            raise forbidden()
    return user


async def directives(request):
    if request.method == "GET":
        user = await _require_role(request)
        board = STATE["board"]
        return _json_response({"directives": await board.directives()})
    user = await _require_role(request, "compliance_planner", "directive")
    payload = await _read_json(request)
    result = await STATE["actions"].ingest_directive(user, payload)
    return _json_response(result, status=201)


async def directive_detail(request):
    await _require_role(request)
    lineage_id = request.path_params["lineage_id"]
    board = STATE["board"]
    directives = await board.directives()
    for directive in directives:
        if directive["id"] == lineage_id:
            return _json_response({"directive": directive})
    raise not_found("No such directive.")


async def directive_revisions(request):
    user = await _require_role(request, "compliance_planner", "revision")
    lineage_id = request.path_params["lineage_id"]
    payload = await _read_json(request)
    result = await STATE["actions"].ingest_revision(user, lineage_id, payload)
    return _json_response(result, status=201)


async def directive_withdrawal(request):
    user = await _require_role(request, "compliance_planner", "withdrawal")
    lineage_id = request.path_params["lineage_id"]
    payload = await _read_json(request)
    reason = payload.get("reason")
    if not isinstance(reason, str) or not (1 <= len(reason) <= 500):
        raise validation({"reason": "Give a withdrawal reason of 1 to 500 characters."})
    result = await STATE["actions"].withdraw(user, lineage_id, reason)
    return _json_response(result)


async def directive_export(request):
    await _require_role(request)
    lineage_id = request.path_params["lineage_id"]
    board = STATE["board"]
    threads = await board.threads(directive_id=lineage_id)
    directive = None
    for entry in await board.directives():
        if entry["id"] == lineage_id:
            directive = entry
            break
    if directive is None:
        raise not_found("No such directive.")
    csv_bytes = pack_csv(directive, threads)
    return Response(csv_bytes, media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{lineage_id}.csv"'})


async def board(request):
    await _require_role(request)
    directive_id = request.query_params.get("directive_id")
    as_of = request.query_params.get("as_of")
    payload = await STATE["board"].board(directive_id=directive_id, as_of=as_of)
    if payload is None:
        raise not_found("No such prior revision.")
    return _json_response(payload)


async def tails(request):
    await _require_role(request)
    rows = await STATE["repo"].tails()
    return _json_response({"tails": [
        {"registration": row["registration"], "model": row["model"], "msn": row["msn"],
         "total_hours": float(row["total_hours"]),
         "daily_utilisation": float(row["daily_utilisation"])} for row in rows]})


async def flight_hours(request):
    user = await _require_role(request, "compliance_planner", "flight_hours")
    registration = request.path_params["registration"]
    payload = await _read_json(request)
    hours = payload.get("hours")
    if not isinstance(hours, (int, float)) or isinstance(hours, bool) \
            or not (0.1 <= float(hours) <= 24.0):
        raise validation({"hours": "Sector hours must be from 0.1 to 24.0 with at most one decimal."})
    hours = round(float(hours), 1)
    tail = await STATE["repo"].tail(registration)
    if tail is None:
        raise not_found("No such tail.")
    now = clock().now()
    async with STATE["pool"].acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "INSERT INTO flight_hours (registration, hours, logged_at) VALUES ($1, $2, $3)",
                *(registration, hours, now))
            await conn.execute(
                "UPDATE tails SET total_hours = total_hours + $1 WHERE registration = $2",
                *(hours, registration))
            await conn.execute(
                """UPDATE threads SET last_revision_change = $1,
                   hours_due_at = CASE WHEN hours_due_at IS NULL
                        AND tm.total_hours > threads.threshold THEN $1
                        ELSE threads.hours_due_at END
                   FROM tails tm WHERE threads.registration = tm.registration
                        AND threads.registration = $2""",
                *(now, registration))
            await conn.execute(
                "INSERT INTO audit (at, actor_id, action, directive_id, thread_id, detail) VALUES ($1, $2, 'flight_hours.logged', NULL, NULL, $3)",
                *(now, user["id"], json.dumps({"registration": registration, "hours": hours})))
    row = await STATE["repo"].tail(registration)
    affected = await STATE["repo"].pool.fetch(
        "SELECT id FROM threads WHERE registration = $1", registration)
    await STATE["feed"].publish("threads", {"thread_ids": [row2["id"] for row2 in affected]})
    return _json_response({"registration": registration,
                           "total_hours": float(row["total_hours"]),
                           "logged_at": format_iso(now)}, status=201)


async def threads(request):
    await _require_role(request)
    directive_id = request.query_params.get("directive_id")
    registration = request.query_params.get("registration")
    state = request.query_params.get("state")
    result = await STATE["board"].threads(directive_id=directive_id,
                                          registration=registration, state=state)
    return _json_response({"threads": result})


async def thread_detail(request):
    await _require_role(request)
    shape = await STATE["board"].thread_by_id(request.path_params["thread_id"])
    if shape is None:
        raise not_found("No such thread.")
    return _json_response({"thread": shape})


async def thread_claim(request):
    key = _idempotency_key(request)
    user = await _require_role(request, "licensed_inspector", "claim")
    thread_id = request.path_params["thread_id"]

    async def run():
        result = await STATE["actions"].claim(user, thread_id)
        return 200, {"thread": result}

    return await _run_keyed(request, user, key, b"", run)


async def thread_release(request):
    user = await _require_role(request)
    thread_id = request.path_params["thread_id"]
    row = await STATE["repo"].thread(thread_id)
    if row is None:
        raise not_found("No such thread.")
    if user["role"] != "licensed_inspector":
        raise forbidden()
    payload = await _read_json(request)
    result = await STATE["actions"].release(user, thread_id)
    return _json_response({"thread": result})


async def thread_evidence(request):
    user = await _require_role(request)
    thread_id = request.path_params["thread_id"]
    content_type = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if content_type not in ("image/jpeg", "image/png", "application/pdf"):
        raise unsupported_media_type()
    length = int(request.headers.get("content-length") or 0)
    if length > BODY_LIMITS["evidence"]:
        raise payload_too_large()
    body = await request.body()
    if len(body) > BODY_LIMITS["evidence"]:
        raise payload_too_large()
    if user["role"] != "licensed_inspector":
        raise forbidden()
    if not await STATE["storage"].available():
        raise ApiError(503, "storage_unavailable",
                       "Evidence storage is unavailable. Nothing was attached.")
    digest = sha256_hex(body)
    key = evidence_key(digest, content_type)
    await STATE["storage"].put(key, body, content_type)
    evidence_row = {"id": f"ev_{pysecrets.token_hex(8)}", "key": key, "sha256": digest,
                    "content_type": content_type, "bytes": len(body)}
    result = await STATE["actions"].attach_evidence(user, thread_id, evidence_row)
    return _json_response({"evidence": result}, status=201)


async def thread_inspection(request):
    key = _idempotency_key(request)
    payload = await _read_json(request)
    user = await _require_role(request, "licensed_inspector", "inspection")
    thread_id = request.path_params["thread_id"]

    async def run():
        result = await STATE["actions"].sign_inspection(user, thread_id, payload)
        return 201, result

    return await _run_keyed(request, user, key, json.dumps(payload).encode(), run)


async def thread_countersign(request):
    key = _idempotency_key(request)
    payload = await _read_json(request)
    user = await _require_role(request, "certifying_engineer", "countersign")
    thread_id = request.path_params["thread_id"]

    async def run():
        result = await STATE["actions"].countersign(user, thread_id, payload)
        return 201, result

    return await _run_keyed(request, user, key, json.dumps(payload).encode(), run)


async def thread_deferral(request):
    key = _idempotency_key(request)
    payload = await _read_json(request)
    user = await _require_role(request, "compliance_planner", "deferral")
    thread_id = request.path_params["thread_id"]

    async def run():
        result = await STATE["actions"].defer(user, thread_id, payload)
        return 201, {"thread": result}

    return await _run_keyed(request, user, key, json.dumps(payload).encode(), run)


async def thread_effectivity(request):
    user = await _require_role(request, "compliance_planner", "effectivity")
    payload = await _read_json(request)
    thread_id = request.path_params["thread_id"]
    result = await STATE["actions"].confirm_effectivity(
        user, thread_id, payload.get("decision"), payload.get("reason"))
    return _json_response({"thread": result})


async def thread_reopen(request):
    user = await _require_role(request, "records_clerk", "reopen")
    payload = await _read_json(request)
    thread_id = request.path_params["thread_id"]
    result = await STATE["actions"].reopen(user, thread_id, payload.get("reason"))
    return _json_response({"thread": result})


async def people(request):
    await _require_role(request)
    rows = await STATE["repo"].pool.fetch(
        "SELECT * FROM people WHERE username IS NOT NULL ORDER BY display_name")
    return _json_response({"people": [user_shape(row) for row in rows]})


async def engineer_scope(request):
    user = await _require_role(request, "records_clerk", "scope")
    payload = await _read_json(request)
    models = payload.get("models")
    if not isinstance(models, list):
        raise validation({"models": "Send the list of model codes this engineer covers."})
    result = await STATE["actions"].change_scope(user, request.path_params["user_id"], models)
    return _json_response(result)


async def person_erasure(request):
    user = await _require_role(request, "records_clerk", "erasure")
    payload = await _read_json(request)
    result = await STATE["actions"].erase(user, request.path_params["user_id"],
                                          payload.get("reason"))
    return _json_response({"person": result})


async def imports(request):
    if request.method == "GET":
        await _require_role(request)
        rows = await STATE["repo"].imports()
        return _json_response({"imports": [import_shape(row) for row in rows]})
    key = _idempotency_key(request)
    user = await _require_role(request, "records_clerk", "import")
    _content_type(request, "text/csv")
    length = int(request.headers.get("content-length") or 0)
    if length > BODY_LIMITS["import"]:
        raise payload_too_large()
    body = await request.body()
    if len(body) > BODY_LIMITS["import"]:
        raise payload_too_large()
    async def run():
        result = await STATE["importer"].run(user, body)
        return (200 if result["replayed_file"] else 201), result

    return await _run_keyed(request, user, key, body, run)


async def packs(request):
    if request.method == "GET":
        await _require_role(request)
        rows = await STATE["repo"].packs()
        return _json_response({"packs": [pack_shape(row) for row in rows]})
    key = _idempotency_key(request)
    user = await _require_role(request, "records_clerk", "pack")
    payload = await _read_json(request)
    lineage_id = payload.get("directive_id")
    if not isinstance(lineage_id, str) or not lineage_id:
        raise validation({"directive_id": "Choose the directive this pack covers."})

    async def run():
        shape, status = await STATE["packs"].request(user, lineage_id)
        return status, {"pack": shape}

    return await _run_keyed(request, user, key, json.dumps(payload).encode(), run)


async def pack_detail(request):
    await _require_role(request)
    row = await STATE["repo"].pack(request.path_params["pack_id"])
    if row is None:
        raise not_found("No such pack.")
    return _json_response({"pack": pack_shape(row)})


async def pack_pdf_download(request):
    return await _pack_object(request, "pdf")


async def pack_csv_download(request):
    return await _pack_object(request, "csv")


async def _pack_object(request, kind):
    await _require_role(request)
    row = await STATE["repo"].pack(request.path_params["pack_id"])
    if row is None:
        raise not_found("No such pack.")
    if row["status"] != "transmitted":
        raise ApiError(409, "pack_not_transmitted", "This pack has not been transmitted.")
    key = row["pdf_key"] if kind == "pdf" else row["csv_key"]
    try:
        data = await STATE["storage"].get(key)
    except Exception:
        raise ApiError(503, "storage_unavailable", "Object storage is unavailable.")
    media = "application/pdf" if kind == "pdf" else "text/csv"
    return Response(data, media_type=media)


async def notices(request):
    await _require_role(request)
    status = request.query_params.get("status")
    rows = await STATE["repo"].notices(status=status)
    return _json_response({"notices": [notice_shape(row) for row in rows]})


async def search(request):
    await _require_role(request)
    query = (request.query_params.get("q") or "").strip()
    if not (2 <= len(query) <= 100):
        raise validation({"q": "Search needs 2 to 100 characters."})
    results = await STATE["board"].search(query)
    return _json_response({"results": results})


async def audit(request):
    if request.method in ("PUT", "PATCH", "DELETE"):
        raise method_not_allowed()
    await _require_role(request)
    directive_id = request.query_params.get("directive_id")
    thread_id = request.query_params.get("thread_id")
    rows = await STATE["repo"].audit_entries(directive_id=directive_id, thread_id=thread_id)
    entries = []
    for row in rows:
        person = await STATE["repo"].person(row["actor_id"])
        entries.append({
            "id": str(row["id"]),
            "at": format_iso(row["at"]),
            "actor": person_shape(person),
            "action": row["action"],
            "directive_id": row["directive_id"],
            "thread_id": row["thread_id"],
            "detail": row["detail"],
        })
    return _json_response({"entries": entries})


STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")
SHELL_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static",
                          "index.html")


async def shell(request):
    path = request.path_params["path"]
    if path.startswith("api/"):
        raise not_found("No such API path.")
    if not path:
        return FileResponse(SHELL_PATH)
    # Never serve source, the run manifest, the virtual environment or credentials.
    if (path.startswith(".venv/") or path.startswith("tailboard/")
            or path == "run.json" or path == "requirements.txt"
            or path == "THIRD_PARTY_NOTICES.md" or path == "tests/"
            or path.startswith("tests/") or path.startswith(".git")
            or path == ".env" or path.startswith(".env.")
            or "/../" in path or path.endswith(".py")):
        raise not_found("Not served.")
    if path.startswith("static/"):
        full = os.path.normpath(os.path.join(STATIC_DIR, path[len("static/"):]))
        if not full.startswith(STATIC_DIR) or not os.path.isfile(full):
            raise not_found("Not served.")
        return FileResponse(full)
    return FileResponse(SHELL_PATH)


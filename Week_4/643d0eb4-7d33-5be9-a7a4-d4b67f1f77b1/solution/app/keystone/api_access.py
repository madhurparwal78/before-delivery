"""Access requests, and the steward administration interface under /api/admin."""
import base64
import binascii
import json

import psycopg.errors
from starlette.responses import JSONResponse, Response

from . import auth, config, rules
from .api_tables import int_param, log_page
from .ctx import Ctx
from .db import all_, one, tx
from .errors import refuse
from .util import dumps, iso, norm_email, now, parse_moment, uint

STEWARD_ONLY = "This console is for stewards only."
NOT_YOURS = "This department is not yours to govern."


# ---- requests ----------------------------------------------------------------------------------------------------

def request_answer(r: dict) -> dict:
    return {"id": r["id"], "account": r["account"], "department": r["department"], "role": r["role"],
            "state": r["state"], "reason": r["reason"], "raised_at": iso(r["raised_at"]),
            "decided_by": r["decided_by"]}


def requests_list(ctx: Ctx) -> Response:
    with tx() as conn:
        account = auth.require_account(conn, ctx)
        state = ctx.query.get("state") or None
        if state and state not in ("open", "approved", "declined"):
            refuse(422, "state is open, approved or declined", "state")
        stewarded = [d for d, role in auth.roles_of(conn, account["email"]).items() if role == "steward"]
        rows = all_(conn, "SELECT * FROM requests WHERE (account = %s OR department = ANY(%s)) "
                          "AND (%s::text IS NULL OR state = %s) ORDER BY raised_at DESC, id DESC",
                    (account["email"], stewarded, state, state))
        return JSONResponse([request_answer(r) for r in rows])


def request_create(ctx: Ctx) -> Response:
    with tx() as conn:
        account = auth.require_account(conn, ctx)
        body = ctx.object()
        department, role = body.get("department"), body.get("role")
        if department not in config.DEPARTMENTS:
            refuse(422, "Choose claims, underwriting or actuarial.", "department")
        if role not in config.ROLES:
            refuse(422, "Choose viewer, analyst, editor or steward.", "role")
        try:
            row = one(conn, "INSERT INTO requests (account, department, role, state, raised_at) "
                            "VALUES (%s, %s, %s, 'open', %s) RETURNING *", (account["email"], department, role, now()))
        except psycopg.errors.UniqueViolation:
            refuse(409, f"You already have an open request for the {department} department", "department")
        return JSONResponse(request_answer(row), status_code=201)


def decide_request(conn, account: dict, request_id: int, decision, reason) -> dict:
    req = one(conn, "SELECT * FROM requests WHERE id = %s FOR UPDATE", (request_id,))
    if req is None:
        refuse(404, f"There is no request {request_id}", "request")
    held = auth.role_of(conn, account["email"], req["department"])
    if held is None:
        refuse(403, NOT_YOURS, "department")
    if held != "steward":
        refuse(403, "Only a steward decides a request", "role")
    if req["account"] == account["email"]:
        refuse(403, "You cannot decide your own request", "account")
    if decision not in ("approved", "declined"):
        refuse(422, "decision is approved or declined", "decision")
    if not isinstance(reason, str) or not reason.strip() or len(reason.strip()) > 500:
        refuse(422, "Give a reason of up to 500 characters", "reason")
    if req["state"] != "open":
        refuse(409, "This request has already been decided.", "state")
    moment = now()
    if decision == "approved":
        conn.execute("INSERT INTO role_grants (account, department, role, authorises_from) VALUES (%s, %s, %s, %s) "
                     "ON CONFLICT (account, department) DO UPDATE SET role = EXCLUDED.role, "
                     "authorises_from = EXCLUDED.authorises_from",
                     (req["account"], req["department"], req["role"], moment))
    done = one(conn, "UPDATE requests SET state = %s, reason = %s, decided_by = %s, decided_at = %s WHERE id = %s "
                     "RETURNING *", (decision, reason.strip(), account["email"], moment, req["id"]))
    admin_entry(conn, req["department"], "request_decided", account["email"], req["account"], moment)
    return done


def request_decision(ctx: Ctx) -> Response:
    raw = ctx.params["request_id"]
    with tx() as conn:
        account = auth.require_account(conn, ctx)
        body = ctx.object()
        request_id = uint(raw)
        if request_id is None:
            refuse(404, f"There is no request {raw}", "request")
        done = decide_request(conn, account, request_id, body.get("decision"), body.get("reason"))
        return JSONResponse(request_answer(done))


# ---- administration log ------------------------------------------------------------------------------------------

def admin_entry(conn, department: str, action: str, actor: str, subject: str, moment) -> None:
    conn.execute("SELECT 1 FROM departments WHERE slug = %s FOR UPDATE", (department,))
    rules.append_log(conn, f"admin-{department}", action=action, account=actor, recorded_at=moment, subject=subject)


# ---- /api/admin --------------------------------------------------------------------------------------------------

def grant_answer(g: dict, at) -> dict:
    return {"id": g["id"], "account": g["account"], "department": g["department"], "role": g["role"],
            "authorises_from": iso(g["authorises_from"]), "authorising": g["authorises_from"] <= at}


def _queue_key(r: dict) -> list:
    return [0 if r["state"] == "open" else 1, iso(r["raised_at"]), r["id"]]


def _queue_cursor(department: str, key: list) -> str:
    return base64.urlsafe_b64encode(dumps({"d": department, "k": key}).encode()).decode().rstrip("=")


def _read_queue_cursor(raw: str, department: str) -> list:
    try:
        data = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
    except (ValueError, binascii.Error, UnicodeDecodeError):
        refuse(422, "This cursor is not valid.", "cursor")
    if not isinstance(data, dict) or not isinstance(data.get("k"), list) or len(data["k"]) != 3:
        refuse(422, "This cursor is not valid.", "cursor")
    if data.get("d") != department:
        refuse(422, "This cursor belongs to another department.", "cursor")
    group, stamp, ident = data["k"]
    moment = parse_moment(stamp)
    if group not in (0, 1) or moment is None or not isinstance(ident, int):
        refuse(422, "This cursor is not valid.", "cursor")
    return [group, moment, ident]


ROUTES = {  # path shape -> accepted methods
    "grants": ("GET", "POST"),
    "grants/revocations": ("POST",),
    "grants/*": ("DELETE",),
    "queue": ("GET",),
    "counts": ("GET",),
    "log": ("GET",),
}


def admin_endpoint(ctx: Ctx) -> Response:
    path = ctx.params["rest"].strip("/")
    with tx() as conn:
        account = auth.require_account(conn, ctx)
        department = auth.steward_department(conn, account)
        if department is None:
            refuse(403, STEWARD_ONLY, "role")
        shape = path if path in ROUTES else ("grants/*" if path.startswith("grants/") and path.count("/") == 1
                                             else None)
        if shape is None:
            refuse(404, f"There is no administration address {path}", "path")
        accepted = ROUTES[shape]
        if ctx.method not in accepted:
            refuse(405, "That method is not allowed here.", "method", headers={"Allow": ", ".join(accepted)})
        if ctx.method == "POST" and ctx.content_type != "application/json":
            refuse(415, "That request body type is not supported.", "content_type")
        return HANDLERS[shape](conn, ctx, account, department, path)


def grants_get(conn, ctx, account, department, path):
    at = now()
    rows = all_(conn, "SELECT * FROM role_grants WHERE department = %s ORDER BY id", (department,))
    return JSONResponse([grant_answer(g, at) for g in rows])


def grants_post(conn, ctx, account, department, path):
    body = ctx.object()
    email, role = norm_email(body.get("account")), body.get("role")
    if one(conn, "SELECT 1 AS ok FROM accounts WHERE email = %s", (email,)) is None:
        refuse(422, "No account holds that email.", "account")
    if role not in config.ROLES:
        refuse(422, "Choose viewer, analyst, editor or steward.", "role")
    moment = now()
    given = body.get("authorises_from")
    if given is not None:
        moment_from = parse_moment(given)
        if moment_from is None:
            refuse(422, "authorises_from is an ISO 8601 timestamp", "authorises_from")
    else:
        moment_from = moment
    conn.execute("SELECT 1 FROM departments WHERE slug = %s FOR UPDATE", (department,))
    if one(conn, "SELECT 1 AS ok FROM role_grants WHERE account = %s AND department = %s", (email, department)):
        refuse(409, f"{email} already holds a role in the {department} department", "account")
    row = one(conn, "INSERT INTO role_grants (account, department, role, authorises_from) VALUES (%s, %s, %s, %s) "
                    "RETURNING *", (email, department, role, moment_from))
    admin_entry(conn, department, "grant_created", account["email"], email, moment)
    return JSONResponse(grant_answer(row, now()), status_code=201)


def grant_delete(conn, ctx, account, department, path):
    raw = path.split("/")[1]
    ident = uint(raw)
    grant = one(conn, "SELECT * FROM role_grants WHERE id = %s", (ident,)) if ident is not None else None
    if grant is None:
        refuse(404, f"There is no grant {raw}", "grant")
    if grant["department"] != department:
        refuse(403, NOT_YOURS, "department")
    conn.execute("SELECT 1 FROM departments WHERE slug = %s FOR UPDATE", (department,))
    conn.execute("DELETE FROM role_grants WHERE id = %s", (grant["id"],))
    admin_entry(conn, department, "grant_revoked", account["email"], grant["account"], now())
    return Response(status_code=204)


def grants_revoke(conn, ctx, account, department, path):
    body = ctx.object()
    if body.get("confirmation") != config.BULK_PHRASE:
        refuse(422, "The confirmation phrase does not match.", "confirmation")
    named = body.get("grants")
    if not isinstance(named, list) or not named:
        refuse(422, "One of these grants cannot be revoked.", "grants")
    ids = sorted({uint(g) for g in named if uint(g) is not None})
    if len(ids) != len({str(g) for g in named}):
        refuse(422, "One of these grants cannot be revoked.", "grants")
    conn.execute("SELECT 1 FROM departments WHERE slug = %s FOR UPDATE", (department,))
    found = all_(conn, "SELECT * FROM role_grants WHERE id = ANY(%s) AND department = %s ORDER BY id FOR UPDATE",
                 (ids, department))
    if len(found) != len(ids):
        refuse(422, "One of these grants cannot be revoked.", "grants")
    conn.execute("DELETE FROM role_grants WHERE id = ANY(%s)", (ids,))
    moment = now()
    for grant in found:
        admin_entry(conn, department, "grant_revoked", account["email"], grant["account"], moment)
    return JSONResponse({"revoked": len(found)})


def queue_get(conn, ctx, account, department, path):
    cursor = ctx.query.get("cursor")
    after = _read_queue_cursor(cursor, department) if cursor else [0, parse_moment("1970-01-01T00:00:00Z"), 0]
    rows = all_(conn, """
        SELECT * FROM requests WHERE department = %s
          AND ((CASE WHEN state = 'open' THEN 0 ELSE 1 END), raised_at, id) > (%s, %s, %s)
        ORDER BY (CASE WHEN state = 'open' THEN 0 ELSE 1 END), raised_at, id LIMIT %s""",
                (department, after[0], after[1], after[2], config.QUEUE_PAGE))
    key = _queue_key(rows[-1]) if rows else [after[0], iso(after[1]), after[2]]
    return JSONResponse([request_answer(r) for r in rows],
                        headers={"X-Queue-Cursor": _queue_cursor(department, key)})


def counts_get(conn, ctx, account, department, path):
    return JSONResponse({
        "department": department,
        "grants": int(one(conn, "SELECT count(*) AS n FROM role_grants WHERE department = %s", (department,))["n"]),
        "open_requests": int(one(conn, "SELECT count(*) AS n FROM requests WHERE department = %s AND state = 'open'",
                                 (department,))["n"])})


def log_get(conn, ctx, account, department, path):
    rows, total = log_page(conn, f"admin-{department}", None, None, int_param(ctx, "page", 1))
    return JSONResponse([rules.log_answer(r) for r in rows], headers={"X-Total-Count": str(total)})


HANDLERS = {"grants": lambda *a: (grants_get if a[1].method == "GET" else grants_post)(*a),
            "grants/revocations": grants_revoke, "grants/*": grant_delete, "queue": queue_get,
            "counts": counts_get, "log": log_get}

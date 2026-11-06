"""Platform and session endpoints."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from urllib.parse import unquote

from starlette.responses import Response

from . import auth, db, ledger, mail, storage
from .errors import ApiError
from .http import Context, json_response, route
from .rules import ROLE_LEAD, landing_for
from .validation import FieldChecker
from .views import format_time

SEED_ID_SHAPES = {
    "compartments": re.compile(r"^CMP-\d{4}$"),
    "exhibits": re.compile(r"^EX-\d{4}$"),
    "releases": re.compile(r"^REL-\d{4}$"),
}
ROLE_ROUTES = {
    "/intake": ("intake_officer",),
    "/reviews": ("case_lead",),
    "/ledger": ("auditor",),
    "/ledger/review": ("auditor",),
    "/audit/chain": ("auditor",),
}
PLAIN_ROUTES = ("/compartments", "/intake", "/reviews", "/ledger", "/ledger/review", "/audit/chain")


def honour_next(raw: str | None, role: str) -> str | None:
    if not isinstance(raw, str) or raw == "":
        return None
    path = unquote(raw)
    if not path.startswith("/") or path.startswith("//"):
        return None
    if any(ch in path for ch in ("\\", "%", "?", "#")):
        return None
    if any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in path):
        return None
    segments = path.split("/")[1:]
    if ".." in segments:
        return None
    shape_ok = False
    if path in PLAIN_ROUTES:
        shape_ok = True
    elif len(segments) == 2 and segments[0] in SEED_ID_SHAPES:
        shape_ok = bool(SEED_ID_SHAPES[segments[0]].match(segments[1]))
    if not shape_ok:
        return None
    allowed = ROLE_ROUTES.get(path)
    if allowed is not None and role not in allowed:
        return None
    return path


@route("/api/health", ["GET"], auth_required=False, denials=False)
def health(ctx: Context):
    if not db.is_ready():
        return 503, {"status": "starting"}
    return 200, {"status": "ok"}


@route("/api/status", ["GET"], auth_required=False, denials=False)
def status(ctx: Context):
    return 200, {
        "storage": "up" if storage.storage_up() else "down",
        "mail": "up" if mail.mail_up() else "down",
    }


@route("/api/sign-in", ["POST"], auth_required=False, json_body=True, denials=False)
def sign_in(ctx: Context):
    checker = FieldChecker(ctx.body)
    email = checker.free_text("email", maximum=320)
    password = checker.free_text("password", maximum=200)
    checker.done()
    user, session_id, cookie = auth.sign_in(email, password)
    landing = honour_next(ctx.body.get("next"), user["role"]) or landing_for(
        user["role"]
    )
    response = json_response(
        200,
        {
            "user": {"id": user["id"], "name": user["name"], "role": user["role"]},
            "session_id": session_id,
            "landing": landing,
        },
    )
    response.set_cookie(
        auth.SESSION_COOKIE,
        cookie,
        httponly=True,
        samesite="strict",
        path="/",
    )
    return response


@route("/api/sign-out", ["POST"], json_body=True, denials=False)
def sign_out(ctx: Context):
    with db.tx() as cur:
        auth.close_session(cur, ctx.session, "signed_out")
    response = Response(status_code=204, headers={"X-Content-Type-Options": "nosniff"})
    response.delete_cookie(auth.SESSION_COOKIE, path="/")
    return response


@route("/api/session", ["GET"], denials=False)
def session_state(ctx: Context):
    with db.tx() as cur:
        cur.execute(
            """
            SELECT compartment_id, expires_at FROM grants
            WHERE user_id = %s AND kind = 'break_glass' AND state = 'active'
              AND expires_at > now()
            ORDER BY compartment_id
            """,
            (ctx.user["id"],),
        )
        break_glass = [
            {
                "compartment_id": row["compartment_id"],
                "ends_at": format_time(row["expires_at"]),
            }
            for row in cur.fetchall()
        ]
    return 200, {
        "user": {
            "id": ctx.user["id"],
            "name": ctx.user["name"],
            "role": ctx.user["role"],
            "email": ctx.user["email"],
        },
        "session_id": ctx.session["id"],
        "server_time": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "break_glass": break_glass,
    }


@route("/api/step-up", ["POST"], json_body=True, denials=False)
def step_up(ctx: Context):
    checker = FieldChecker(ctx.body)
    password = checker.free_text("password", maximum=200)
    code = checker.free_text("code", maximum=20)
    checker.done()
    token, ttl = auth.create_step_up(ctx.user, ctx.session["id"], password, code)
    return 201, {"proof": token, "expires_in_seconds": ttl}


@route("/api/users/{id}/sessions/revoke", ["POST"], json_body=True)
def revoke_sessions(ctx: Context):
    person = ctx.param("id")
    with db.tx() as cur:
        row = None
        if person.text is not None:
            cur.execute("SELECT * FROM users WHERE id = %s", (person.text,))
            row = cur.fetchone()
        if row is None:
            raise ApiError("not_found", target=person.target)
        if ctx.user["role"] != ROLE_LEAD:
            raise ApiError("forbidden", target=person.target)
        cur.execute(
            """
            SELECT 1 FROM grants lead
            JOIN grants member ON member.compartment_id = lead.compartment_id
            WHERE lead.user_id = %s AND lead.kind = 'grant' AND lead.scope = 'full'
              AND lead.state = 'active' AND (lead.expires_at IS NULL OR lead.expires_at > now())
              AND member.user_id = %s AND member.state = 'active'
              AND (member.expires_at IS NULL OR member.expires_at > now())
            LIMIT 1
            """,
            (ctx.user["id"], person.text),
        )
        if cur.fetchone() is None:
            raise ApiError("forbidden", target=person.target)
    ctx.check_step_up()
    with db.tx() as cur:
        ctx.consume_proof(cur)
        revoked = auth.revoke_sessions(cur, person.text)
        ledger.append(
            cur,
            action="session.revoked",
            actor_id=ctx.user["id"],
            session_id=ctx.session["id"],
            target=person.text,
            detail={"revoked": revoked},
        )
    return 200, {"revoked": revoked}


@route("/api/directory", ["GET"])
def directory(ctx: Context):
    if ctx.user["role"] != ROLE_LEAD:
        raise ApiError("forbidden")
    with db.tx() as cur:
        cur.execute("SELECT id, name, role FROM users ORDER BY id")
        people = [dict(row) for row in cur.fetchall()]
    return 200, {"people": people}

"""Platform, session and directory endpoints."""
from __future__ import annotations

import datetime

from .. import ledger, security
from ..auth import Sessions
from ..db import as_utc_iso
from ..errors import (
    ApiError,
    REQUIRED,
    forbidden,
    not_found,
    sign_in_failed,
    step_up_required,
    unauthenticated,
    validation,
)
from ..domain import trim
from .base import db_ts
from .ctx import Ctx
from .serialisers import grant, person

LANDING = {
    "intake_officer": "/intake",
    "case_lead": "/compartments",
    "investigator": "/compartments",
    "auditor": "/ledger",
}

NEXT_SHAPES = (
    "/compartments", "/compartments/", "/exhibits/", "/releases/",
    "/intake", "/reviews", "/ledger", "/ledger/review", "/audit/chain",
)


def honours_next(path: str, role: str) -> bool:
    """The safe-return rule for `next` (DP-04)."""
    if path.startswith("/compartments/"):
        rest = path[len("/compartments/"):]
    elif path.startswith("/exhibits/"):
        rest = path[len("/exhibits/"):]
    elif path.startswith("/releases/"):
        rest = path[len("/releases/"):]
    elif path in ("/compartments", "/intake", "/reviews", "/ledger", "/ledger/review", "/audit/chain"):
        rest = None
    else:
        return False
    if rest is not None:
        if not rest or len(rest) > 20 or "/" in rest or not rest.replace("-", "").isalnum():
            return False
    if role == "intake_officer" and path != "/intake":
        return False
    if role == "case_lead" and path == "/intake":
        return False
    if role == "investigator" and path in ("/intake", "/reviews", "/ledger", "/ledger/review", "/audit/chain"):
        return False
    if role == "auditor" and path not in ("/ledger", "/ledger/review", "/audit/chain"):
        return False
    return True


async def sign_in(ctx: Ctx) -> dict:
    body = await ctx.request.json()
    if not isinstance(body, dict):
        raise validation({"body": REQUIRED})
    email = body.get("email")
    password = body.get("password")
    next_path = body.get("next")
    errors = {}
    if not isinstance(email, str) or not trim(email):
        errors["email"] = REQUIRED
    if not isinstance(password, str) or not password:
        errors["password"] = REQUIRED
    if errors:
        raise validation(errors)
    email = trim(email)
    if not _storable(email) or not _storable(password):
        raise sign_in_failed()
    sessions: Sessions = ctx.app.sessions
    user, token, session_id = sessions.sign_in(ctx.conn, email, password)
    landing = LANDING[user["role"]]
    if isinstance(next_path, str) and honours_next(next_path, user["role"]):
        landing = next_path
    resp = ctx.json(200, {
        "user": user,
        "session_id": session_id,
        "landing": landing,
    })
    resp.headers["set_cookie"] = (
        f"wardline_session={token}; Path=/; HttpOnly; SameSite=Strict"
    )
    return resp


def _storable(value: str) -> bool:
    for ch in value:
        code = ord(ch)
        if code < 0x20 and ch not in "\t\n":
            return False
        if code == 0x7F or 0xD800 <= code <= 0xDFFF:
            return False
    return True


async def sign_out(ctx: Ctx) -> object:
    if ctx.session is None:
        raise unauthenticated()
    cur = ctx.begin()
    ctx.app.sessions.close(cur, ctx.session_id, ctx.user_id, "signed_out")
    ctx.commit()
    resp = ctx.json(204, None)
    return resp


async def session_info(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise unauthenticated()
    with ctx.conn.cursor() as cur:
        cur.execute(
            "SELECT compartment_id, expires_at FROM grants "
            "WHERE user_id = %s AND kind = 'break_glass' AND state = 'active' "
            "AND expires_at > now()",
            (ctx.user_id,),
        )
        bg = [{"compartment_id": r[0], "ends_at": db_ts(r[1])} for r in cur.fetchall()]
    body = {
        "user": {"id": ctx.user["id"], "name": ctx.user["name"], "role": ctx.user["role"]},
        "session_id": ctx.session_id,
        "server_time": as_utc_iso(datetime.datetime.now(datetime.timezone.utc)),
        "break_glass": bg,
    }
    return ctx.json(200, body)


async def step_up(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise unauthenticated()
    body = await ctx.request.json()
    password = body.get("password")
    code = body.get("code")
    errors = {}
    if not isinstance(password, str) or not password:
        errors["password"] = REQUIRED
    if not isinstance(code, str) or not code:
        errors["code"] = REQUIRED
    if errors:
        raise validation(errors)
    proof = ctx.app.sessions.step_up(ctx.conn, ctx.session, password, code)
    return ctx.json(201, {"proof": proof, "expires_in_seconds": ctx.cfg.step_up_ttl})


async def revoke_sessions(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise unauthenticated()
    if ctx.role != "case_lead":
        cur = ctx.begin()
        ctx.deny(cur, "forbidden", ctx.request.url.path)
        ctx.commit()
        raise forbidden()
    target_id = ctx.request.scope['path_params']["id"]
    cur = ctx.begin()
    cur.execute("SELECT id FROM people WHERE id = %s", (target_id,))
    if not cur.fetchone():
        ctx.deny(cur, "not_found", target_id)
        ctx.commit()
        raise not_found()
    # a case lead may act only on someone sharing one of the lead's own
    # non-break-glass granted compartments (Sessions rule)
    cur.execute(
        "SELECT 1 FROM grants mine JOIN grants theirs "
        "ON mine.compartment_id = theirs.compartment_id "
        "WHERE mine.user_id = %s AND mine.kind = 'grant' AND mine.state = 'active' "
        "AND theirs.user_id = %s AND theirs.state = 'active' LIMIT 1",
        (ctx.user_id, target_id),
    )
    if not cur.fetchone():
        ctx.deny(cur, "forbidden", target_id)
        ctx.commit()
        raise forbidden()
    cur.execute(
        "UPDATE sessions SET closed = 'revoked' "
        "WHERE user_id = %s AND closed IS NULL", (target_id,)
    )
    ended = cur.rowcount
    ledger.append(cur, ctx.user_id, ctx.session_id, "session.revoked", target_id,
                  {"revoked": ended})
    ctx.commit()
    return ctx.json(200, {"revoked": ended})


async def directory(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise unauthenticated()
    if ctx.role != "case_lead":
        cur = ctx.begin()
        ctx.deny(cur, "forbidden", ctx.request.url.path)
        ctx.commit()
        raise forbidden()
    with ctx.conn.cursor() as cur:
        cur.execute("SELECT id, name, email, role FROM people ORDER BY id")
        people = [person(r) for r in cur.fetchall()]
    return ctx.json(200, {"people": people})


async def health(ctx: Ctx) -> dict:
    if not ctx.app.db_ready.is_set():
        return ctx.json(503, {"status": "starting"})
    return ctx.json(200, {"status": "ok"})


async def status(ctx: Ctx) -> dict:
    return ctx.json(200, {
        "storage": ctx.app.storage_status["storage"],
        "mail": ctx.app.storage_status["mail"],
    })

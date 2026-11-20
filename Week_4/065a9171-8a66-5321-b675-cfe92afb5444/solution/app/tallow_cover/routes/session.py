"""Health, sign-in, sessions and the caller's own profile."""

import asyncio
import secrets

from starlette.responses import Response

from .. import db, leave, workers
from ..access import BC, CW, UM
from ..config import settings
from ..errors import ApiError
from ..passwords import DECOY, verify
from ..web import COOKIE, PERSON_COLUMNS, Call, api, reply, token_hash

NAME_MAX = 60


async def me_body(conn, me) -> dict:
    credentialed = []
    if me["role"] == BC:
        credentialed = [r["home_id"] for r in await conn.fetch(
            "SELECT home_id FROM credentials WHERE person_id = $1 ORDER BY home_id", me["id"])]
    return {
        "id": me["id"], "email": me["email"], "display_name": me["display_name"], "role": me["role"],
        "home_id": me["home_id"], "unit_id": me["unit_id"], "skill": me["skill"],
        "credentialed_home_ids": credentialed,
        "holiday": await leave.holiday(conn, me["id"]) if me["role"] in (CW, UM) else None,
    }


@api("GET", "/api/health", public=True)
async def health(call: Call):
    await db.pool.fetchval("SELECT 1")
    return reply({"status": "ok", "mail": workers.health.mail, "storage": workers.health.storage})


@api("POST", "/api/session", public=True, keys=("email", "password"))
async def sign_in(call: Call):
    email, password = call.body.get("email"), call.body.get("password")
    async with db.pool.acquire() as conn:
        me = await conn.fetchrow(f"SELECT {PERSON_COLUMNS}, p.password_hash FROM people p WHERE lower(p.email) = $1",
                                 email.strip().lower() if isinstance(email, str) else "")
        matched = await asyncio.to_thread(verify, password if isinstance(password, str) else "",
                                          me["password_hash"] if me else DECOY)
        if not (me and matched):
            raise ApiError("invalid_credentials")
        call.fields().check()
        token = secrets.token_urlsafe(32)
        await conn.execute("DELETE FROM sessions WHERE expires_at <= now()")
        await conn.execute("INSERT INTO sessions (token_hash, person_id, expires_at)"
                           " VALUES ($1, $2, now() + make_interval(secs => $3))",
                           token_hash(token), me["id"], settings.session_ttl_seconds)
        response = reply({"user": await me_body(conn, me)})
    response.set_cookie(COOKIE, token, max_age=settings.session_ttl_seconds, path="/", httponly=True,
                        samesite="lax")
    return response


@api("DELETE", "/api/session")
async def sign_out(call: Call):
    await db.pool.execute("DELETE FROM sessions WHERE token_hash = $1", token_hash(call.request.cookies[COOKIE]))
    response = Response(status_code=204, headers={"Cache-Control": "no-store"})
    response.delete_cookie(COOKIE, path="/", httponly=True, samesite="lax")
    return response


@api("GET", "/api/me")
async def get_me(call: Call):
    async with db.pool.acquire() as conn:
        return reply(await me_body(conn, call.me))


@api("PATCH", "/api/me", keys=("display_name",))
async def patch_me(call: Call):
    name = call.body.get("display_name")
    fields = call.fields()
    if not isinstance(name, str) or not 1 <= len(name) <= NAME_MAX:
        fields.fail("display_name", "Use 1 to 60 characters.")
    fields.check()
    async with db.pool.acquire() as conn:
        me = await conn.fetchrow(f"UPDATE people p SET display_name = $2 WHERE p.id = $1 RETURNING {PERSON_COLUMNS}",
                                 call.me["id"], name)
        return reply(await me_body(conn, me))

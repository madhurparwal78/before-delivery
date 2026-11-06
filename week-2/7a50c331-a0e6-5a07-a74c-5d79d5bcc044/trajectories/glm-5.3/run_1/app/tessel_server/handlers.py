"""Every /api handler: one module, the envelope everywhere, refusals change nothing."""
import base64
import datetime
import hashlib
import hmac
import json
import math
import re
import secrets
import time
import uuid

import asyncpg
from aiohttp import web

from . import idem, routing, pricing
from .api import (Ctx, dispatch, fail, require_role, parse_body, authenticate,
                  key_query_limit)
from .domain import (get_database, db_status, require_ready, live_facts, active_at,
                     active_edges, display_names, relations_of, history_of)
from .envelope import error_response, json_api_response, NO_STORE, SECURITY_HEADERS
from .gql import run as gql_run
from .config import PUBLIC_URL
from .textutil import (ApiError, entity_key, nfc, cp_len, tokens, terms, now,
                       dt_to_str, parse_timestamp, verification_error, DB_NAME_RE,
                       SOURCE_ID_RE, PREDICATE_RE, TS_RE, valid_email, csv_join,
                       csv_neutralize, random_uuid, plan_limit, IDEM_KEY_RE,
                       query_terms_excluded, digest_token, check_storable)
from .validation import (require_object, get_str, get_int, get_timestamp,
                         check_all_strings)
from . import mail

SESSION_COOKIE = "tessel_session"


# ---------------------------------------------------------------- health

async def h_health(ctx):
    if ctx.app["db"]["pool"] is None:
        fail(503, "UNAVAILABLE", "The database is not reachable yet")
    await ctx.db.fetchval("SELECT 1")
    return ctx.json(data={"status": "ok"})


# ---------------------------------------------------------------- auth

def hash_password(pw):
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, 60000)
    return "pbkdf2$60000$" + salt.hex() + "$" + digest.hex()


def check_password(pw, stored):
    try:
        _, iters, salt_hex, digest_hex = stored.split("$")
        digest = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"),
                                     bytes.fromhex(salt_hex), int(iters))
        return hmac.compare_digest(digest.hex(), digest_hex)
    except Exception:
        return False


async def h_login(ctx):
    body = ctx.body
    require_object(body, {"email", "password", "totp", "recovery_code"})
    email = body.get("email")
    if not isinstance(email, str) or not valid_email(email):
        raise verification_error("email")
    email = email.strip().lower()
    password = body.get("password")
    if not isinstance(password, str) or not password:
        raise verification_error("password")
    totp = body.get("totp")
    recovery = body.get("recovery_code")
    if totp is not None and not isinstance(totp, str):
        raise verification_error("totp")
    if recovery is not None and not isinstance(recovery, str):
        raise verification_error("recovery_code")

    # 11. the sign-in pause, then the password, then the two-step code
    await check_signin_pause(ctx, email)

    member = await ctx.db.fetchrow(
        "SELECT m.id, m.email, m.role, m.password_hash, m.organization_id, "
        "o.name AS org_name, o.plan, t.secret, t.last_step, t.recovery_hash "
        "FROM app.members m JOIN app.organizations o ON o.id = m.organization_id "
        "LEFT JOIN app.members_totp t ON t.member_id = m.id "
        "WHERE lower(m.email) = $1", email)
    if member is None or not check_password(password, member["password_hash"]):
        await record_failed_signin(ctx, email)
        fail(401, "BAD_CREDENTIALS", "Email or password is incorrect")
    if member["secret"]:
        code = totp or recovery
        if code is None:
            fail(401, "TOTP_REQUIRED", "Enter the code from your authenticator app")
        if recovery is not None:
            if not await spend_recovery_code(ctx, member["id"], recovery):
                await record_failed_signin(ctx, email)
                fail(401, "BAD_TOTP", "That code is not valid")
        else:
            if not await check_totp(ctx, member, totp):
                await record_failed_signin(ctx, email)
                fail(401, "BAD_TOTP", "That code is not valid")
    await clear_signin_pause(ctx, email)
    token = secrets.token_urlsafe(32)
    digest = hashlib.sha256(("t1:" + token).encode("utf-8")).hexdigest()
    await ctx.db.execute(
        "INSERT INTO app.sessions (member_id, token_digest, created_at) VALUES ($1,$2,now())",
        member["id"], digest)
    return ctx.json(data={"token": token, "member": {
        "email": member["email"], "role": member["role"],
        "organization": {"name": member["org_name"], "plan": member["plan"]}}})


async def check_signin_pause(ctx, email):
    row = await ctx.db.fetchrow(
        "SELECT count, window_start FROM app.signin_attempts WHERE email = $1", email)
    if row is None:
        return
    elapsed = (now() - row["window_start"]).total_seconds()
    if elapsed >= 900:
        return
    if row["count"] >= 10:
        retry = max(1, min(900, int(900 - elapsed) + 1))
        fail(429, "SIGN_IN_THROTTLED",
             "Too many sign-in attempts. Try again in %d seconds." % retry,
             headers={"Retry-After": str(retry)})


async def record_failed_signin(ctx, email):
    db = ctx.db
    async with db.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                "SELECT count, window_start FROM app.signin_attempts WHERE email = $1 FOR UPDATE",
                email)
            t_now = now()
            if row is None:
                await conn.execute(
                    "INSERT INTO app.signin_attempts (email, count, window_start) "
                    "VALUES ($1, 1, $2)", email, t_now)
                return
            if (t_now - row["window_start"]).total_seconds() >= 900:
                await conn.execute(
                    "UPDATE app.signin_attempts SET count = 1, window_start = $2 "
                    "WHERE email = $1", email, t_now)
            else:
                await conn.execute(
                    "UPDATE app.signin_attempts SET count = count + 1 WHERE email = $1",
                    email)


async def clear_signin_pause(ctx, email):
    await ctx.db.execute("DELETE FROM app.signin_attempts WHERE email = $1", email)


async def check_totp(ctx, member, code):
    if not code or not re.match(r"^\d{6}$", code):
        return False
    row = await ctx.db.fetchrow(
        "SELECT last_step FROM app.members_totp WHERE member_id = $1", member["id"])
    step = totp_step(now())
    for delta in (-1, 0, 1):
        candidate = step + delta
        if candidate <= (row["last_step"] if row else -1):
            continue
        if totp_code(member["secret"], candidate) == code:
            await ctx.db.execute(
                "UPDATE app.members_totp SET last_step = $2 WHERE member_id = $1",
                member["id"], candidate)
            return True
    return False


def totp_step(t):
    return int(t.timestamp() // 30)


def totp_code(secret, step):
    key = base64.b32decode(secret.upper() + "=" * ((8 - len(secret) % 8) % 8))
    msg = step.to_bytes(8, "big")
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = (int.from_bytes(digest[offset:offset + 4], "big") & 0x7FFFFFFF) % 1000000
    return "%06d" % code


async def spend_recovery_code(ctx, member_id, code):
    digest = hashlib.sha256(("t1:" + code).encode("utf-8")).hexdigest()
    row = await ctx.db.fetchrow(
        "SELECT id FROM app.recovery_codes WHERE member_id = $1 AND digest = $2 AND used_at IS NULL",
        member_id, digest)
    if row is None:
        return False
    await ctx.db.execute(
        "UPDATE app.recovery_codes SET used_at = now() WHERE id = $1", row["id"])
    return True


async def h_logout(ctx):
    await ctx.db.execute(
        "UPDATE app.sessions SET revoked_at = now() WHERE id = $1", ctx.actor["session_id"])
    return ctx.json(data={})


async def h_logout_all(ctx):
    row = await ctx.db.fetchval(
        "SELECT count(*) FROM app.sessions WHERE member_id = $1 AND revoked_at IS NULL",
        ctx.actor["member_id"])
    await ctx.db.execute(
        "UPDATE app.sessions SET revoked_at = now() WHERE member_id = $1",
        ctx.actor["member_id"])
    await audit(ctx, "session.logout_all", ctx.actor["email"], str(row), "")
    return ctx.json(data={"revoked_sessions": row})


async def h_password(ctx):
    body = ctx.body
    require_object(body, {"current_password", "new_password"})
    current = body.get("current_password")
    new = body.get("new_password")
    if not isinstance(current, str) or not current:
        raise verification_error("current_password")
    if not isinstance(new, str) or cp_len(new) < 12:
        raise verification_error("new_password")
    row = await ctx.db.fetchrow(
        "SELECT password_hash FROM app.members WHERE id = $1", ctx.actor["member_id"])
    if not check_password(current, row["password_hash"]):
        fail(401, "BAD_CREDENTIALS", "Email or password is incorrect")
    if check_password(new, row["password_hash"]):
        raise verification_error("new_password")
    await ctx.db.execute(
        "UPDATE app.members SET password_hash = $2 WHERE id = $1",
        ctx.actor["member_id"], hash_password(new))
    other = await ctx.db.fetchval(
        "SELECT count(*) FROM app.sessions WHERE member_id = $1 AND revoked_at IS NULL "
        "AND id <> $2", ctx.actor["member_id"], ctx.actor["session_id"])
    await ctx.db.execute(
        "UPDATE app.sessions SET revoked_at = now() WHERE member_id = $1 AND id <> $2",
        ctx.actor["member_id"], ctx.actor["session_id"])
    await ctx.db.execute(
        "DELETE FROM app.reset_tokens WHERE member_id = $1 AND used_at IS NULL",
        ctx.actor["member_id"])
    await audit(ctx, "member.password", ctx.actor["email"], "", "")
    return ctx.json(data={"changed": True, "revoked_sessions": other})


async def h_forgot(ctx):
    body = ctx.body
    require_object(body, {"email"})
    email = body.get("email")
    if not isinstance(email, str) or not valid_email(email):
        raise verification_error("email")
    email = email.strip().lower()
    member = await ctx.db.fetchrow(
        "SELECT m.id, m.email FROM app.members m WHERE lower(m.email) = $1", email)
    if member is not None:
        sent = await ctx.db.fetchval(
            "SELECT count(*) FROM app.reset_emails WHERE member_id = $1 AND at > now() - interval '60 minutes'",
            member["id"])
        if sent < 3:
            token = secrets.token_hex(32)
            digest = hashlib.sha256(("t1:" + token).encode("utf-8")).hexdigest()
            async with ctx.db.acquire() as conn:
                async with conn.transaction():
                    await conn.execute(
                        "UPDATE app.reset_tokens SET used_at = now() "
                        "WHERE member_id = $1 AND used_at IS NULL", member["id"])
                    await conn.execute(
                        "INSERT INTO app.reset_tokens (member_id, digest, created_at) "
                        "VALUES ($1, $2, now())", member["id"], digest)
                    await conn.execute(
                        "INSERT INTO app.reset_emails (member_id, at) VALUES ($1, now())",
                        member["id"])
            from .config import PUBLIC_URL
            link = PUBLIC_URL + "/reset?token=" + token
            await mail.send(ctx.app, member["email"], "Reset your Tessel password",
                            link + "\n\nUse this link once to set a new Tessel password. "
                            "It ends every session of yours when used.")
    return ctx.json(data={"sent": True})


async def h_reset(ctx):
    body = ctx.body
    require_object(body, {"token", "password"})
    token = body.get("token")
    password = body.get("password")
    if not isinstance(token, str) or not token:
        raise verification_error("token")
    if not isinstance(password, str) or cp_len(password) < 12:
        raise verification_error("password")
    digest = hashlib.sha256(("t1:" + token).encode("utf-8")).hexdigest()
    row = await ctx.db.fetchrow(
        "SELECT r.id, r.member_id, r.used_at, m.email, m.organization_id "
        "FROM app.reset_tokens r JOIN app.members m ON m.id = r.member_id "
        "WHERE r.digest = $1", digest)
    if row is None or row["used_at"] is not None:
        fail(400, "RESET_TOKEN_INVALID", "This reset link is no longer valid")
    async with ctx.db.acquire() as conn:
        async with conn.transaction():
            await conn.execute("UPDATE app.reset_tokens SET used_at = now() WHERE id = $1",
                               row["id"])
            await conn.execute(
                "UPDATE app.members SET password_hash = $2 WHERE id = $1",
                row["member_id"], hash_password(password))
            await conn.execute(
                "UPDATE app.sessions SET revoked_at = now() WHERE member_id = $1 "
                "AND revoked_at IS NULL", row["member_id"])
            await conn.execute("DELETE FROM app.signin_attempts WHERE email = $1",
                               row["email"])
            rctx = conn_ctx(ctx, conn)
            rctx.db_org = row["organization_id"]
            rctx.db_email = row["email"]
            await audit(rctx, "member.password_reset", row["email"], "", actor=row["email"])
    await mail.send(ctx.app, row["email"], "Your Tessel password was reset",
                    "Your Tessel password was reset. If this was not you, contact your owner.")
    return ctx.json(data={"reset": True})


def conn_ctx(ctx, conn):
    c = object.__new__(Ctx)
    c.__dict__.update(ctx.__dict__)
    c.db = conn
    return c


async def audit(ctx, action, target, detail, actor=None):
    org = ctx.actor["organization_id"] if ctx.actor else ctx.db_org
    email = (actor or (ctx.actor or {}).get("email") or ctx.db_email)
    await ctx.db.execute(
        "INSERT INTO app.audit_events (organization_id, at, actor, action, target, detail) "
        "VALUES ($1, now(), $2, $3, $4, $5)",
        org, email, action, target, detail)


async def h_totp_setup(ctx):
    row = await ctx.db.fetchrow(
        "SELECT secret FROM app.members_totp WHERE member_id = $1", ctx.actor["member_id"])
    if row is not None and row["secret"] and await totp_on(ctx):
        fail(409, "TOTP_ALREADY_ON", "Two-step sign-in is already on")
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
    secret = "".join(secrets.choice(alphabet) for _ in range(32))
    await ctx.db.execute(
        "INSERT INTO app.members_totp (member_id, secret, last_step, recovery_hash) "
        "VALUES ($1, $2, -1, NULL) ON CONFLICT (member_id) DO UPDATE SET secret = $2",
        ctx.actor["member_id"], secret)
    from .config import PUBLIC_URL
    uri = "otpauth://totp/Tessel:%s?secret=%s&issuer=Tessel" % (ctx.actor["email"], secret)
    return ctx.json(data={"secret": secret, "otpauth_uri": uri})


async def totp_on(ctx):
    row = await ctx.db.fetchrow(
        "SELECT secret IS NOT NULL AND recovery_hash IS NOT NULL AS on_flag "
        "FROM app.members_totp WHERE member_id = $1", ctx.actor["member_id"])
    return bool(row and row["on_flag"])


async def h_totp_enable(ctx):
    body = ctx.body
    require_object(body, {"code"})
    code = body.get("code")
    if not isinstance(code, str):
        raise verification_error("code")
    if await totp_on(ctx):
        fail(409, "TOTP_ALREADY_ON", "Two-step sign-in is already on")
    row = await ctx.db.fetchrow(
        "SELECT secret FROM app.members_totp WHERE member_id = $1", ctx.actor["member_id"])
    if row is None or row["secret"] is None:
        fail(401, "BAD_TOTP", "That code is not valid")
    member = {"id": ctx.actor["member_id"], "secret": row["secret"]}
    if not await check_totp(ctx, member, code):
        fail(401, "BAD_TOTP", "That code is not valid")
    codes = []
    digests = []
    for _ in range(10):
        c = "%04x-%04x" % (secrets.randbits(16), secrets.randbits(16))
        codes.append(c)
        digests.append(hashlib.sha256(("t1:" + c).encode("utf-8")).hexdigest())
    recovery_hash = hashlib.sha256(("t1:" + "|".join(codes)).encode("utf-8")).hexdigest()
    async with ctx.db.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "UPDATE app.members_totp SET recovery_hash = $2 WHERE member_id = $1",
                ctx.actor["member_id"], recovery_hash)
            for d in digests:
                await conn.execute(
                    "INSERT INTO app.recovery_codes (member_id, digest) VALUES ($1, $2)",
                    ctx.actor["member_id"], d)
            await audit(conn_ctx(ctx, conn), "member.totp_on", ctx.actor["email"], "", "")
    return ctx.json(data={"enabled": True, "recovery_codes": codes})


async def h_totp_disable(ctx):
    body = ctx.body
    require_object(body, {"code"})
    code = body.get("code")
    if not isinstance(code, str):
        raise verification_error("code")
    if not await totp_on(ctx):
        fail(409, "TOTP_NOT_ON", "Two-step sign-in is off")
    member = await ctx.db.fetchrow(
        "SELECT id, secret FROM app.members WHERE id = $1", ctx.actor["member_id"])
    ok = await check_totp(ctx, member, code) or await spend_recovery_code(
        ctx, ctx.actor["member_id"], code)
    if not ok:
        fail(401, "BAD_TOTP", "That code is not valid")
    async with ctx.db.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "UPDATE app.members_totp SET secret = NULL, last_step = -1, "
                "recovery_hash = NULL WHERE member_id = $1", ctx.actor["member_id"])
            await conn.execute("DELETE FROM app.recovery_codes WHERE member_id = $1",
                               ctx.actor["member_id"])
            await audit(conn_ctx(ctx, conn), "member.totp_off", ctx.actor["email"], "", "")
    return ctx.json(data={"enabled": False})


async def h_me(ctx):
    row = await ctx.db.fetchrow(
        "SELECT m.email, m.role, o.name AS org, o.plan FROM app.members m "
        "JOIN app.organizations o ON o.id = m.organization_id WHERE m.id = $1",
        ctx.actor["member_id"])
    return ctx.json(data={"email": row["email"], "role": row["role"],
                          "organization": {"name": row["org"], "plan": row["plan"]}})


async def h_contact(ctx):
    body = ctx.body
    require_object(body, {"email", "message", "website"})
    email = body.get("email")
    message = body.get("message")
    website = body.get("website")
    if website is None:
        website = ""
    if not isinstance(website, str):
        raise verification_error("website")
    if not isinstance(email, str) or not valid_email(email):
        raise verification_error("email")
    if not isinstance(message, str) or not (10 <= cp_len(message) <= 4000):
        raise verification_error("message")
    if website:
        return ctx.json(status=201, data={"received": True})
    stored = await ctx.db.fetchval(
        "SELECT count(*) FROM app.contact_messages WHERE email = $1 "
        "AND created_at > now() - interval '60 minutes'", email)
    if stored >= 3:
        retry = 60
        fail(429, "RATE_LIMITED", "Too many requests. Try again in %d seconds." % retry,
             headers={"Retry-After": str(retry)})
    await ctx.db.execute(
        "INSERT INTO app.contact_messages (email, message, created_at) VALUES ($1,$2,now())",
        email, message)
    return ctx.json(status=201, data={"received": True})


async def h_code_host(ctx):
    from .config import FIXTURE_REPO
    try:
        with open(FIXTURE_REPO, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        data = {"full_name": "tessel-labs/tessel", "stargazers_count": 13062}
    return ctx.json(data={"full_name": data["full_name"],
                          "stargazers_count": data["stargazers_count"]})


# ---------------------------------------------------------------- v2 databases

async def h_databases_create(ctx):
    body = ctx.body
    require_object(body, {"name"})
    name = body.get("name")
    if not isinstance(name, str) or not DB_NAME_RE.match(name):
        raise verification_error("name")
    db = ctx.db
    plan = await db.fetchval(
        "SELECT plan FROM app.organizations WHERE id = $1", ctx.actor["organization_id"])
    async with db.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                "SELECT id FROM app.organizations WHERE id = $1 FOR UPDATE",
                ctx.actor["organization_id"])
            count = await conn.fetchval(
                "SELECT count(*) FROM app.databases WHERE organization_id = $1",
                ctx.actor["organization_id"])
            if count >= plan_limit(plan):
                fail(403, "PLAN_LIMIT",
                     "Your plan allows %d databases" % plan_limit(plan))
            try:
                row = await conn.fetchrow(
                    "INSERT INTO app.databases (organization_id, name, created_at, ready_at) "
                    "VALUES ($1, $2, now(), now() + interval '2 seconds') "
                    "RETURNING id, created_at", ctx.actor["organization_id"], name)
            except asyncpg.UniqueViolationError:
                fail(409, "DATABASE_ALREADY_EXISTS",
                     "A database with this name already exists")
            await conn.execute(
                "INSERT INTO app.collections (database_id, name) VALUES ($1, 'default')",
                row["id"])
            await audit(conn_ctx(ctx, conn), "database.create", name, "")
    return ctx.json(status=201, data={"name": name, "status": "provisioning",
                                     "created_at": dt_to_str(row["created_at"])})


async def h_databases_list(ctx):
    scope = ctx.actor["key_scope"]
    rows = await ctx.db.fetch(
        "SELECT name, created_at, ready_at, last_lsn, indexed_lsn, index_generation "
        "FROM app.databases WHERE organization_id = $1 ORDER BY name",
        ctx.actor["organization_id"])
    out = []
    for r in rows:
        if scope is not None and r["name"] not in scope:
            continue
        out.append({"name": r["name"], "status": db_status_row(r),
                    "last_lsn": r["last_lsn"], "indexed_lsn": r["indexed_lsn"],
                    "index_generation": r["index_generation"],
                    "created_at": dt_to_str(r["created_at"])})
    return ctx.json(data={"databases": out})


def db_status_row(row):
    return "provisioning" if now() < row["ready_at"] else "ready"


async def h_databases_delete(ctx):
    body = ctx.body
    require_object(body, {"database"})
    name = body.get("database")
    if not isinstance(name, str):
        raise verification_error("database")
    db = ctx.db
    async with db.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                "SELECT id FROM app.databases WHERE organization_id = $1 AND name = $2 FOR UPDATE",
                ctx.actor["organization_id"], name)
            if row is None:
                fail(404, "DATABASE_NOT_FOUND", "Database not found")
            await delete_database_rows(conn, row["id"])
            await audit(conn_ctx(ctx, conn), "database.delete", name, "")
    return ctx.json(data={"deleted": True})


async def delete_database_rows(conn, database_id):
    """Everything the database holds goes, except billed versions and audit events."""
    await conn.execute(
        "UPDATE app.source_versions SET database_id = NULL, collection = NULL, "
        "source_id = NULL, version = 0, lsn = 0 WHERE database_id = $1", database_id)
    await conn.execute(
        "DELETE FROM app.sources WHERE database_id = $1", database_id)
    await conn.execute("DELETE FROM app.facts WHERE database_id = $1", database_id)
    await conn.execute("DELETE FROM app.collections WHERE database_id = $1", database_id)
    await conn.execute("DELETE FROM app.wal_entries WHERE database_id = $1", database_id)
    await conn.execute(
        "DELETE FROM app.feedback WHERE organization_id = ("
        "  SELECT organization_id FROM app.databases WHERE id = $1) "
        "AND request_id IN (SELECT request_id FROM app.query_records WHERE database_id = $1)",
        database_id)
    await conn.execute("DELETE FROM app.query_records WHERE database_id = $1", database_id)
    await conn.execute(
        "DELETE FROM app.idempotency WHERE organization_id = ("
        "  SELECT organization_id FROM app.databases WHERE id = $1) AND database = ("
        "  SELECT name FROM app.databases WHERE id = $1)", database_id)
    await conn.execute("DELETE FROM app.export_jobs WHERE database_id = $1", database_id)
    await conn.execute("DELETE FROM app.databases WHERE id = $1", database_id)
    await conn.execute("DELETE FROM app.key_databases WHERE database_id = $1", database_id)


async def h_databases_status(ctx):
    name = ctx.query.get("database")
    if not name:
        raise verification_error("database")
    row = await get_database(ctx, name)
    ready = now() >= row["ready_at"]
    return ctx.json(data={"database": name, "status": db_status(row),
                          "infra": {"ready_for_ingestion": ready,
                                    "graph_status": db_status(row)}})


async def h_collections_list(ctx):
    name = ctx.query.get("database")
    if not name:
        raise verification_error("database")
    row = await get_database(ctx, name)
    rows = await ctx.db.fetch(
        "SELECT name FROM app.collections WHERE database_id = $1 ORDER BY name", row["id"])
    return ctx.json(data={"collections": [r["name"] for r in rows]})


async def h_collections_delete(ctx):
    body = ctx.body
    require_object(body, {"database", "name"})
    name = body.get("database")
    cname = body.get("name")
    if not isinstance(name, str):
        raise verification_error("database")
    if not isinstance(cname, str):
        raise verification_error("name")
    db = ctx.db
    async with db.acquire() as conn:
        async with conn.transaction():
            row = await get_database(conn_ctx(ctx, conn), name, for_update=True)
            if cname == "default":
                fail(409, "COLLECTION_IS_DEFAULT", "The default collection cannot be deleted")
            crow = await conn.fetchrow(
                "SELECT id FROM app.collections WHERE database_id = $1 AND name = $2",
                row["id"], cname)
            if crow is None:
                fail(404, "COLLECTION_NOT_FOUND", "Collection not found")
            live = await conn.fetchval(
                "SELECT count(*) FROM app.sources WHERE database_id = $1 AND collection = $2 "
                "AND live", row["id"], cname)
            if live:
                fail(409, "COLLECTION_NOT_EMPTY", "Delete the sources in this collection first")
            await conn.execute("DELETE FROM app.sources WHERE database_id = $1 AND collection = $2",
                               row["id"], cname)
            await conn.execute("DELETE FROM app.facts WHERE database_id = $1 AND source_id IN "
                               "(SELECT source_id FROM app.sources WHERE database_id = $1 AND collection = $2)",
                               row["id"], cname)
            await conn.execute("DELETE FROM app.collections WHERE id = $1", crow["id"])
    return ctx.json(data={"deleted": True})


async def h_databases_stats(ctx):
    name = ctx.query.get("database")
    if not name:
        raise verification_error("database")
    row = await get_database(ctx, name)
    sources = await ctx.db.fetchval(
        "SELECT count(*) FROM app.sources WHERE database_id = $1 AND live", row["id"])
    storage = await ctx.db.fetchval(
        "SELECT coalesce(sum(octet_length(title) + octet_length(text) + "
        "(SELECT count(*) FROM app.facts f WHERE f.database_id = s.database_id "
        " AND f.source_id = s.source_id AND f.source_live) * 64), 0) "
        "FROM app.sources s WHERE database_id = $1 AND live", row["id"])
    facts = await ctx.db.fetchval(
        "SELECT count(*) FROM app.facts WHERE database_id = $1 AND source_live", row["id"])
    entities = await ctx.db.fetchval(
        "SELECT count(*) FROM (SELECT subject_key FROM app.facts WHERE database_id = $1 "
        "AND source_live UNION SELECT object_key FROM app.facts WHERE database_id = $1 "
        "AND source_live) e", row["id"])
    tokens_total = await ctx.db.fetchval(
        "SELECT coalesce(sum(token_count), 0) FROM app.source_versions WHERE database_id = $1",
        row["id"])
    return ctx.json(data={
        "sources": sources, "facts": facts, "entities": entities,
        "last_lsn": row["last_lsn"], "indexed_lsn": row["indexed_lsn"],
        "wal_pending": row["last_lsn"] - row["indexed_lsn"],
        "index_generation": row["index_generation"],
        "tokens_ingested": tokens_total, "storage_bytes": storage})


async def h_compact(ctx):
    body = ctx.body
    require_object(body, {"database"})
    name = body.get("database")
    if not isinstance(name, str):
        raise verification_error("database")
    db = ctx.db
    async with db.acquire() as conn:
        async with conn.transaction():
            row = await get_database(conn_ctx(ctx, conn), name, for_update=True)
            require_ready(row)
            pending = row["last_lsn"] - row["indexed_lsn"]
            if pending > 0:
                await conn.execute(
                    "UPDATE app.databases SET indexed_lsn = $2, index_generation = $3 "
                    "WHERE id = $1", row["id"], row["last_lsn"],
                    row["index_generation"] + 1)
                return ctx.json(data={"generation": row["index_generation"] + 1,
                                      "folded_entries": pending,
                                      "indexed_lsn": row["last_lsn"]})
            return ctx.json(data={"generation": row["index_generation"],
                                  "folded_entries": 0,
                                  "indexed_lsn": row["indexed_lsn"]})


# ---------------------------------------------------------------- v2 context ingest

def validate_ingest_body(ctx):
    body = ctx.body
    require_object(body, {"database", "collection", "sources"})
    name = body.get("database")
    if not isinstance(name, str) or not name:
        raise verification_error("database")
    collection = body.get("collection")
    if collection is not None:
        if not isinstance(collection, str) or not DB_NAME_RE.match(collection):
            raise verification_error("collection")
    sources = body.get("sources")
    if not isinstance(sources, list) or not (1 <= len(sources) <= 50):
        raise verification_error("sources")
    prepared = []
    for i, src in enumerate(sources):
        base = "sources.%d" % i
        require_object(src, {"id", "title", "text", "if_version", "facts", "relations"},
                       field=base)
        sid = src.get("id")
        if sid is not None:
            if not isinstance(sid, str) or not SOURCE_ID_RE.match(sid):
                raise verification_error(base + ".id")
        title = src.get("title")
        if not isinstance(title, str) or not (1 <= cp_len(title) <= 200):
            raise verification_error(base + ".title")
        text = src.get("text")
        if not isinstance(text, str) or not (1 <= cp_len(text) <= 20000):
            raise verification_error(base + ".text")
        if_version = src.get("if_version")
        if if_version is not None:
            if isinstance(if_version, bool) or not isinstance(if_version, int) or if_version < 0:
                raise verification_error(base + ".if_version")
            if sid is None:
                raise verification_error(base + ".if_version")
        relations = src.get("relations")
        if relations is not None:
            if not isinstance(relations, dict):
                raise verification_error(base + ".relations")
            require_object(relations, {"ids"}, field=base + ".relations")
            ids = relations.get("ids")
            if not isinstance(ids, list) or not all(
                    isinstance(x, str) and SOURCE_ID_RE.match(x) for x in ids):
                raise verification_error(base + ".relations.ids")
        facts = src.get("facts")
        if not isinstance(facts, list) or not (0 <= len(facts) <= 50):
            raise verification_error(base + ".facts")
        prepared_facts = []
        for j, fact in enumerate(facts):
            fbase = "%s.facts.%d" % (base, j)
            require_object(fact, {"subject", "predicate", "object", "valid_from", "reason"},
                           field=fbase)
            subject = fact.get("subject")
            if not isinstance(subject, str):
                raise verification_error(fbase + ".subject")
            subject = subject.strip()
            if not (1 <= cp_len(subject) <= 80):
                raise verification_error(fbase + ".subject")
            predicate = fact.get("predicate")
            if not isinstance(predicate, str) or not PREDICATE_RE.match(predicate):
                raise verification_error(fbase + ".predicate")
            obj = fact.get("object")
            if not isinstance(obj, str):
                raise verification_error(fbase + ".object")
            obj = obj.strip()
            if not (1 <= cp_len(obj) <= 80):
                raise verification_error(fbase + ".object")
            valid_from = fact.get("valid_from")
            if not isinstance(valid_from, str) or not TS_RE.match(valid_from):
                raise verification_error(fbase + ".valid_from")
            vf = parse_timestamp(valid_from, fbase + ".valid_from")
            reason = fact.get("reason")
            if reason is None:
                reason = ""
            if not isinstance(reason, str) or cp_len(reason) > 280:
                raise verification_error(fbase + ".reason")
            prepared_facts.append((subject, predicate, obj, vf, reason))
        prepared.append({"id": sid, "title": title, "text": text,
                         "if_version": if_version, "facts": prepared_facts,
                         "collection": collection or "default"})
    return name, prepared


async def h_ingest(ctx):
    name, sources = validate_ingest_body(ctx)
    db = ctx.db
    async with db.acquire() as conn:
        async with conn.transaction():
            drow = await get_database(conn_ctx(ctx, conn), name, for_update=True)
            require_ready(drow)
            results = []
            for index, src in enumerate(sources):
                collection = src["collection"]
                await conn.execute(
                    "INSERT INTO app.collections (database_id, name) VALUES ($1, $2) "
                    "ON CONFLICT DO NOTHING", drow["id"], collection)
                existing = await conn.fetchrow(
                    "SELECT id, version, live FROM app.sources "
                    "WHERE database_id = $1 AND collection = $2 AND source_id = $3",
                    drow["id"], collection, src["id"] or "")
                lsn = drow["last_lsn"] + 1
                if existing is None:
                    version = 1
                    if src["if_version"] is not None and src["if_version"] != 0:
                        raise ApiError(409, "VERSION_CONFLICT",
                                       "Source %s is at version 0" % src["id"],
                                       "sources.%d.if_version" % index)
                    sid = src["id"] or ("src_" + secrets.token_hex(6))
                else:
                    if not existing["live"]:
                        highest = await conn.fetchval(
                            "SELECT coalesce(max(version), 0) FROM app.source_versions "
                            "WHERE database_id = $1 AND collection = $2 AND source_id = $3",
                            drow["id"], collection, src["id"])
                        version = highest + 1
                    else:
                        version = existing["version"] + 1
                    if src["if_version"] is not None:
                        live_version = existing["version"] if existing["live"] else 0
                        if src["if_version"] != live_version:
                            raise ApiError(409, "VERSION_CONFLICT",
                                           "Source %s is at version %d" % (src["id"], live_version),
                                           "sources.%d.if_version" % index)
                    sid = src["id"]
                token_count = len(tokens(src["title"] + " " + src["text"]))
                if existing is not None:
                    await conn.execute(
                        "UPDATE app.sources SET title = $2, text = $3, version = $4, "
                        "token_count = $5, ingested_at = now(), lsn = $6, live = true "
                        "WHERE id = $1", existing["id"],
                        src["title"], src["text"], version, token_count, lsn)
                else:
                    await conn.execute(
                        "INSERT INTO app.sources (database_id, collection, source_id, title, "
                        "text, version, token_count, ingested_at, lsn, live) "
                        "VALUES ($1,$2,$3,$4,$5,$6,$7,now(),$8,true)",
                        drow["id"], collection, sid, src["title"], src["text"],
                        version, token_count, lsn)
                await conn.execute(
                    "INSERT INTO app.source_versions (organization_id, database_id, collection, "
                    "source_id, version, lsn, token_count, ingested_at) "
                    "VALUES ($1,$2,$3,$4,$5,$6,$7,now())",
                    ctx.actor["organization_id"], drow["id"], collection, sid,
                    version, lsn, token_count)
                await conn.execute(
                    "INSERT INTO app.wal_entries (database_id, lsn, kind, source_id, created_at) "
                    "VALUES ($1,$2,'ingest',$3,now())", drow["id"], lsn, sid)
                for pos, (subject, predicate, obj, vf, reason) in enumerate(src["facts"]):
                    await conn.execute(
                        "INSERT INTO app.facts (database_id, lsn, position, source_id, subject, "
                        "subject_key, object, object_key, predicate, valid_from, reason, "
                        "source_live) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)",
                        drow["id"], lsn, pos, sid, subject, entity_key(subject),
                        obj, entity_key(obj), predicate, vf, reason)
                await conn.execute(
                    "UPDATE app.databases SET last_lsn = $2 WHERE id = $1", drow["id"], lsn)
                drow = await conn.fetchrow(
                    "SELECT * FROM app.databases WHERE id = $1", drow["id"])
                status = "graph_creation" if lsn > drow["indexed_lsn"] else "completed"
                results.append({"id": sid, "version": version, "lsn": lsn,
                                 "indexing_status": status})
            return ctx.json(status=201, data={"results": results})


async def h_source_status(ctx):
    name = ctx.query.get("database")
    collection = ctx.query.get("collection")
    ids = ctx.query.get("ids", "")
    if not name:
        raise verification_error("database")
    if not collection:
        raise verification_error("collection")
    id_list = [x.strip() for x in ids.split(",") if x.strip()]
    if not id_list:
        raise verification_error("ids")
    row = await get_database(ctx, name)
    out = []
    for sid in id_list:
        src = await ctx.db.fetchrow(
            "SELECT version, lsn FROM app.sources WHERE database_id = $1 "
            "AND collection = $2 AND source_id = $3", row["id"], collection, sid)
        if src is None:
            out.append({"id": sid, "indexing_status": "errored", "version": None,
                        "error_code": "FILE_NOT_FOUND",
                        "error_message": "No source with this id in this scope"})
        else:
            status = ("graph_creation" if src["lsn"] > row["indexed_lsn"] else "completed")
            out.append({"id": sid, "indexing_status": status, "version": src["version"]})
    return ctx.json(data={"statuses": out})


async def h_source_list(ctx):
    body = ctx.body
    require_object(body, {"database", "collection"})
    name = body.get("database")
    collection = body.get("collection")
    if not isinstance(name, str):
        raise verification_error("database")
    if not isinstance(collection, str):
        raise verification_error("collection")
    row = await get_database(ctx, name)
    rows = await ctx.db.fetch(
        "SELECT s.source_id, s.title, s.version, s.token_count, s.lsn, s.ingested_at, "
        "(SELECT count(*) FROM app.facts f WHERE f.database_id = s.database_id "
        " AND f.source_id = s.source_id AND f.source_live) AS facts "
        "FROM app.sources s WHERE s.database_id = $1 AND s.collection = $2 AND s.live "
        "ORDER BY s.source_id", row["id"], collection)
    out = []
    for r in rows:
        status = "graph_creation" if r["lsn"] > row["indexed_lsn"] else "completed"
        out.append({"id": r["source_id"], "title": r["title"], "version": r["version"],
                    "token_count": r["token_count"], "facts": r["facts"],
                    "indexing_status": status, "ingested_at": dt_to_str(r["ingested_at"])})
    return ctx.json(data={"sources": out})


async def h_source_get(ctx):
    name = ctx.query.get("database")
    collection = ctx.query.get("collection")
    sid = ctx.query.get("id")
    for field, value in (("database", name), ("collection", collection), ("id", sid)):
        if not value:
            raise verification_error(field)
    row = await get_database(ctx, name)
    src = await ctx.db.fetchrow(
        "SELECT * FROM app.sources WHERE database_id = $1 AND collection = $2 "
        "AND source_id = $3 AND live", row["id"], collection, sid)
    if src is None:
        fail(404, "SOURCE_NOT_FOUND", "Source not found")
    facts = await ctx.db.fetch(
        "SELECT subject, predicate, object, valid_from, reason FROM app.facts "
        "WHERE database_id = $1 AND source_id = $2 AND source_live "
        "ORDER BY lsn, position", row["id"], sid)
    status = "graph_creation" if src["lsn"] > row["indexed_lsn"] else "completed"
    etag = '"%d"' % src["version"]
    inm = ctx.request.headers.get("If-None-Match")
    if inm == etag:
        return web.Response(status=304, headers={"ETag": etag})
    data = {"id": sid, "collection": collection, "version": src["version"],
            "title": src["title"], "text": src["text"],
            "token_count": src["token_count"], "lsn": src["lsn"],
            "indexing_status": status, "ingested_at": dt_to_str(src["ingested_at"]),
            "facts": [{"subject": f["subject"], "predicate": f["predicate"],
                       "object": f["object"], "valid_from": dt_to_str(f["valid_from"]),
                       "reason": f["reason"]} for f in facts]}
    return ctx.json(data=data, headers={"ETag": etag})


async def h_source_delete(ctx):
    body = ctx.body
    require_object(body, {"database", "collection", "id"})
    name = body.get("database")
    collection = body.get("collection")
    sid = body.get("id")
    if not isinstance(name, str):
        raise verification_error("database")
    if not isinstance(collection, str):
        raise verification_error("collection")
    if not isinstance(sid, str):
        raise verification_error("id")
    db = ctx.db
    async with db.acquire() as conn:
        async with conn.transaction():
            drow = await get_database(conn_ctx(ctx, conn), name, for_update=True)
            src = await conn.fetchrow(
                "SELECT id FROM app.sources WHERE database_id = $1 AND collection = $2 "
                "AND source_id = $3 AND live FOR UPDATE",
                drow["id"], collection, sid)
            if src is None:
                fail(404, "SOURCE_NOT_FOUND", "Source not found")
            lsn = drow["last_lsn"] + 1
            await conn.execute(
                "UPDATE app.sources SET live = false WHERE id = $1", src["id"])
            await conn.execute(
                "UPDATE app.facts SET source_live = false WHERE database_id = $1 "
                "AND source_id = $2 AND source_live", drow["id"], sid)
            await conn.execute(
                "INSERT INTO app.wal_entries (database_id, lsn, kind, source_id, created_at) "
                "VALUES ($1,$2,'delete',$3,now())", drow["id"], lsn, sid)
            await conn.execute(
                "UPDATE app.databases SET last_lsn = $2 WHERE id = $1", drow["id"], lsn)
    return ctx.json(data={"deleted": True, "lsn": lsn})


async def h_source_restore(ctx):
    body = ctx.body
    require_object(body, {"database", "collection", "id"})
    name = body.get("database")
    collection = body.get("collection")
    sid = body.get("id")
    if not isinstance(name, str):
        raise verification_error("database")
    if not isinstance(collection, str):
        raise verification_error("collection")
    if not isinstance(sid, str):
        raise verification_error("id")
    db = ctx.db
    async with db.acquire() as conn:
        async with conn.transaction():
            drow = await get_database(conn_ctx(ctx, conn), name, for_update=True)
            src = await conn.fetchrow(
                "SELECT id FROM app.sources WHERE database_id = $1 AND collection = $2 "
                "AND source_id = $3 AND NOT live FOR UPDATE", drow["id"], collection, sid)
            if src is None:
                row = await conn.fetchrow(
                    "SELECT id FROM app.sources WHERE database_id = $1 AND collection = $2 "
                    "AND source_id = $3", drow["id"], collection, sid)
                if row is not None:
                    fail(409, "SOURCE_IS_LIVE", "Source %s is not deleted" % sid)
                fail(404, "SOURCE_NOT_FOUND", "Source not found")
            lsn = drow["last_lsn"] + 1
            await conn.execute(
                "UPDATE app.sources SET live = true, lsn = $2 WHERE id = $1",
                src["id"], lsn)
            await conn.execute(
                "UPDATE app.facts SET source_live = true WHERE database_id = $1 "
                "AND source_id = $2 AND NOT source_live", drow["id"], sid)
            await conn.execute(
                "INSERT INTO app.wal_entries (database_id, lsn, kind, source_id, created_at) "
                "VALUES ($1,$2,'restore',$3,now())", drow["id"], lsn, sid)
            await conn.execute(
                "UPDATE app.databases SET last_lsn = $2 WHERE id = $1", drow["id"], lsn)
            version = await conn.fetchval(
                "SELECT version FROM app.sources WHERE id = $1", src["id"])
    status = "graph_creation" if lsn > drow["indexed_lsn"] else "completed"
    return ctx.json(data={"id": sid, "version": version, "lsn": lsn,
                          "indexing_status": status})


# ---------------------------------------------------------------- relations, history, graph

def parse_as_of(ctx, optional=True):
    v = ctx.query.get("as_of")
    if v in (None, ""):
        return None
    if not TS_RE.match(v):
        raise verification_error("as_of")
    return parse_timestamp(v, "as_of")


async def h_relations(ctx):
    name = ctx.query.get("database")
    entity = ctx.query.get("entity")
    if not name:
        raise verification_error("database")
    if not entity:
        raise verification_error("entity")
    as_of = parse_as_of(ctx)
    row = await get_database(ctx, name)
    facts = await live_facts(ctx.db, row["id"])
    key = entity_key(entity.strip())
    out, inc = relations_of(facts, as_of or now(), key)
    displays = display_names(facts)

    def rel_json(r):
        return {"predicate": r["predicate"], "other": displays.get(r["other_key"], r["other"]),
                "valid_from": dt_to_str(r["valid_from"]), "reason": r["reason"],
                "source_id": r["source_id"]}
    return ctx.json(data={"entity": entity, "as_of": dt_to_str(as_of or now()),
                          "outgoing": [rel_json(r) for r in out],
                          "incoming": [rel_json(r) for r in inc]})


async def h_history(ctx):
    name = ctx.query.get("database")
    entity = ctx.query.get("entity")
    predicate = ctx.query.get("predicate")
    for field, value in (("database", name), ("entity", entity), ("predicate", predicate)):
        if not value:
            raise verification_error(field)
    if not PREDICATE_RE.match(predicate):
        raise verification_error("predicate")
    row = await get_database(ctx, name)
    facts = await live_facts(ctx.db, row["id"])
    key = entity_key(entity.strip())
    entries = history_of(facts, key, predicate)
    return ctx.json(data={"entity": entity, "predicate": predicate,
                         "facts": [{"object": e["object"],
                                    "valid_from": dt_to_str(e["valid_from"]),
                                    "superseded_at": dt_to_str(e["superseded_at"])
                                    if e["superseded_at"] else None,
                                    "reason": e["reason"], "source_id": e["source_id"],
                                    "lsn": e["lsn"]} for e in entries]})


async def h_graph(ctx):
    name = ctx.query.get("database")
    if not name:
        raise verification_error("database")
    as_of = parse_as_of(ctx)
    preds = ctx.query.get("predicates")
    pred_list = None
    if preds not in (None, ""):
        pred_list = [p.strip() for p in preds.split(",") if p.strip()]
        for p in pred_list:
            if not PREDICATE_RE.match(p):
                raise verification_error("predicates")
    row = await get_database(ctx, name)
    facts = await live_facts(ctx.db, row["id"])
    t = as_of or now()
    edges = active_edges(facts, t)
    if pred_list is not None:
        pred_set = set(pred_list)
        edges = [e for e in edges if e["predicate"] in pred_set]
    edges = edges[:1000]
    edges.sort(key=lambda e: (entity_key(e["subject"]), e["predicate"]))
    displays = display_names(facts)
    node_keys = set()
    for e in edges:
        node_keys.add(e["subject_key"])
        node_keys.add(e["object_key"])
    nodes = [displays.get(k, k) for k in sorted(node_keys)]
    return ctx.json(data={"as_of": dt_to_str(t), "nodes": nodes,
                          "edges": [{"subject": displays.get(e["subject_key"], e["subject"]),
                                     "predicate": e["predicate"],
                                     "object": displays.get(e["object_key"], e["object"]),
                                     "valid_from": dt_to_str(e["valid_from"]),
                                     "source_id": e["source_id"]} for e in edges]})


# ---------------------------------------------------------------- query

def score_sources(sources, query_terms_list, phrases, excluded):
    """The pinned BM25 keyword score over the latest version of every live source."""
    N = len(sources)
    if N == 0:
        return []
    doc_terms = []
    lengths = []
    for s in sources:
        t = terms(s["title"] + " " + s["text"])
        doc_terms.append(t)
        lengths.append(len(t))
    avgdl = sum(lengths) / N
    df = {}
    for t in doc_terms:
        for term in set(t):
            df[term] = df.get(term, 0) + 1
    results = []
    qterms = []
    for t in query_terms_list:
        if t not in qterms:
            qterms.append(t)
    for i, s in enumerate(sources):
        d = doc_terms[i]
        if any(x in d for x in excluded):
            continue
        ok = True
        for ph in phrases:
            want = terms(ph)
            if not want:
                continue
            found = False
            for j in range(len(d) - len(want) + 1):
                if d[j:j + len(want)] == want:
                    found = True
                    break
            if not found:
                ok = False
                break
        if not ok:
            continue
        score = 0.0
        for t in qterms:
            f = d.count(t)
            if f == 0:
                continue
            n = df.get(t, 0)
            idf = math.log(1 + (N - n + 0.5) / (n + 0.5))
            score += idf * f * 2.2 / (f + 1.2 * (0.25 + 0.75 * lengths[i] / avgdl))
        if score > 0:
            results.append((round_half_up(score, 4), s))
    results.sort(key=lambda x: (-x[0], x[1]["source_id"], x[1]["collection"]))
    return results


def round_half_up(v, digits):
    from decimal import Decimal, ROUND_HALF_UP
    q = Decimal(1).scaleb(-digits)
    return float(Decimal(repr(v)).quantize(q, rounding=ROUND_HALF_UP))


async def h_query(ctx):
    body = ctx.body
    require_object(body, {"database", "query_by", "query", "collections", "max_results",
                          "cypher", "as_of"})
    name = body.get("database")
    if not isinstance(name, str) or not name:
        raise verification_error("database")
    query_by = body.get("query_by")
    row = await get_database(ctx, name)
    db = ctx.db
    if query_by == "text":
        query = body.get("query")
        if not isinstance(query, str):
            raise verification_error("query")
        collections = body.get("collections")
        if collections is not None:
            if not isinstance(collections, list) or not collections or \
                    not all(isinstance(c, str) and c for c in collections):
                raise verification_error("collections")
        else:
            collections = ["default"]
        max_results = body.get("max_results")
        if max_results is None:
            max_results = 5
        if isinstance(max_results, bool) or not isinstance(max_results, int) or \
                not (1 <= max_results <= 20):
            raise verification_error("max_results")
        qterms, phrases, excluded = query_terms_excluded(query)
        if not qterms:
            raise verification_error("query")
        rows = await db.fetch(
            "SELECT source_id, title, text, collection FROM app.sources "
            "WHERE database_id = $1 AND live AND collection = ANY($2::text[])",
            row["id"], collections)
        sources = [{"source_id": r["source_id"], "title": r["title"], "text": r["text"],
                    "collection": r["collection"]} for r in rows]
        scored = score_sources(sources, qterms, phrases, excluded)
        out = []
        for sc, s in scored[:max_results]:
            out.append({"id": s["source_id"], "collection": s["collection"],
                        "title": s["title"], "score": sc,
                        "snippet": s["text"][:160]})
        request_id = await record_query(ctx, row["id"])
        return ctx.json(data={"results": out, "request_id": request_id},
                        headers={"X-Request-Id": request_id})
    if query_by == "cypher":
        cypher = body.get("cypher")
        if not isinstance(cypher, str) or not cypher:
            raise verification_error("cypher")
        as_of = body.get("as_of")
        t = now()
        if as_of is not None:
            if not isinstance(as_of, str) or not TS_RE.match(as_of):
                raise verification_error("as_of")
            t = parse_timestamp(as_of, "as_of")
        facts = await live_facts(db, row["id"])
        displays = display_names(facts)
        q, columns, rows = gql_run(cypher, facts, t, displays)
        request_id = await record_query(ctx, row["id"])
        return ctx.json(data={"columns": columns, "rows": rows,
                              "as_of": dt_to_str(t),
                              "served_from": {"index_generation": row["index_generation"],
                                              "indexed_lsn": row["indexed_lsn"],
                                              "wal_entries_applied":
                                                  row["last_lsn"] - row["indexed_lsn"]},
                              "request_id": request_id})
    raise verification_error("query_by")


async def record_query(ctx, database_id):
    rid = str(uuid.uuid4())
    await ctx.db.execute(
        "INSERT INTO app.query_records (request_id, organization_id, database_id, created_at) "
        "VALUES ($1, $2, $3, now())", rid, ctx.actor["organization_id"], database_id)
    return rid


# ---------------------------------------------------------------- feedback

async def h_feedback(ctx):
    body = ctx.body
    require_object(body, {"request_id", "feedback", "rating", "source", "ground_truth",
                         "metadata"})
    rid = body.get("request_id")
    if not isinstance(rid, str):
        raise verification_error("request_id")
    fb = body.get("feedback")
    ground_truth = body.get("ground_truth")
    if fb is None and ground_truth is None:
        raise verification_error("feedback")
    if fb is not None and (not isinstance(fb, str) or cp_len(fb) > 8000):
        raise verification_error("feedback")
    rating = body.get("rating")
    if rating is not None and rating not in ("positive", "negative", "neutral"):
        raise verification_error("rating")
    source = body.get("source")
    if source is not None and source not in ("user", "agent"):
        raise verification_error("source")
    if ground_truth is not None:
        if not isinstance(ground_truth, dict):
            raise verification_error("ground_truth")
        require_object(ground_truth, {"answer", "source_ids"}, field="ground_truth")
        answer = ground_truth.get("answer")
        if not isinstance(answer, str) or not (1 <= cp_len(answer) <= 8000):
            raise verification_error("ground_truth.answer")
        sids = ground_truth.get("source_ids")
        if not isinstance(sids, list) or not (1 <= len(sids) <= 20):
            raise verification_error("ground_truth.source_ids")
        seen = set()
        for i, sid in enumerate(sids):
            if not isinstance(sid, str) or not SOURCE_ID_RE.match(sid) or sid in seen:
                raise verification_error("ground_truth.source_ids.%d" % i)
            seen.add(sid)
    metadata = body.get("metadata")
    if metadata is not None:
        if not isinstance(metadata, dict):
            raise verification_error("metadata")
        if len(metadata) > 20:
            raise verification_error("metadata")
        for k, v in metadata.items():
            if not isinstance(k, str) or not re.match(r"^[A-Za-z0-9_-]{1,64}$", k):
                raise verification_error("metadata." + k)
            if not isinstance(v, str) or cp_len(v) > 500:
                raise verification_error("metadata." + k)
    check_all_strings(body)
    stored = await ctx.db.fetchval(
        "SELECT count(*) FROM app.feedback WHERE organization_id = $1 "
        "AND created_at > now() - interval '60 seconds'", ctx.actor["organization_id"])
    if stored >= 100:
        retry = 60
        fail(429, "RATE_LIMITED", "Too many requests. Try again in %d seconds." % retry,
             headers={"Retry-After": str(retry)})
    rec = await ctx.db.fetchrow(
        "SELECT 1 FROM app.query_records WHERE request_id = $1 AND organization_id = $2",
        rid, ctx.actor["organization_id"])
    if rec is None:
        fail(404, "REQUEST_NOT_FOUND", "No answered request has this id")
    await ctx.db.execute(
        "INSERT INTO app.feedback (request_id, organization_id, rating, feedback, source, "
        "ground_truth, metadata, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now())",
        rid, ctx.actor["organization_id"], rating, fb, source or "user",
        json.dumps(ground_truth) if ground_truth else None,
        json.dumps(metadata) if metadata else None)
    return ctx.json(status=201, data={"request_id": rid, "received": True})


# ---------------------------------------------------------------- members

async def h_members_list(ctx):
    rows = await ctx.db.fetch(
        "SELECT email, role FROM app.members WHERE organization_id = $1 ORDER BY email",
        ctx.actor["organization_id"])
    return ctx.json(data={"members": [{"email": r["email"], "role": r["role"]}
                                      for r in rows]})


async def h_members_add(ctx):
    body = ctx.body
    require_object(body, {"email", "role", "password"})
    email = body.get("email")
    role = body.get("role")
    password = body.get("password")
    if not isinstance(email, str) or not valid_email(email):
        raise verification_error("email")
    email = email.strip().lower()
    if role not in ("owner", "editor", "viewer"):
        raise verification_error("role")
    if not isinstance(password, str) or cp_len(password) < 12:
        raise verification_error("password")
    db = ctx.db
    async with db.acquire() as conn:
        async with conn.transaction():
            existing = await conn.fetchrow(
                "SELECT id FROM app.members WHERE lower(email) = $1", email)
            if existing is not None:
                fail(409, "MEMBER_EXISTS", "A member with this email already exists")
            await conn.execute(
                "INSERT INTO app.members (organization_id, email, role, password_hash, created_at) "
                "VALUES ($1,$2,$3,$4,now())", ctx.actor["organization_id"], email, role,
                hash_password(password))
            await audit(conn_ctx(ctx, conn), "member.add", email, role)
    org = await ctx.db.fetchval(
        "SELECT name FROM app.organizations WHERE id = $1", ctx.actor["organization_id"])
    await mail.send(ctx.app, email, "You have been added to %s on Tessel" % org,
                    "You have been added to %s on Tessel with the role %s.\n"
                    "Sign in at " % (org, role) + PUBLIC_URL + "/login\n")
    return ctx.json(status=201, data={"email": email, "role": role})


async def h_members_role(ctx):
    body = ctx.body
    require_object(body, {"role"})
    email = ctx.params["email"]
    role = body.get("role")
    if role not in ("owner", "editor", "viewer"):
        raise verification_error("role")
    db = ctx.db
    async with db.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                "SELECT id, role FROM app.members WHERE organization_id = $1 "
                "AND lower(email) = $2 FOR UPDATE", ctx.actor["organization_id"],
                email.lower())
            if row is None:
                fail(404, "MEMBER_NOT_FOUND", "Member not found")
            if row["role"] == role:
                return ctx.json(data={"email": email, "role": role})
            if row["role"] == "owner":
                owners = await conn.fetchval(
                    "SELECT count(*) FROM app.members WHERE organization_id = $1 "
                    "AND role = 'owner'", ctx.actor["organization_id"])
                if owners <= 1:
                    fail(409, "LAST_OWNER", "An organization needs at least one owner")
            await conn.execute("UPDATE app.members SET role = $2 WHERE id = $1",
                               row["id"], role)
            await audit(conn_ctx(ctx, conn), "member.role", email,
                        "%s -> %s" % (row["role"], role))
    return ctx.json(data={"email": email, "role": role})


async def h_members_remove(ctx):
    email = ctx.params["email"]
    db = ctx.db
    async with db.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                "SELECT id, role FROM app.members WHERE organization_id = $1 "
                "AND lower(email) = $2 FOR UPDATE", ctx.actor["organization_id"],
                email.lower())
            if row is None:
                fail(404, "MEMBER_NOT_FOUND", "Member not found")
            if row["role"] == "owner":
                owners = await conn.fetchval(
                    "SELECT count(*) FROM app.members WHERE organization_id = $1 "
                    "AND role = 'owner'", ctx.actor["organization_id"])
                if owners <= 1:
                    fail(409, "LAST_OWNER", "An organization needs at least one owner")
            await conn.execute(
                "UPDATE app.sessions SET revoked_at = now() WHERE member_id = $1 "
                "AND revoked_at IS NULL", row["id"])
            await conn.execute("DELETE FROM app.sessions WHERE member_id = $1", row["id"])
            await conn.execute("DELETE FROM app.members_totp WHERE member_id = $1", row["id"])
            await conn.execute("DELETE FROM app.recovery_codes WHERE member_id = $1", row["id"])
            await conn.execute("DELETE FROM app.reset_tokens WHERE member_id = $1", row["id"])
            await conn.execute("DELETE FROM app.reset_emails WHERE member_id = $1", row["id"])
            await conn.execute("DELETE FROM app.signin_attempts WHERE email = $1",
                               email.lower())
            await conn.execute("DELETE FROM app.members WHERE id = $1", row["id"])
            await audit(conn_ctx(ctx, conn), "member.remove", email, "")
    return ctx.json(data={"removed": True})


# ---------------------------------------------------------------- api keys

async def h_keys_list(ctx):
    rows = await ctx.db.fetch(
        "SELECT id, name, role, prefix, created_at, revoked_at FROM app.api_keys "
        "WHERE organization_id = $1 ORDER BY id", ctx.actor["organization_id"])
    return ctx.json(data={"keys": [
        {"id": r["id"], "name": r["name"], "role": r["role"], "prefix": r["prefix"],
         "created_at": dt_to_str(r["created_at"]),
         "revoked_at": dt_to_str(r["revoked_at"]) if r["revoked_at"] else None}
        for r in rows]})


async def h_keys_create(ctx):
    body = ctx.body
    require_object(body, {"name", "role", "databases"})
    name = body.get("name")
    role = body.get("role")
    if not isinstance(name, str) or not (1 <= cp_len(name) <= 60):
        raise verification_error("name")
    if role not in ("editor", "viewer"):
        raise verification_error("role")
    databases = body.get("databases")
    db = ctx.db
    scope_ids = None
    if databases is not None:
        if not isinstance(databases, list) or not (1 <= len(databases) <= 20):
            raise verification_error("databases")
        seen = set()
        ids = []
        for i, dname in enumerate(databases):
            if not isinstance(dname, str) or dname in seen:
                raise verification_error("databases.%d" % i)
            seen.add(dname)
            row = await db.fetchrow(
                "SELECT id FROM app.databases WHERE organization_id = $1 AND name = $2",
                ctx.actor["organization_id"], dname)
            if row is None:
                raise verification_error("databases.%d" % i)
            ids.append(row["id"])
        scope_ids = ids
    secret = "tsl_" + secrets.token_hex(20)
    digest = hashlib.sha256(("t1:" + secret).encode("utf-8")).hexdigest()
    async with db.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                "INSERT INTO app.api_keys (organization_id, name, role, prefix, secret_digest, "
                "created_at, scoped) VALUES ($1,$2,$3,$4,$5,now(),$6) RETURNING id",
                ctx.actor["organization_id"], name, role, secret[:12], digest,
                scope_ids is not None)
            for did in scope_ids or []:
                await conn.execute(
                    "INSERT INTO app.key_databases (api_key_id, database_id) VALUES ($1,$2)",
                    row["id"], did)
            await audit(conn_ctx(ctx, conn), "key.create", name, role)
    return ctx.json(status=201, data={"id": row["id"], "name": name, "role": role,
                                      "prefix": secret[:12], "secret": secret})


async def h_key_get(ctx):
    kid = ctx.params["id"]
    row = await ctx.db.fetchrow(
        "SELECT * FROM app.api_keys WHERE organization_id = $1 AND id = $2",
        ctx.actor["organization_id"], int(kid))
    if row is None:
        fail(404, "KEY_NOT_FOUND", "API key not found")
    if row["revoked_at"] is not None:
        databases = None
    elif not row["scoped"]:
        databases = None
    else:
        scope = await ctx.db.fetch(
            "SELECT d.name FROM app.key_databases kd JOIN app.databases d "
            "ON d.id = kd.database_id WHERE kd.api_key_id = $1 ORDER BY d.name", row["id"])
        databases = [r["name"] for r in scope]
    return ctx.json(data={"id": row["id"], "name": row["name"], "role": row["role"],
                          "prefix": row["prefix"], "databases": databases,
                          "created_at": dt_to_str(row["created_at"]),
                          "last_used_at": dt_to_str(row["last_used_at"])
                          if row["last_used_at"] else None,
                          "rotated_at": dt_to_str(row["rotated_at"])
                          if row["rotated_at"] else None,
                          "revoked_at": dt_to_str(row["revoked_at"])
                          if row["revoked_at"] else None})


async def h_key_delete(ctx):
    kid = ctx.params["id"]
    db = ctx.db
    async with db.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                "SELECT id, name, revoked_at FROM app.api_keys "
                "WHERE organization_id = $1 AND id = $2 FOR UPDATE",
                ctx.actor["organization_id"], int(kid))
            if row is None:
                fail(404, "KEY_NOT_FOUND", "API key not found")
            if row["revoked_at"] is not None:
                fail(409, "KEY_REVOKED", "This API key is revoked")
            await conn.execute(
                "UPDATE app.api_keys SET revoked_at = now() WHERE id = $1", row["id"])
            await audit(conn_ctx(ctx, conn), "key.revoke", row["name"], "")
    await mail.notify_owners(ctx.app, db, ctx.actor["organization_id"],
                            "API key revoked: %s" % row["name"],
                            lambda email: "The API key %s was revoked." % row["name"])
    return ctx.json(data={"revoked": True})


async def h_key_rotate(ctx):
    kid = ctx.params["id"]
    db = ctx.db
    async with db.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                "SELECT id, name, revoked_at FROM app.api_keys "
                "WHERE organization_id = $1 AND id = $2 FOR UPDATE",
                ctx.actor["organization_id"], int(kid))
            if row is None:
                fail(404, "KEY_NOT_FOUND", "API key not found")
            if row["revoked_at"] is not None:
                fail(409, "KEY_REVOKED", "This API key is revoked")
            secret = "tsl_" + secrets.token_hex(20)
            digest = hashlib.sha256(("t1:" + secret).encode("utf-8")).hexdigest()
            await conn.execute(
                "UPDATE app.api_keys SET secret_digest = $2, prefix = $3, rotated_at = now() "
                "WHERE id = $1", row["id"], digest, secret[:12])
            await audit(conn_ctx(ctx, conn), "key.rotate", row["name"], "")
    await mail.notify_owners(ctx.app, db, ctx.actor["organization_id"],
                            "API key rotated: %s" % row["name"],
                            lambda email: "The API key %s was rotated. Its old secret "
                                          "no longer works." % row["name"])
    return ctx.json(data={"id": int(kid), "prefix": secret[:12], "secret": secret})


# ---------------------------------------------------------------- plan and usage

async def h_plan_set(ctx):
    body = ctx.body
    require_object(body, {"plan"})
    plan = body.get("plan")
    if plan not in ("ship", "scale"):
        raise verification_error("plan")
    db = ctx.db
    async with db.acquire() as conn:
        async with conn.transaction():
            org = await conn.fetchrow(
                "SELECT id, name, plan FROM app.organizations WHERE id = $1 FOR UPDATE",
                ctx.actor["organization_id"])
            if org["plan"] == plan:
                return ctx.json(data={"plan": plan})
            if plan == "ship":
                count = await conn.fetchval(
                    "SELECT count(*) FROM app.databases WHERE organization_id = $1",
                    org["id"])
                if count > 3:
                    fail(409, "PLAN_DOWNGRADE_BLOCKED",
                         "Ship allows 3 databases. Delete databases before switching.")
            await conn.execute("UPDATE app.organizations SET plan = $2 WHERE id = $1",
                               org["id"], plan)
            await audit(conn_ctx(ctx, conn), "plan.change", org["name"],
                        "%s -> %s" % (org["plan"], plan))
            org_name = org["name"]
            old_plan = org["plan"]
    minimum = "25.00" if plan == "ship" else "300.00"
    await mail.notify_owners(
        ctx.app, db, ctx.actor["organization_id"],
        "Plan changed to %s" % ("Ship" if plan == "ship" else "Scale"),
        lambda email: "Your organization %s changed its plan to %s. The new minimum "
                      "is $%s per month." % (org_name,
                                             "Ship" if plan == "ship" else "Scale", minimum))
    return ctx.json(data={"plan": plan})


async def month_bounds():
    t = now()
    start = datetime.datetime(t.year, t.month, 1, tzinfo=datetime.timezone.utc)
    return start


async def h_usage(ctx):
    org = await ctx.db.fetchrow(
        "SELECT id, name, plan FROM app.organizations WHERE id = $1",
        ctx.actor["organization_id"])
    start = await month_bounds()
    month_tokens = await ctx.db.fetchval(
        "SELECT coalesce(sum(token_count), 0) FROM app.source_versions "
        "WHERE organization_id = $1 AND ingested_at >= $2", org["id"], start)
    storage = await ctx.db.fetchval(
        "SELECT coalesce(sum(octet_length(s.title) + octet_length(s.text) + "
        "(SELECT count(*) FROM app.facts f WHERE f.database_id = s.database_id "
        " AND f.source_id = s.source_id AND f.source_live) * 64), 0) "
        "FROM app.sources s JOIN app.databases d ON d.id = s.database_id "
        "WHERE d.organization_id = $1 AND s.live", org["id"])
    bill = pricing.bill_cents(month_tokens, storage, org["plan"])
    return ctx.json(data={"month": start.strftime("%Y-%m"), "plan": org["plan"],
                          "month_tokens": month_tokens, "storage_bytes": storage,
                          **bill})


async def h_usage_daily(ctx):
    org = await ctx.db.fetchrow(
        "SELECT id, plan FROM app.organizations WHERE id = $1",
        ctx.actor["organization_id"])
    start = await month_bounds()
    t = now()
    rows = await ctx.db.fetch(
        "SELECT date_trunc('day', ingested_at) AS day, sum(token_count) AS tokens "
        "FROM app.source_versions WHERE organization_id = $1 AND ingested_at >= $2 "
        "GROUP BY 1", org["id"], start)
    by_day = {r["day"].date().isoformat(): r["tokens"] for r in rows}
    days = []
    day = start.date()
    today = t.date()
    while day <= today:
        days.append({"day": day.isoformat(), "tokens": by_day.get(day.isoformat(), 0)})
        day += datetime.timedelta(days=1)
    return ctx.json(data={"month": start.strftime("%Y-%m"), "days": days})


# ---------------------------------------------------------------- audit

AUDIT_ACTIONS = ("database.create", "database.delete", "database.import", "member.add",
                 "member.role", "member.remove", "member.password", "member.password_reset",
                 "member.totp_on", "member.totp_off", "session.logout_all", "key.create",
                 "key.rotate", "key.revoke", "plan.change", "export.request")


async def h_audit(ctx):
    limit = ctx.query.get("limit")
    if limit is None:
        limit_n = 20
    else:
        try:
            limit_n = int(limit)
        except ValueError:
            raise verification_error("limit")
        if not (1 <= limit_n <= 100):
            raise verification_error("limit")
    action = ctx.query.get("action")
    if action:
        if action not in AUDIT_ACTIONS:
            raise verification_error("action")
    else:
        action = None
    actor = ctx.query.get("actor")
    fmt = ctx.query.get("format")
    accept = ctx.request.headers.get("Accept", "")
    want_csv = fmt == "csv" or "text/csv" in accept
    cursor = ctx.query.get("cursor")
    db = ctx.db
    where = ["organization_id = $1"]
    args = [ctx.actor["organization_id"]]
    if action:
        args.append(action)
        where.append("action = $%d" % len(args))
    if actor:
        args.append(actor.lower())
        where.append("lower(actor) = $%d" % len(args))
    if cursor:
        cur = decode_cursor(ctx, cursor)
        where.append("(at, id) < ($%d, $%d)" % (len(args) + 1, len(args) + 2))
        args.extend([cur["at"], cur["id"]])
    cond = " AND ".join(where)
    if want_csv:
        rows = await db.fetch(
            "SELECT id, at, actor, action, target, detail FROM app.audit_events "
            "WHERE %s ORDER BY at DESC, id DESC LIMIT 1000" % cond, *args)
        lines = ["id,at,actor,action,target,detail"]
        for r in rows:
            lines.append(csv_join([str(r["id"]), dt_to_str(r["at"]), r["actor"],
                                   r["action"], r["target"], r["detail"]]))
        body = "\n".join(lines) + "\n"
        return web.Response(text=body, content_type="text/csv", charset="utf-8",
                            headers=dict(NO_STORE))
    rows = await db.fetch(
        "SELECT id, at, actor, action, target, detail FROM app.audit_events "
        "WHERE %s ORDER BY at DESC, id DESC LIMIT %d" % (cond, limit_n + 1), *args)
    next_cursor = None
    if len(rows) > limit_n:
        rows = rows[:limit_n]
        last = rows[-1]
        next_cursor = encode_cursor({"at": dt_to_str(last["at"]), "id": last["id"]})
    events = [{"id": r["id"], "at": dt_to_str(r["at"]), "actor": r["actor"],
               "action": r["action"], "target": r["target"], "detail": r["detail"]}
              for r in rows]
    return ctx.json(data={"events": events, "next_cursor": next_cursor})


CURSOR_SALT = "tessel-audit-cursor"


def encode_cursor(payload):
    raw = json.dumps(payload, separators=(",", ":"))
    mac = hmac.new(CURSOR_SALT.encode(), raw.encode(), hashlib.sha256).hexdigest()[:16]
    return base64.urlsafe_b64encode(("%s|%s" % (mac, raw)).encode()).decode()


def decode_cursor(ctx, cursor):
    try:
        raw = base64.urlsafe_b64decode(cursor.encode()).decode()
        mac, payload = raw.split("|", 1)
        expect = hmac.new(CURSOR_SALT.encode(), payload.encode(),
                          hashlib.sha256).hexdigest()[:16]
        if not hmac.compare_digest(mac, expect):
            raise ValueError
        data = json.loads(payload)
        at = parse_timestamp(data["at"], "cursor")
        return {"at": at, "id": int(data["id"])}
    except ApiError:
        raise
    except Exception:
        fail(400, "INVALID_CURSOR", "This cursor is not valid")


# ---------------------------------------------------------------- export and import

async def h_export_request(ctx):
    body = ctx.body
    require_object(body, {"database"})
    name = body.get("database")
    if not isinstance(name, str):
        raise verification_error("database")
    db = ctx.db
    async with db.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                "SELECT id, last_lsn, ready_at FROM app.databases "
                "WHERE organization_id = $1 AND name = $2 FOR UPDATE",
                ctx.actor["organization_id"], name)
            if row is None:
                fail(404, "DATABASE_NOT_FOUND", "Database not found")
            require_ready(row)
            job_id = str(uuid.uuid4())
            await conn.execute(
                "INSERT INTO app.export_jobs (id, organization_id, database_id, "
                "database_name, lsn, requested_by, requested_at) "
                "VALUES ($1,$2,$3,$4,$5,$6,now())", job_id, ctx.actor["organization_id"],
                row["id"], name, row["last_lsn"], ctx.actor["email"])
            await audit(conn_ctx(ctx, conn), "export.request", name, "")
    return ctx.json(status=202, data={"job_id": job_id, "status": "queued",
                                      "database": name, "lsn": row["last_lsn"]})


def job_status(requested_at):
    """queued until 1s, running until 2s, then succeeded, by server time."""
    elapsed = (now() - requested_at).total_seconds()
    if elapsed < 1:
        return "queued", None
    if elapsed < 2:
        return "running", None
    return "succeeded", requested_at.replace(microsecond=0) + datetime.timedelta(seconds=2)


async def h_job_get(ctx):
    job_id = ctx.params["id"]
    row = await ctx.db.fetchrow(
        "SELECT * FROM app.export_jobs WHERE organization_id = $1 AND id = $2",
        ctx.actor["organization_id"], job_id)
    if row is None:
        fail(404, "JOB_NOT_FOUND", "Job not found")
    status, finished_at = job_status(row["requested_at"])
    result = None
    if status == "succeeded":
        doc = await build_export(ctx.db, row)
        digest = hashlib.sha256(json.dumps(doc, sort_keys=True, ensure_ascii=False)
                                .encode("utf-8")).hexdigest()
        result = {"collections": len(doc["collections"]),
                  "sources": sum(len(c["sources"]) for c in doc["collections"]),
                  "facts": sum(len(s["facts"]) for c in doc["collections"]
                               for s in c["sources"]),
                  "sha256": digest}
        finished_at = row["requested_at"] + datetime.timedelta(seconds=2)
    return ctx.json(data={"job_id": str(row["id"]), "kind": "export",
                          "database": row["database_name"], "status": status,
                          "lsn": row["lsn"], "requested_at": dt_to_str(row["requested_at"]),
                          "finished_at": dt_to_str(finished_at) if finished_at else None,
                          "result": result})


async def build_export(db, job):
    """Snapshot every live source of the job's database at its lsn."""
    cols = await db.fetch(
        "SELECT name FROM app.collections WHERE database_id = $1 ORDER BY name", job["database_id"])
    out = []
    for c in cols:
        sources = await db.fetch(
            "SELECT source_id, version, title, text FROM app.sources "
            "WHERE database_id = $1 AND collection = $2 AND live ORDER BY source_id",
            job["database_id"], c["name"])
        slist = []
        for s in sources:
            facts = await db.fetch(
                "SELECT subject, predicate, object, valid_from, reason FROM app.facts "
                "WHERE database_id = $1 AND source_id = $2 AND lsn <= $3 "
                "ORDER BY lsn, position", job["database_id"], s["source_id"], job["lsn"])
            slist.append({"id": s["source_id"], "version": s["version"],
                          "title": s["title"], "text": s["text"],
                          "facts": [{"subject": f["subject"], "predicate": f["predicate"],
                                     "object": f["object"],
                                     "valid_from": dt_to_str(f["valid_from"]),
                                     "reason": f["reason"]} for f in facts]})
        out.append({"name": c["name"], "sources": slist})
    return {"database": job["database_name"], "lsn": job["lsn"], "collections": out}


async def h_job_download(ctx):
    job_id = ctx.params["id"]
    row = await ctx.db.fetchrow(
        "SELECT * FROM app.export_jobs WHERE organization_id = $1 AND id = $2",
        ctx.actor["organization_id"], job_id)
    if row is None:
        fail(404, "JOB_NOT_FOUND", "Job not found")
    status, _ = job_status(row["requested_at"])
    if status != "succeeded":
        fail(409, "JOB_NOT_FINISHED", "This export is not finished")
    doc = await build_export(ctx.db, row)
    digest = hashlib.sha256(json.dumps(doc, sort_keys=True, ensure_ascii=False)
                            .encode("utf-8")).hexdigest()
    etag = '"%s"' % digest
    if ctx.request.headers.get("If-None-Match") == etag:
        return web.Response(status=304, headers={"ETag": etag})
    body = json.dumps({"database": doc["database"], "lsn": doc["lsn"],
                       "collections": doc["collections"]}, ensure_ascii=False)
    hdrs = {"ETag": etag, "Content-Disposition":
            'attachment; filename="%s-export.json"' % row["database_name"]}
    return web.json_response(json.loads(body), headers=hdrs)


# ---------------------------------------------------------------- import

async def h_import(ctx):
    body = ctx.body
    require_object(body, {"name", "document"})
    name = body.get("name")
    document = body.get("document")
    if not isinstance(name, str) or not DB_NAME_RE.match(name):
        raise verification_error("name")
    if not isinstance(document, dict):
        raise verification_error("document")
    require_object(document, {"database", "lsn", "collections"}, field="document")
    collections = document.get("collections")
    if not isinstance(collections, list) or not (1 <= len(collections) <= 20):
        raise verification_error("document.collections")
    seen_collections = set()
    prepared = []
    total_sources = 0
    for ci, col in enumerate(collections):
        cbase = "document.collections.%d" % ci
        require_object(col, {"name", "sources"}, field=cbase)
        cname = col.get("name")
        if not isinstance(cname, str) or not DB_NAME_RE.match(cname):
            raise verification_error(cbase + ".name")
        if cname in seen_collections:
            raise verification_error(cbase + ".name")
        seen_collections.add(cname)
        sources = col.get("sources")
        if not isinstance(sources, list):
            raise verification_error(cbase + ".sources")
        total_sources += len(sources)
        if total_sources > 50:
            raise verification_error(cbase + ".sources")
        seen_ids = set()
        pre_sources = []
        for si, src in enumerate(sources):
            sbase = "%s.sources.%d" % (cbase, si)
            require_object(src, {"id", "version", "title", "text", "facts"}, field=sbase)
            sid = src.get("id")
            if not isinstance(sid, str) or not SOURCE_ID_RE.match(sid):
                raise verification_error(sbase + ".id")
            if sid in seen_ids:
                raise verification_error(sbase + ".id")
            seen_ids.add(sid)
            version = src.get("version")
            if isinstance(version, bool) or not isinstance(version, int) or version < 1:
                raise verification_error(sbase + ".version")
            title = src.get("title")
            if not isinstance(title, str) or not (1 <= cp_len(title) <= 200):
                raise verification_error(sbase + ".title")
            text = src.get("text")
            if not isinstance(text, str) or not (1 <= cp_len(text) <= 20000):
                raise verification_error(sbase + ".text")
            facts = src.get("facts")
            if not isinstance(facts, list) or not (0 <= len(facts) <= 50):
                raise verification_error(sbase + ".facts")
            pre_facts = []
            for fi, fact in enumerate(facts):
                fbase = "%s.facts.%d" % (sbase, fi)
                require_object(fact, {"subject", "predicate", "object", "valid_from",
                                      "reason"}, field=fbase)
                subject = fact.get("subject")
                if not isinstance(subject, str):
                    raise verification_error(fbase + ".subject")
                subject = subject.strip()
                if not (1 <= cp_len(subject) <= 80):
                    raise verification_error(fbase + ".subject")
                predicate = fact.get("predicate")
                if not isinstance(predicate, str) or not PREDICATE_RE.match(predicate):
                    raise verification_error(fbase + ".predicate")
                obj = fact.get("object")
                if not isinstance(obj, str):
                    raise verification_error(fbase + ".object")
                obj = obj.strip()
                if not (1 <= cp_len(obj) <= 80):
                    raise verification_error(fbase + ".object")
                valid_from = fact.get("valid_from")
                if not isinstance(valid_from, str) or not TS_RE.match(valid_from):
                    raise verification_error(fbase + ".valid_from")
                vf = parse_timestamp(valid_from, fbase + ".valid_from")
                reason = fact.get("reason")
                if reason is None:
                    reason = ""
                if not isinstance(reason, str) or cp_len(reason) > 280:
                    raise verification_error(fbase + ".reason")
                pre_facts.append((subject, predicate, obj, vf, reason))
            pre_sources.append({"id": sid, "title": title, "text": text,
                                "facts": pre_facts})
        prepared.append({"name": cname, "sources": pre_sources})
    check_all_strings(document, "document")

    db = ctx.db
    async with db.acquire() as conn:
        async with conn.transaction():
            plan = await conn.fetchval(
                "SELECT plan FROM app.organizations WHERE id = $1",
                ctx.actor["organization_id"])
            await conn.execute("SELECT id FROM app.organizations WHERE id = $1 FOR UPDATE",
                               ctx.actor["organization_id"])
            count = await conn.fetchval(
                "SELECT count(*) FROM app.databases WHERE organization_id = $1",
                ctx.actor["organization_id"])
            if count >= plan_limit(plan):
                fail(403, "PLAN_LIMIT", "Your plan allows %d databases" % plan_limit(plan))
            try:
                drow = await conn.fetchrow(
                    "INSERT INTO app.databases (organization_id, name, created_at, ready_at) "
                    "VALUES ($1, $2, now(), now() + interval '2 seconds') "
                    "RETURNING id, created_at", ctx.actor["organization_id"], name)
            except asyncpg.UniqueViolationError:
                fail(409, "DATABASE_ALREADY_EXISTS",
                     "A database with this name already exists")
            await conn.execute(
                "INSERT INTO app.collections (database_id, name) VALUES ($1, 'default')",
                drow["id"])
            lsn = 0
            fact_count = 0
            for col in prepared:
                await conn.execute(
                    "INSERT INTO app.collections (database_id, name) VALUES ($1, $2) "
                    "ON CONFLICT DO NOTHING", drow["id"], col["name"])
                for src in col["sources"]:
                    lsn += 1
                    token_count = len(tokens(src["title"] + " " + src["text"]))
                    await conn.execute(
                        "INSERT INTO app.sources (database_id, collection, source_id, title, "
                        "text, version, token_count, ingested_at, lsn, live) "
                        "VALUES ($1,$2,$3,$4,$5,1,$6,now(),$7,true)",
                        drow["id"], col["name"], src["id"], src["title"], src["text"],
                        token_count, lsn)
                    await conn.execute(
                        "INSERT INTO app.source_versions (organization_id, database_id, "
                        "collection, source_id, version, lsn, token_count, ingested_at) "
                        "VALUES ($1,$2,$3,$4,1,$5,$6,now())",
                        ctx.actor["organization_id"], drow["id"], col["name"], src["id"],
                        lsn, token_count)
                    await conn.execute(
                        "INSERT INTO app.wal_entries (database_id, lsn, kind, source_id, "
                        "created_at) VALUES ($1,$2,'ingest',$3,now())",
                        drow["id"], lsn, src["id"])
                    for pos, (subject, predicate, obj, vf, reason) in enumerate(src["facts"]):
                        await conn.execute(
                            "INSERT INTO app.facts (database_id, lsn, position, source_id, "
                            "subject, subject_key, object, object_key, predicate, valid_from, "
                            "reason, source_live) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)",
                            drow["id"], lsn, pos, src["id"], subject, entity_key(subject),
                            obj, entity_key(obj), predicate, vf, reason)
                    fact_count += len(src["facts"])
            await conn.execute(
                "UPDATE app.databases SET last_lsn = $2 WHERE id = $1", drow["id"], lsn)
            await audit(conn_ctx(ctx, conn), "database.import", name, str(len(prepared) and
                        sum(len(c["sources"]) for c in prepared)))
    return ctx.json(status=201, data={"name": name, "status": "provisioning",
                                      "created_at": dt_to_str(drow["created_at"]),
                                      "sources": sum(len(c["sources"]) for c in prepared),
                                      "facts": fact_count})

"""Health, the code host mock, sign-in and sessions, password reset, two-step sign-in, contact, members, API keys,
the plan, usage and the audit log."""
import base64
import binascii
import hashlib
import json
import math
from datetime import timedelta

from starlette.responses import Response

from . import api, billing, config, db, mail, security, text, writelog
from .api import Answer, Ctx, route
from .fields import EMAIL, DATABASE_REF, Enum, List, Obj, Str, validate
from .refusals import ApiError, invalid

SIGN_IN_FAILURES, SIGN_IN_WINDOW = 10, timedelta(minutes=15)
RESET_EMAILS_PER_HOUR = 3
CONTACT_PER_HOUR = 3
AUDIT_ACTIONS = ("database.create", "database.delete", "database.import", "member.add", "member.role",
                 "member.remove", "member.password", "member.password_reset", "member.totp_on", "member.totp_off",
                 "session.logout_all", "key.create", "key.rotate", "key.revoke", "plan.change", "export.request")
CSV_COLUMNS = ("id", "at", "actor", "action", "target", "detail")
CSV_FORMULA_START = ("=", "+", "-", "@", "\t", "\r")
NEW_PASSWORD = Str(12, 1024, message="Choose a password of at least 12 characters")
EMAIL_SPEC = Str(3, 320, pattern=EMAIL, message="Enter a valid email address")


@route("GET", "/api/health", "anyone")
def health(ctx: Ctx):
    ctx.tx.run("SELECT 1")
    return Answer({"status": "ok"})


@route("GET", "/api/code-host/repo", "anyone")
def code_host_repo(ctx: Ctx):
    saved = json.loads(config.CODE_HOST_FIXTURE.read_text())
    return Answer({"full_name": saved["full_name"], "stargazers_count": saved["stargazers_count"]})


# ---- signing in ---------------------------------------------------------------------------------

def _fail(t: db.Tx, email: str, code: str):
    t.run("INSERT INTO sign_in_failures (email) VALUES (:e)", e=email)
    raise ApiError(code, commit=True)


def sign_in(t: db.Tx, email: str, password: str, code: str | None, recovery: str | None) -> tuple[str, dict]:
    """The pause, then the password, then the two-step code; answers alike for unknown and removed emails."""
    email = email.strip().lower()
    recent = t.rows("SELECT at FROM sign_in_failures WHERE email = :e AND at > clock_timestamp() - interval '15 minutes' "
                    "ORDER BY at DESC LIMIT :n", e=email, n=SIGN_IN_FAILURES)
    if len(recent) >= SIGN_IN_FAILURES:
        n = max(1, min(900, math.ceil((recent[-1]["at"] + SIGN_IN_WINDOW - text.now()).total_seconds())))
        raise ApiError("SIGN_IN_THROTTLED", headers={"Retry-After": str(n)}, n=n)
    member = t.one("SELECT m.*, o.name AS org_name, o.plan FROM members m JOIN organizations o ON o.id = m.organization_id "
                   "WHERE m.email = :e FOR UPDATE OF m", e=email)
    if not member or not security.check_password(password, member["password_hash"]):
        _fail(t, email, "BAD_CREDENTIALS")
    if member["totp_enabled"]:
        if not code and not recovery:
            raise ApiError("TOTP_REQUIRED")
        step = security.totp_match(member["totp_secret"], code.strip(), member["totp_last_step"]) if code else None
        if step is not None:
            t.run("UPDATE members SET totp_last_step = :s WHERE id = :m", s=step, m=member["id"])
        elif not (recovery and _spend_recovery_code(t, member["id"], recovery)):
            _fail(t, email, "BAD_TOTP")
    token = security.session_token()
    t.run("DELETE FROM sign_in_failures WHERE email = :e", e=email)
    t.run("INSERT INTO sessions (member_id, token_digest) VALUES (:m, :d)", m=member["id"], d=security.digest(token))
    return token, member


def _spend_recovery_code(t: db.Tx, member_id: int, code: str) -> bool:
    return bool(t.one("UPDATE recovery_codes SET used_at = clock_timestamp() WHERE member_id = :m AND digest = :d AND "
                      "used_at IS NULL RETURNING 1 AS x", m=member_id, d=security.digest(code.strip().lower())))


LOGIN = Obj({"email": (Str(0, 320), True), "password": (Str(0, 1024), True),
             "totp": (Str(0, 64, nullable=True), False), "recovery_code": (Str(0, 64, nullable=True), False)})


@route("POST", "/api/auth/login", "anyone", body=True)
def login(ctx: Ctx):
    body = validate(LOGIN, ctx.body)
    token, m = sign_in(ctx.tx, body["email"], body["password"], body.get("totp"), body.get("recovery_code"))
    return Answer({"token": token, "member": {"email": m["email"], "role": m["role"],
                                              "organization": {"name": m["org_name"], "plan": m["plan"]}}})


@route("POST", "/api/auth/logout", "session")
def logout(ctx: Ctx):
    end_session(ctx.tx, ctx.principal.session_id)
    return Answer({})


def end_session(t: db.Tx, session_id: int) -> None:
    t.run("UPDATE sessions SET revoked_at = clock_timestamp() WHERE id = :s AND revoked_at IS NULL", s=session_id)


@route("POST", "/api/auth/logout-all", "session")
def logout_all(ctx: Ctx):
    p, t = ctx.principal, ctx.tx
    n = len(t.rows("UPDATE sessions SET revoked_at = clock_timestamp() WHERE member_id = :m AND revoked_at IS NULL "
                   "RETURNING id", m=p.member_id))
    api.audit(t, p.org_id, p.email, "session.logout_all", p.email, str(n))
    return Answer({"revoked_sessions": n})


@route("GET", "/api/me", "session")
def me(ctx: Ctx):
    p = ctx.principal
    return Answer({"email": p.email, "role": p.role, "organization": {"name": p.org_name, "plan": p.plan}})


PASSWORD = Obj({"current_password": (Str(0, 1024), True), "new_password": (NEW_PASSWORD, True)})


@route("POST", "/api/auth/password", "session", body=True)
def change_password(ctx: Ctx):
    body = validate(PASSWORD, ctx.body)
    p, t = ctx.principal, ctx.tx
    current = t.one("SELECT password_hash FROM members WHERE id = :m FOR UPDATE", m=p.member_id)
    if not security.check_password(body["current_password"], current["password_hash"]):
        raise ApiError("BAD_CREDENTIALS")
    if body["new_password"] == body["current_password"]:
        raise invalid("new_password", "Choose a password different from the current one")
    t.run("UPDATE members SET password_hash = :h WHERE id = :m", h=security.hash_password(body["new_password"]),
          m=p.member_id)
    n = len(t.rows("UPDATE sessions SET revoked_at = clock_timestamp() WHERE member_id = :m AND id <> :s AND "
                   "revoked_at IS NULL RETURNING id", m=p.member_id, s=p.session_id))
    t.run("UPDATE reset_tokens SET cancelled_at = clock_timestamp() WHERE member_id = :m AND used_at IS NULL AND "
          "cancelled_at IS NULL", m=p.member_id)
    api.audit(t, p.org_id, p.email, "member.password", p.email)
    return Answer({"changed": True, "revoked_sessions": n})


# ---- password reset -----------------------------------------------------------------------------

FORGOT = Obj({"email": (EMAIL_SPEC, True)})


def request_reset(ctx: Ctx, email: str) -> None:
    """Mail a fresh single-use link to a member's email, at most three an hour; reveal nothing either way."""
    t = ctx.tx
    member = t.one("SELECT id, email FROM members WHERE email = :e FOR UPDATE", e=email.strip().lower())
    if not member:
        return
    sent = t.one("SELECT count(*) AS n FROM reset_tokens WHERE member_id = :m AND created_at > clock_timestamp() - "
                 "interval '60 minutes'", m=member["id"])["n"]
    if sent >= RESET_EMAILS_PER_HOUR:
        return
    token = security.hex_id("", 64)
    t.run("UPDATE reset_tokens SET cancelled_at = clock_timestamp() WHERE member_id = :m AND used_at IS NULL AND "
          "cancelled_at IS NULL", m=member["id"])
    t.run("INSERT INTO reset_tokens (digest, member_id) VALUES (:d, :m)", d=security.digest(token), m=member["id"])
    ctx.after.append(lambda: mail.send([member["email"]], "Reset your Tessel password",
                                       f"{config.APP_PUBLIC_URL}/reset?token={token}\n\n"
                                       "Open this link to choose a new Tessel password. "
                                       "If you did not ask for it, ignore this email.\n"))


@route("POST", "/api/auth/forgot", "anyone", body=True)
def forgot(ctx: Ctx):
    request_reset(ctx, validate(FORGOT, ctx.body)["email"])
    return Answer({"sent": True})


def reset_member(t: db.Tx, token: str) -> dict | None:
    return t.one("SELECT r.member_id, m.email, m.organization_id FROM reset_tokens r JOIN members m ON m.id = r.member_id "
                 "WHERE r.digest = :d AND r.used_at IS NULL AND r.cancelled_at IS NULL FOR UPDATE OF r",
                 d=security.digest(token))


def reset_password(ctx: Ctx, token: str, password: str) -> None:
    t = ctx.tx
    member = reset_member(t, token)
    if not member:
        raise ApiError("RESET_TOKEN_INVALID")
    t.run("UPDATE members SET password_hash = :h WHERE id = :m", h=security.hash_password(password),
          m=member["member_id"])
    t.run("UPDATE reset_tokens SET used_at = clock_timestamp() WHERE digest = :d", d=security.digest(token))
    t.run("UPDATE reset_tokens SET cancelled_at = clock_timestamp() WHERE member_id = :m AND used_at IS NULL AND "
          "cancelled_at IS NULL", m=member["member_id"])
    t.run("UPDATE sessions SET revoked_at = clock_timestamp() WHERE member_id = :m AND revoked_at IS NULL",
          m=member["member_id"])
    t.run("DELETE FROM sign_in_failures WHERE email = :e", e=member["email"])
    api.audit(t, member["organization_id"], member["email"], "member.password_reset", member["email"])
    ctx.after.append(lambda: mail.send([member["email"]], "Your Tessel password was reset",
                                       "Your Tessel password was just reset and every session was signed out.\n"
                                       f"Sign in at {config.APP_PUBLIC_URL}/login\n"))


RESET = Obj({"token": (Str(1, 200), True), "password": (NEW_PASSWORD, True)})


@route("POST", "/api/auth/reset", "anyone", body=True)
def reset(ctx: Ctx):
    body = validate(RESET, ctx.body)
    reset_password(ctx, body["token"], body["password"])
    return Answer({"reset": True})


# ---- two-step sign-in ---------------------------------------------------------------------------

CODE = Obj({"code": (Str(1, 64), True)})


def _own_row(ctx: Ctx) -> dict:
    return ctx.tx.one("SELECT totp_enabled, totp_secret, totp_last_step FROM members WHERE id = :m FOR UPDATE",
                      m=ctx.principal.member_id)


@route("POST", "/api/auth/totp/setup", "session")
def totp_setup(ctx: Ctx):
    p = ctx.principal
    if _own_row(ctx)["totp_enabled"]:
        raise ApiError("TOTP_ALREADY_ON")
    secret = security.totp_secret()
    ctx.tx.run("UPDATE members SET totp_secret = :s WHERE id = :m", s=secret, m=p.member_id)
    return Answer({"secret": secret, "otpauth_uri": f"otpauth://totp/Tessel:{p.email}?secret={secret}&issuer=Tessel"})


@route("POST", "/api/auth/totp/enable", "session", body=True)
def totp_enable(ctx: Ctx):
    body = validate(CODE, ctx.body)
    p, t = ctx.principal, ctx.tx
    row = _own_row(ctx)
    if row["totp_enabled"]:
        raise ApiError("TOTP_ALREADY_ON")
    step = security.totp_match(row["totp_secret"], body["code"].strip(), row["totp_last_step"]) \
        if row["totp_secret"] else None
    if step is None:
        raise ApiError("BAD_TOTP")
    codes = security.recovery_codes()
    t.run("UPDATE members SET totp_enabled = true, totp_last_step = :s WHERE id = :m", s=step, m=p.member_id)
    t.run("DELETE FROM recovery_codes WHERE member_id = :m", m=p.member_id)
    for c in codes:
        t.run("INSERT INTO recovery_codes (member_id, digest) VALUES (:m, :d)", m=p.member_id, d=security.digest(c))
    api.audit(t, p.org_id, p.email, "member.totp_on", p.email)
    return Answer({"enabled": True, "recovery_codes": codes})


@route("POST", "/api/auth/totp/disable", "session", body=True)
def totp_disable(ctx: Ctx):
    body = validate(CODE, ctx.body)
    p, t = ctx.principal, ctx.tx
    row = _own_row(ctx)
    if not row["totp_enabled"]:
        raise ApiError("TOTP_NOT_ON")
    step = security.totp_match(row["totp_secret"], body["code"].strip(), row["totp_last_step"])
    if step is None and not _spend_recovery_code(t, p.member_id, body["code"]):
        raise ApiError("BAD_TOTP")
    t.run("UPDATE members SET totp_enabled = false, totp_secret = NULL, totp_last_step = :s WHERE id = :m",
          s=max(step or 0, row["totp_last_step"]), m=p.member_id)
    t.run("DELETE FROM recovery_codes WHERE member_id = :m", m=p.member_id)
    api.audit(t, p.org_id, p.email, "member.totp_off", p.email)
    return Answer({"enabled": False})


# ---- contact ------------------------------------------------------------------------------------

CONTACT = Obj({"email": (EMAIL_SPEC, True),
               "message": (Str(10, 4000, message="Write between 10 and 4000 characters"), True),
               "website": (Str(0, 2000, nullable=True), False)})


def store_contact(t: db.Tx, body: dict) -> None:
    """Keep a valid message unless the website trap caught it; three per email in a rolling hour."""
    if body.get("website"):
        return
    email = body["email"].strip()
    t.run("SELECT pg_advisory_xact_lock(2, hashtext(:e))", e=email.lower())
    recent = t.rows("SELECT created_at FROM contact_messages WHERE lower(email) = :e AND created_at > "
                    "clock_timestamp() - interval '60 minutes' ORDER BY created_at", e=email.lower())
    if len(recent) >= CONTACT_PER_HOUR:
        wait = recent[len(recent) - CONTACT_PER_HOUR]["created_at"] + timedelta(minutes=60) - text.now()
        n = max(1, math.ceil(wait.total_seconds()))
        raise ApiError("RATE_LIMITED", headers={"Retry-After": str(n)}, n=n)
    t.run("INSERT INTO contact_messages (email, message) VALUES (:e, :m)", e=email, m=body["message"])


@route("POST", "/api/contact", "anyone", body=True)
def contact(ctx: Ctx):
    store_contact(ctx.tx, validate(CONTACT, ctx.body))
    return Answer({"received": True}, 201)


# ---- members ------------------------------------------------------------------------------------

NEW_MEMBER = Obj({"email": (EMAIL_SPEC, True), "role": (Enum("owner", "editor", "viewer"), True),
                  "password": (NEW_PASSWORD, True)})
ROLE_BODY = Obj({"role": (Enum("owner", "editor", "viewer"), True)})


def members_of(t: db.Tx, org_id: int) -> list[dict]:
    return t.rows('SELECT email, role FROM members WHERE organization_id = :o ORDER BY email COLLATE "C"', o=org_id)


@route("GET", "/api/v2/members", "viewer")
def list_members(ctx: Ctx):
    return Answer({"members": members_of(ctx.tx, ctx.principal.org_id)})


@route("POST", "/api/v2/members", "owner", body=True)
def add_member(ctx: Ctx):
    body = validate(NEW_MEMBER, ctx.body)
    p, t = ctx.principal, ctx.tx
    email = body["email"].strip().lower()
    t.run("SELECT pg_advisory_xact_lock(4, hashtext(:e))", e=email)
    if t.one("SELECT 1 AS x FROM members WHERE email = :e", e=email):
        raise ApiError("MEMBER_EXISTS")
    t.run("INSERT INTO members (organization_id, email, role, password_hash) VALUES (:o, :e, :r, :h)",
          o=p.org_id, e=email, r=body["role"], h=security.hash_password(body["password"]))
    api.audit(t, p.org_id, p.email, "member.add", email, body["role"])
    ctx.after.append(lambda: mail.send([email], f"You have been added to {p.org_name} on Tessel",
                                       f"You have been added to {p.org_name} on Tessel with the role {body['role']}.\n"
                                       f"Sign in at {config.APP_PUBLIC_URL}/login\n"))
    return Answer({"email": email, "role": body["role"]}, 201)


def _member(ctx: Ctx) -> dict:
    """The target member, with the organization row locked so owner counts are decided one at a time."""
    writelog.lock_organization(ctx.tx, ctx.principal.org_id)
    row = ctx.tx.one("SELECT id, email, role FROM members WHERE organization_id = :o AND email = :e FOR UPDATE",
                     o=ctx.principal.org_id, e=ctx.path["email"].strip().lower())
    if not row:
        raise ApiError("MEMBER_NOT_FOUND")
    return row


def _last_owner(ctx: Ctx, row: dict) -> bool:
    owners = ctx.tx.one("SELECT count(*) AS n FROM members WHERE organization_id = :o AND role = 'owner'",
                        o=ctx.principal.org_id)["n"]
    return row["role"] == "owner" and owners <= 1


@route("PATCH", "/api/v2/members/{email}", "owner", body=True)
def change_role(ctx: Ctx):
    body = validate(ROLE_BODY, ctx.body)
    p, t = ctx.principal, ctx.tx
    row = _member(ctx)
    if row["role"] != body["role"]:
        if _last_owner(ctx, row):
            raise ApiError("LAST_OWNER")
        t.run("UPDATE members SET role = :r WHERE id = :m", r=body["role"], m=row["id"])
        api.audit(t, p.org_id, p.email, "member.role", row["email"], f"{row['role']} -> {body['role']}")
    return Answer({"email": row["email"], "role": body["role"]})


@route("DELETE", "/api/v2/members/{email}", "owner")
def remove_member(ctx: Ctx):
    p, t = ctx.principal, ctx.tx
    row = _member(ctx)
    if _last_owner(ctx, row):
        raise ApiError("LAST_OWNER")
    t.run("DELETE FROM members WHERE id = :m", m=row["id"])
    api.audit(t, p.org_id, p.email, "member.remove", row["email"])
    return Answer({"removed": True})


# ---- API keys -----------------------------------------------------------------------------------

NEW_KEY = Obj({"name": (Str(1, 60, message="Name the key in 1 to 60 characters"), True),
               "role": (Enum("editor", "viewer"), True),
               "databases": (List(DATABASE_REF, 1, 20, message="Choose 1 to 20 databases", nullable=True), False)})


def key_view(r: dict) -> dict:
    return {"id": r["id"], "name": r["name"], "role": r["role"], "prefix": r["prefix"],
            "created_at": text.ts(r["created_at"]), "revoked_at": text.ts(r["revoked_at"])}


def keys_of(t: db.Tx, org_id: int) -> list[dict]:
    return t.rows("SELECT * FROM api_keys WHERE organization_id = :o ORDER BY created_at, id", o=org_id)


@route("GET", "/api/v2/keys", "owner")
def list_keys(ctx: Ctx):
    return Answer({"keys": [key_view(r) for r in keys_of(ctx.tx, ctx.principal.org_id)]})


@route("POST", "/api/v2/keys", "owner", body=True)
def create_key(ctx: Ctx):
    body = validate(NEW_KEY, ctx.body)
    p, t = ctx.principal, ctx.tx
    scope = None
    if body.get("databases") is not None:
        scope = []
        for i, name in enumerate(body["databases"]):
            row = t.one("SELECT id FROM databases WHERE organization_id = :o AND name = :n", o=p.org_id, n=name)
            if not row or row["id"] in scope:
                raise invalid(f"databases.{i}", "Choose each database of this organization once")
            scope.append(row["id"])
    secret = security.key_secret()
    key = t.one("INSERT INTO api_keys (organization_id, name, role, prefix, secret_digest, scoped) VALUES "
                "(:o, :n, :r, :p, :d, :s) RETURNING id", o=p.org_id, n=body["name"], r=body["role"], p=secret[:12],
                d=security.digest(secret), s=scope is not None)
    for database_id in scope or []:
        t.run("INSERT INTO api_key_databases (key_id, database_id) VALUES (:k, :d)", k=key["id"], d=database_id)
    api.audit(t, p.org_id, p.email, "key.create", body["name"], body["role"])
    return Answer({"id": key["id"], "name": body["name"], "role": body["role"], "prefix": secret[:12],
                   "secret": secret}, 201)


def _key(ctx: Ctx) -> dict:
    raw = ctx.path["key_id"]
    row = None
    if raw.isdigit() and len(raw) <= 18:
        row = ctx.tx.one("SELECT * FROM api_keys WHERE id = :k AND organization_id = :o FOR UPDATE", k=int(raw),
                         o=ctx.principal.org_id)
    if not row:
        raise ApiError("KEY_NOT_FOUND")
    return row


def _owner_emails(t: db.Tx, org_id: int) -> list[str]:
    return [r["email"] for r in t.rows('SELECT email FROM members WHERE organization_id = :o AND role = \'owner\' '
                                       'ORDER BY email COLLATE "C"', o=org_id)]


def key_scope(t: db.Tx, key: dict) -> list[str] | None:
    if not key["scoped"]:
        return None
    return [r["name"] for r in t.rows('SELECT d.name FROM api_key_databases k JOIN databases d ON d.id = k.database_id '
                                      'WHERE k.key_id = :k ORDER BY d.name COLLATE "C"', k=key["id"])]


@route("GET", "/api/v2/keys/{key_id}", "owner")
def key_detail(ctx: Ctx):
    r = _key(ctx)
    return Answer({"id": r["id"], "name": r["name"], "role": r["role"], "prefix": r["prefix"],
                   "databases": key_scope(ctx.tx, r), "created_at": text.ts(r["created_at"]),
                   "last_used_at": text.ts(r["last_used_at"]), "rotated_at": text.ts(r["rotated_at"]),
                   "revoked_at": text.ts(r["revoked_at"])})


def _notify_owners(ctx: Ctx, subject: str, body: str) -> None:
    owners = _owner_emails(ctx.tx, ctx.principal.org_id)
    ctx.after.append(lambda: mail.send(owners, subject, body))


@route("POST", "/api/v2/keys/{key_id}/rotate", "owner")
def rotate_key(ctx: Ctx):
    p, t = ctx.principal, ctx.tx
    r = _key(ctx)
    if r["revoked_at"]:
        raise ApiError("KEY_REVOKED")
    secret = security.key_secret()
    t.run("UPDATE api_keys SET secret_digest = :d, prefix = :p, rotated_at = clock_timestamp() WHERE id = :k",
          d=security.digest(secret), p=secret[:12], k=r["id"])
    api.audit(t, p.org_id, p.email, "key.rotate", r["name"])
    _notify_owners(ctx, f"API key rotated: {r['name']}",
                   f"The API key {r['name']} of {p.org_name} was rotated; its old secret no longer works.\n"
                   f"New prefix: {secret[:12]}\n")
    return Answer({"id": r["id"], "prefix": secret[:12], "secret": secret})


@route("DELETE", "/api/v2/keys/{key_id}", "owner")
def revoke_key(ctx: Ctx):
    p, t = ctx.principal, ctx.tx
    r = _key(ctx)
    if r["revoked_at"]:
        raise ApiError("KEY_REVOKED")
    t.run("UPDATE api_keys SET revoked_at = clock_timestamp() WHERE id = :k", k=r["id"])
    api.audit(t, p.org_id, p.email, "key.revoke", r["name"])
    _notify_owners(ctx, f"API key revoked: {r['name']}",
                   f"The API key {r['name']} ({r['prefix']}) of {p.org_name} was revoked.\n")
    return Answer({"revoked": True})


# ---- plan and usage -----------------------------------------------------------------------------

PLAN_BODY = Obj({"plan": (Enum("ship", "scale"), True)})


@route("PUT", "/api/v2/org/plan", "owner", body=True)
def switch_plan(ctx: Ctx):
    new = validate(PLAN_BODY, ctx.body)["plan"]
    p, t = ctx.principal, ctx.tx
    org = writelog.lock_organization(t, p.org_id)
    if org["plan"] != new:
        held = t.one("SELECT count(*) AS n FROM databases WHERE organization_id = :o", o=p.org_id)["n"]
        if held > billing.PLAN_LIMIT[new]:
            raise ApiError("PLAN_DOWNGRADE_BLOCKED")
        t.run("UPDATE organizations SET plan = :p WHERE id = :o", p=new, o=p.org_id)
        api.audit(t, p.org_id, p.email, "plan.change", org["name"], f"{org['plan']} -> {new}")
        _notify_owners(ctx, f"Plan changed to {billing.PLAN_TITLE[new]}",
                       f"{org['name']} is now on the {billing.PLAN_TITLE[new]} plan.\n"
                       f"The new monthly minimum is {text.dollars(billing.MINIMUM[new])}.\n")
    return Answer({"plan": new})


def current_plan(t: db.Tx, org_id: int) -> str:
    return t.one("SELECT plan FROM organizations WHERE id = :o", o=org_id)["plan"]


@route("GET", "/api/v2/usage", "owner")
def usage(ctx: Ctx):
    org = ctx.principal.org_id
    return Answer(billing.usage(ctx.tx, org, current_plan(ctx.tx, org)))


@route("GET", "/api/v2/usage/daily", "owner")
def usage_daily(ctx: Ctx):
    return Answer(billing.daily(ctx.tx, ctx.principal.org_id))


# ---- the audit log ------------------------------------------------------------------------------

def _csv_cell(value) -> str:
    s = "" if value is None else str(value)
    if s.startswith(CSV_FORMULA_START):
        s = "'" + s
    return '"' + s.replace('"', '""') + '"' if any(c in s for c in ',"\n\r') else s


def _filters_digest(org_id: int, action: str | None, actor: str | None) -> str:
    return hashlib.sha256(json.dumps([org_id, action, actor]).encode()).hexdigest()[:16]


def _decode_cursor(raw: str, digest: str) -> tuple[int, int]:
    try:
        value = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
        bound, micros, event_id = value
        if bound != digest or not isinstance(micros, int) or not isinstance(event_id, int):
            raise ValueError
        return micros, event_id
    except (ValueError, TypeError, binascii.Error):
        raise ApiError("INVALID_CURSOR") from None


def _encode_cursor(digest: str, micros: int, event_id: int) -> str:
    return base64.urlsafe_b64encode(json.dumps([digest, micros, event_id]).encode()).decode().rstrip("=")


def audit_filters(query: dict) -> tuple[int, str | None, str | None]:
    """limit, action and actor checked in request order."""
    limit, action, actor = 20, None, None
    for name, value in query.items():
        if name == "limit":
            if not (value.isdigit() and 1 <= int(value) <= 100):
                raise invalid("limit", "Send a whole number from 1 to 100")
            limit = int(value)
        elif name == "action" and value:
            if value not in AUDIT_ACTIONS:
                raise invalid("action", "Choose an audited action")
            action = value
        elif name == "actor" and value.strip():
            actor = value.strip().lower()
    return limit, action, actor


def audit_page(t: db.Tx, org_id: int, limit: int, action: str | None, actor: str | None,
               cursor: str | None = None) -> dict:
    digest = _filters_digest(org_id, action, actor)
    where, params = ["organization_id = :o"], {"o": org_id}
    if action:
        where.append("action = :a")
        params["a"] = action
    if actor:
        where.append("lower(actor) = :actor")
        params["actor"] = actor
    if cursor:
        params["us"], params["id"] = _decode_cursor(cursor, digest)
        where.append("(at, id) < (timestamptz 'epoch' + :us * interval '1 microsecond', :id)")
    rows = t.rows("SELECT id, at, actor, action, target, detail, (extract(epoch FROM at) * 1000000)::bigint AS us "
                  "FROM audit_events WHERE " + " AND ".join(where) + " ORDER BY at DESC, id DESC LIMIT :lim",
                  lim=limit + 1, **params)
    more = len(rows) > limit
    rows = rows[:limit]
    return {"events": [{"id": r["id"], "at": text.ts(r["at"]), "actor": r["actor"], "action": r["action"],
                        "target": r["target"], "detail": r["detail"]} for r in rows],
            "next_cursor": _encode_cursor(digest, int(rows[-1]["us"]), rows[-1]["id"]) if more else None}


@route("GET", "/api/v2/audit", "owner")
def audit_log(ctx: Ctx):
    limit, action, actor = audit_filters(ctx.query)
    org = ctx.principal.org_id
    if ctx.query.get("format") == "csv" or "text/csv" in (ctx.header("accept") or ""):
        events = audit_page(ctx.tx, org, 1000, action, actor)["events"]
        lines = [",".join(CSV_COLUMNS)] + [",".join(_csv_cell(e[c]) for c in CSV_COLUMNS) for e in events]
        return Response("".join(line + "\n" for line in lines), media_type="text/csv; charset=utf-8",
                        headers={"Cache-Control": "no-store"})
    return Answer(audit_page(ctx.tx, org, limit, action, actor, ctx.query.get("cursor") or None))

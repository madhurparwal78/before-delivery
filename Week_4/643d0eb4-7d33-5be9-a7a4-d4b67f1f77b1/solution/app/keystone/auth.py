"""Accounts, sessions, sign-in throttling, form tokens and the per-request permission read."""
import base64
import hashlib
import hmac
import math
import secrets
import time
from datetime import timedelta

import psycopg.errors
from starlette.responses import JSONResponse, Response

from . import config
from .ctx import Ctx
from .db import all_, one, tx
from .errors import refuse
from .util import iso, norm_email, now, valid_email

RANK = {"viewer": 1, "analyst": 2, "editor": 3, "steward": 4}
OBVIOUS_PASSWORDS = ("keystonetables", "northbankmutual", "passwordpassword", "claimsworkspace")
PASSWORD_MINIMUM = 12
TIERS = ("starter", "team", "scale", "regulated")
FORM_TOKEN_SECONDS = 24 * 3600
SIGN_UP_REFUSAL = "This email cannot be used."
SIGN_IN_REFUSAL = "Email or password is wrong."

_SCRYPT = (2**14, 8, 1)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    n, r, p = _SCRYPT
    digest = hashlib.scrypt(password.encode(), salt=salt, n=n, r=r, p=p, dklen=32)
    return "scrypt${}${}${}${}${}".format(n, r, p, base64.b64encode(salt).decode(), base64.b64encode(digest).decode())


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, digest = stored.split("$")
        expected = base64.b64decode(digest)
        actual = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p),
                                dklen=len(expected))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


_DECOY = hash_password(secrets.token_hex(8))


# ---- sessions and the current account --------------------------------------------------------------------------

def lookup_session(conn, value: str | None):
    """The account a live session belongs to. A session is accepted strictly before its expires_at."""
    if not value:
        return None
    return one(conn, "SELECT a.* FROM sessions s JOIN accounts a ON a.email = s.account "
                     "WHERE s.value = %s AND s.expires_at > %s", (value, now()))


def current_account(conn, ctx: Ctx) -> dict | None:
    candidates = []
    header = ctx.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        candidates.append(header[7:].strip())
    if ctx.cookies.get(config.SESSION_COOKIE):
        candidates.append(ctx.cookies[config.SESSION_COOKIE])
    for value in candidates:
        found = lookup_session(conn, value)
        if found:
            return found
    return None


def require_account(conn, ctx: Ctx) -> dict:
    account = current_account(conn, ctx)
    if account is None:
        refuse(401, "Sign in to continue.", "authorization")
    ctx.account = account
    return account


def roles_of(conn, email: str) -> dict[str, str]:
    """Every grant standing in the store at this moment, read again on every request."""
    rows = all_(conn, "SELECT department, role FROM role_grants WHERE account = %s AND authorises_from <= %s "
                      "ORDER BY department", (email, now()))
    return {r["department"]: r["role"] for r in rows}


def role_of(conn, email: str, department: str) -> str | None:
    row = one(conn, "SELECT role FROM role_grants WHERE account = %s AND department = %s AND authorises_from <= %s",
              (email, department, now()))
    return row["role"] if row else None


def require_role(conn, account: dict, department: str, minimum: str, verb: str) -> str:
    role = role_of(conn, account["email"], department)
    if role is None:
        refuse(403, f"You hold no role in the {department} department", "department", meta={"department": department})
    if RANK[role] < RANK[minimum]:
        refuse(403, f"The {role} role cannot {verb}", "role", meta={"department": department})
    return role


def steward_department(conn, account: dict) -> str | None:
    """The one department a steward governs: the first steward grant that authorises now."""
    row = one(conn, "SELECT department FROM role_grants WHERE account = %s AND role = 'steward' "
                    "AND authorises_from <= %s ORDER BY department LIMIT 1", (account["email"], now()))
    return row["department"] if row else None


# ---- form tokens -------------------------------------------------------------------------------------------------

def _form_key() -> bytes:
    return hashlib.sha256(("keystone-form-token|" + config.DATABASE_URL).encode()).digest()


def issue_form_token() -> str:
    stamp = str(int(time.time()))
    nonce = secrets.token_hex(8)
    mac = hmac.new(_form_key(), f"{stamp}.{nonce}".encode(), hashlib.sha256).hexdigest()[:32]
    return f"{stamp}.{nonce}.{mac}"


def form_token_valid(token) -> bool:
    if not isinstance(token, str) or token.count(".") != 2:
        return False
    stamp, nonce, mac = token.split(".")
    expected = hmac.new(_form_key(), f"{stamp}.{nonce}".encode(), hashlib.sha256).hexdigest()[:32]
    if not hmac.compare_digest(mac, expected):
        return False
    return stamp.isascii() and stamp.isdigit() and time.time() - int(stamp) < FORM_TOKEN_SECONDS


def require_form_token(ctx: Ctx) -> None:
    """A browser form post carries the token its page issued; JSON interface calls carry none."""
    if ctx.is_form and not form_token_valid((ctx.form or {}).get("form_token")):
        refuse(403, "This form has expired. Reload the page and try again.", "form_token")


# ---- sign up -----------------------------------------------------------------------------------------------------

def sign_up(ctx: Ctx) -> Response:
    body = ctx.object()
    email = norm_email(body.get("email"))
    if not valid_email(email):
        refuse(422, SIGN_UP_REFUSAL, "email")
    name = body.get("display_name")
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 120:
        refuse(422, "Enter your display name.", "display_name")
    department = body.get("department")
    if department not in config.DEPARTMENTS:
        refuse(422, "Choose claims, underwriting or actuarial.", "department")
    password = body.get("password")
    if not isinstance(password, str) or len(password) < PASSWORD_MINIMUM:
        refuse(422, f"Use at least {PASSWORD_MINIMUM} characters.", "password")
    if password.lower() in OBVIOUS_PASSWORDS:
        refuse(422, "That password is too easy to guess.", "password")
    tier = body.get("tier")
    if tier not in TIERS:
        refuse(422, "Choose starter, team, scale or regulated.", "tier")
    hashed = hash_password(password)
    try:
        with tx() as conn:
            row = one(conn, "INSERT INTO accounts (email, display_name, department, tier, password_hash) "
                            "VALUES (%s, %s, %s, %s, %s) RETURNING id", (email, name.strip(), department, tier, hashed))
    except psycopg.errors.UniqueViolation:
        refuse(422, SIGN_UP_REFUSAL, "email")
    created = {"id": row["id"], "email": email, "display_name": name.strip(), "department": department, "tier": tier}
    return JSONResponse(created, status_code=201)


# ---- sign in -----------------------------------------------------------------------------------------------------

def _throttle_wait(conn, email: str) -> int:
    """Whole seconds left to wait when five refusals stand inside the window, else 0."""
    since = now() - timedelta(seconds=config.THROTTLE_WINDOW_SECONDS)
    rows = all_(conn, "SELECT attempted_at FROM login_attempts WHERE email = %s AND outcome = 'refused' "
                      "AND attempted_at > %s AND attempted_at > COALESCE((SELECT max(attempted_at) FROM "
                      "login_attempts WHERE email = %s AND outcome = 'succeeded'), '-infinity') "
                      "ORDER BY attempted_at DESC LIMIT %s", (email, since, email, config.THROTTLE_ATTEMPTS))
    if len(rows) < config.THROTTLE_ATTEMPTS:
        return 0
    lifts = rows[-1]["attempted_at"] + timedelta(seconds=config.THROTTLE_WINDOW_SECONDS)
    return max(1, math.ceil((lifts - now()).total_seconds()))


def _record(email: str, outcome: str) -> None:
    with tx() as conn:
        conn.execute("INSERT INTO login_attempts (email, attempted_at, outcome) VALUES (%s, %s, %s)",
                     (email, now(), outcome))


def sign_in(ctx: Ctx) -> Response:
    body = ctx.object()
    email = norm_email(body.get("email"))
    password = body.get("password")
    password = password if isinstance(password, str) else ""
    with tx() as conn:
        wait = _throttle_wait(conn, email)
        account = one(conn, "SELECT * FROM accounts WHERE email = %s", (email,))
    if wait:
        _record(email, "refused")
        refuse(429, "Too many refused sign-in attempts. Try again later.", "email",
               headers={"Retry-After": str(wait)})
    good = verify_password(password, account["password_hash"] if account else _DECOY) and account is not None
    if not good:
        _record(email, "refused")
        refuse(401, SIGN_IN_REFUSAL, "email")
    created = now()
    value = secrets.token_urlsafe(32)
    with tx() as conn:
        conn.execute("INSERT INTO login_attempts (email, attempted_at, outcome) VALUES (%s, %s, 'succeeded')",
                     (email, created))
        conn.execute("INSERT INTO sessions (value, account, created_at, expires_at) VALUES (%s, %s, %s, %s)",
                     (value, email, created, created + timedelta(hours=config.SESSION_HOURS)))
        grants = all_(conn, "SELECT department, role, authorises_from FROM role_grants WHERE account = %s "
                            "ORDER BY department", (email,))
    answer = JSONResponse({
        "token": value,
        "account": {"email": email, "display_name": account["display_name"], "department": account["department"],
                    "tier": account["tier"]},
        "roles": [{"department": g["department"], "role": g["role"], "authorises_from": iso(g["authorises_from"])}
                  for g in grants]})
    set_session_cookie(answer, value)
    return answer


def set_session_cookie(response: Response, value: str) -> None:
    response.set_cookie(config.SESSION_COOKIE, value, max_age=config.SESSION_HOURS * 3600, path="/", httponly=True,
                        samesite="lax")


def sign_out(ctx: Ctx) -> Response:
    with tx() as conn:
        account = require_account(conn, ctx)
        used = ctx.headers.get("authorization", "")
        value = used[7:].strip() if used.lower().startswith("bearer ") else ctx.cookies.get(config.SESSION_COOKIE)
        conn.execute("DELETE FROM sessions WHERE value = %s AND account = %s", (value, account["email"]))
    answer = Response(status_code=204)
    answer.delete_cookie(config.SESSION_COOKIE, path="/", httponly=True, samesite="lax")
    return answer


def login_attempts(ctx: Ctx) -> Response:
    with tx() as conn:
        account = require_account(conn, ctx)
        if steward_department(conn, account) is None:
            refuse(403, "Only a steward reads the sign-in record.", "role")
        rows = all_(conn, "SELECT id, email, attempted_at, outcome FROM login_attempts "
                          "ORDER BY attempted_at DESC, id DESC LIMIT 200")
    return JSONResponse([{"id": r["id"], "email": r["email"], "attempted_at": iso(r["attempted_at"]),
                          "outcome": r["outcome"]} for r in rows])

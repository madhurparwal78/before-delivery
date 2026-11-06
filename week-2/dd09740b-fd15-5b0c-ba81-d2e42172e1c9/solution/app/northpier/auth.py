"""Studio sign in: hashed passwords, hashed session tokens, the sign-in limit and safe `next` targets."""
import datetime as dt
import hashlib
import math
import re
import secrets
from typing import Any
from urllib.parse import unquote, urlsplit

from django.contrib.auth.hashers import check_password, make_password
from django.http import HttpRequest

from northpier import db
from northpier.config import SETTINGS
from northpier.domain import has_unsupported
from northpier.errors import Refusal

SESSION_COOKIE = "np_session"
SIGNIN_LIMIT = 5
_UNKNOWN_USER_HASH = make_password(secrets.token_urlsafe(16))


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def user_shape(row: dict[str, Any]) -> dict[str, Any]:
    return {"id": row["id"], "name": row["name"], "email": row["email"], "role": row["role"]}


def _signin_retry_after(tx: db.Tx, email: str, now: dt.datetime) -> int | None:
    """Seconds until the counted failures drop below five, when the email has five or more; else None.
    Counted failures fall inside the sign-in window and after the email's latest success."""
    window = dt.timedelta(seconds=SETTINGS.signin_window)
    failures = tx.rows(
        "SELECT created_at FROM sign_in_attempts WHERE email = :email AND NOT succeeded AND created_at > :since "
        "AND created_at > coalesce((SELECT max(created_at) FROM sign_in_attempts WHERE email = :email "
        "AND succeeded), '-infinity') ORDER BY created_at", email=email, since=now - window)
    if len(failures) < SIGNIN_LIMIT:
        return None
    leaving = failures[len(failures) - SIGNIN_LIMIT]["created_at"]
    return max(1, math.ceil((leaving + window - now).total_seconds()))


def sign_in(body: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """A new session token and the user, or the sign-in-limit / wrong-credentials refusal."""
    email, password = body.get("email"), body.get("password")
    if type(email) is not str or type(password) is not str or has_unsupported(email):
        raise Refusal("credentials")
    email = email.strip().lower()
    with db.transaction() as tx:
        tx.lock(f"sign-in:{email}")
        now = tx.clock()
        retry_after = _signin_retry_after(tx, email, now)
        if retry_after is not None:
            raise Refusal("signin_limit", retry_after=retry_after)
        user = tx.one("SELECT id, name, email, role, password_hash FROM studio_users WHERE email = :email",
                      email=email)
        valid = (not has_unsupported(password) and user is not None
                 and check_password(password, user["password_hash"]))
        tx.run("INSERT INTO sign_in_attempts (email, succeeded, created_at) VALUES (:email, :ok, :now)",
               email=email, ok=valid, now=now)
        if not valid:
            token = None
        else:
            token = secrets.token_urlsafe(32)
            tx.run("INSERT INTO sessions (user_id, token_hash, created_at) VALUES (:user, :hash, :now)",
                   user=user["id"], hash=token_hash(token), now=now)
    if token is None:
        raise Refusal("credentials")
    return token, user_shape(user)


def request_token(request: HttpRequest) -> tuple[str | None, bool]:
    """The sign-in token a request carries and whether it came from the session cookie."""
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return header[len("Bearer "):].strip(), False
    cookie = request.COOKIES.get(SESSION_COOKIE)
    return (cookie, True) if cookie else (None, False)


def session_user(token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    with db.transaction() as tx:
        row = tx.one("SELECT u.id, u.name, u.email, u.role FROM sessions s JOIN studio_users u ON u.id = s.user_id "
                     "WHERE s.token_hash = :hash AND s.ended_at IS NULL", hash=token_hash(token))
    return user_shape(row) if row else None


def sign_out(token: str) -> None:
    with db.transaction() as tx:
        tx.run("UPDATE sessions SET ended_at = clock_timestamp() WHERE token_hash = :hash AND ended_at IS NULL",
               hash=token_hash(token))


def own_origin(request: HttpRequest) -> bool:
    """True unless the request names another origin than the app's public URL or the host it was sent to."""
    origin = request.headers.get("Origin")
    if origin is None:
        return True
    host = request.headers.get("Host", "")
    return origin.rstrip("/") in {SETTINGS.public_url, f"http://{host}", f"https://{host}"}


_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def safe_path(target: str | None, fallback: str = "/") -> str:
    """`target` when it is a same-origin path: one leading "/", no "//" or "\\", no scheme, host or control
    characters, also after up to three percent-decodings; else `fallback`."""
    if not target or len(target) > 2048:
        return fallback
    decoded = target
    for _ in range(3):
        if _CONTROL.search(decoded) or "\\" in decoded or not decoded.startswith("/") or decoded.startswith("//"):
            return fallback
        decoded = unquote(decoded)
    parts = urlsplit(target)
    return fallback if parts.scheme or parts.netloc else target


def safe_next(target: str | None) -> str:
    """`next` when it is /studio, /studio/... or /studio?...; any other `next` lands on /studio."""
    path = safe_path(target, "/studio")
    return path if path == "/studio" or path.startswith(("/studio/", "/studio?")) else "/studio"

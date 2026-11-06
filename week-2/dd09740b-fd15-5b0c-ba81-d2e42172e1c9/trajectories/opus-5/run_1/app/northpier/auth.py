"""Studio sessions, password hashing and the sign-in limit."""

from __future__ import annotations

import hashlib
import hmac
import math
import secrets
from datetime import timedelta
from typing import Any


from . import errors
from .calendar_rules import now_utc
from .config import CONFIG
from .db import Connection

SESSION_COOKIE = "np_session"
_PBKDF2_ITERATIONS = 120_000
SIGN_IN_FAILURE_LIMIT = 5


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${_PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, iterations, salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    if algorithm != "pbkdf2_sha256":
        return False
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iterations)
    )
    return hmac.compare_digest(digest.hex(), digest_hex)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def mint_session_token() -> str:
    return secrets.token_urlsafe(32)


# ---------------------------------------------------------------------------
# The sign-in limit (Business rules 20)
# ---------------------------------------------------------------------------


def _counted_failures(conn: Connection, email: str) -> list[Any]:
    window_start = now_utc() - timedelta(seconds=CONFIG.signin_window_seconds)
    rows = conn.execute(
        """
        SELECT created_at
          FROM sign_in_attempts
         WHERE email = %s
           AND succeeded = false
           AND created_at > %s
           AND created_at > COALESCE(
                 (SELECT max(created_at) FROM sign_in_attempts
                   WHERE email = %s AND succeeded = true),
                 '-infinity'::timestamptz)
         ORDER BY created_at
        """,
        (email, window_start, email),
    ).fetchall()
    return [row["created_at"] for row in rows]


def check_sign_in_limit(conn: Connection, email: str) -> None:
    failures = _counted_failures(conn, email)
    if len(failures) < SIGN_IN_FAILURE_LIMIT:
        return
    # The limit lifts once enough of the oldest failures have left the window.
    leaving = failures[len(failures) - SIGN_IN_FAILURE_LIMIT]
    expires_at = leaving + timedelta(seconds=CONFIG.signin_window_seconds)
    seconds = max(1, math.ceil((expires_at - now_utc()).total_seconds()))
    raise errors.sign_in_limit(seconds)


def record_attempt(conn: Connection, email: str, succeeded: bool) -> None:
    conn.execute(
        "INSERT INTO sign_in_attempts (email, succeeded, created_at) VALUES (%s, %s, %s)",
        (email, succeeded, now_utc()),
    )


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------


def sign_in(conn: Connection, raw_email: Any, raw_password: Any) -> tuple[str, dict]:
    """Returns the session token and the signed-in user."""
    if not isinstance(raw_email, str) or not isinstance(raw_password, str):
        raise errors.wrong_credentials()
    email = raw_email.strip().lower()
    # A refused-by-limit attempt is never recorded, so it cannot extend the lockout.
    check_sign_in_limit(conn, email)
    user = conn.execute(
        "SELECT id, name, email, role, password_hash FROM studio_users WHERE email = %s",
        (email,),
    ).fetchone()
    succeeded = user is not None and verify_password(raw_password, user["password_hash"])
    token = mint_session_token()
    with conn.transaction():
        record_attempt(conn, email, succeeded)
        if succeeded:
            conn.execute(
                "INSERT INTO sessions (user_id, token_hash, created_at) VALUES (%s, %s, %s)",
                (user["id"], hash_token(token), now_utc()),
            )
    if not succeeded:
        raise errors.wrong_credentials()
    return token, user


def resolve_session(conn: Connection, token: str) -> dict | None:
    return conn.execute(
        """
        SELECT u.id, u.name, u.email, u.role
          FROM sessions s
          JOIN studio_users u ON u.id = s.user_id
         WHERE s.token_hash = %s AND s.ended_at IS NULL
        """,
        (hash_token(token),),
    ).fetchone()


def sign_out(conn: Connection, token: str) -> None:
    with conn.transaction():
        conn.execute(
            "UPDATE sessions SET ended_at = %s WHERE token_hash = %s AND ended_at IS NULL",
            (now_utc(), hash_token(token)),
        )

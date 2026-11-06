"""Studio accounts, sessions and the sign-in limit."""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import secrets
from typing import Any

from .config import CONFIG
from .inquiries import utc_now

SESSION_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"


def _random_b64(n: int) -> str:
    return base64.urlsafe_b64encode(secrets.token_bytes(n)).decode("ascii")


def hash_password(password: str) -> str:
    salt = _random_b64(16).encode("ascii")
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000, dklen=32)
    return f"pbkdf2_sha256$200000${salt.decode('ascii')}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, rounds, salt, hexdigest = stored.split("$")
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt.encode("ascii"), int(rounds), dklen=32
        )
        return hmac.compare_digest(digest.hex(), hexdigest)
    except (ValueError, TypeError):
        return False


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def user_json(row: dict) -> dict:
    return {"id": row["id"], "name": row["name"], "email": row["email"], "role": row["role"]}


def record_attempt(conn, email: str, succeeded: bool) -> None:
    conn.execute(
        "INSERT INTO sign_in_attempts (email, succeeded, created_at) VALUES (%(e)s, %(s)s, %(now)s)",
        {"e": email, "s": succeeded, "now": utc_now()},
    )


def counted_failures(conn, email: str) -> tuple[int, Any]:
    """Failures in the window that came after that email's latest success."""
    row = conn.execute(
        """
        WITH latest_success AS (
            SELECT MAX(created_at) AS last_ok
            FROM sign_in_attempts
            WHERE email = %(e)s AND succeeded = TRUE
        )
        SELECT COUNT(*) AS n, MIN(a.created_at) AS oldest
        FROM sign_in_attempts a, latest_success s
        WHERE a.email = %(e)s
          AND a.succeeded = FALSE
          AND a.created_at >= now() - (%(w)s || ' seconds')::interval
          AND (s.last_ok IS NULL OR a.created_at > s.last_ok)
        """,
        {"e": email, "w": CONFIG.signin_window_seconds},
    ).fetchone()
    return row["n"], row["oldest"]


def signin_retry_after(oldest) -> int:
    """Seconds until enough failures leave the window to bring the count below five."""
    if oldest is None:
        return 1
    gone = (utc_now() - oldest.astimezone(dt.timezone.utc)).total_seconds()
    remaining = CONFIG.signin_window_seconds - gone
    return max(1, int(remaining) + (1 if remaining > int(remaining) else 0))


# ------------------------------------------------------------- sessions


def create_session(conn, user_id: int) -> str:
    token = _mint_session()
    conn.execute(
        "INSERT INTO sessions (user_id, token_hash, created_at) VALUES (%(u)s, %(t)s, %(now)s)",
        {"u": user_id, "t": hash_token(token), "now": utc_now()},
    )
    return token


def end_session(conn, token: str) -> None:
    conn.execute(
        "UPDATE sessions SET ended_at = %(now)s WHERE token_hash = %(t)s AND ended_at IS NULL",
        {"t": hash_token(token), "now": utc_now()},
    )


def session_user(conn, token: str) -> dict | None:
    row = conn.execute(
        """
        SELECT u.id, u.name, u.email, u.role
        FROM sessions s JOIN studio_users u ON u.id = s.user_id
        WHERE s.token_hash = %(t)s AND s.ended_at IS NULL
        """,
        {"t": hash_token(token)},
    ).fetchone()
    return row


def _mint_session() -> str:
    return "".join(secrets.choice(SESSION_ALPHABET) for _ in range(48))

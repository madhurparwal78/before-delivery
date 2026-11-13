"""Desk accounts, their stored passwords and their sessions.

Authority always comes from the stored account behind the session, read again on
every request, never from anything the request carries or from anything copied at
sign-in.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import secrets

from ..config import SESSION_SECONDS

ITERATIONS = 240_000
CURATOR, STEWARD = "curator", "steward"


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITERATIONS)
    return f"pbkdf2_sha256${ITERATIONS}${salt.hex()}${digest.hex()}"


def password_matches(password: str, stored: str) -> bool:
    try:
        algorithm, rounds, salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    if algorithm != "pbkdf2_sha256":
        return False
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(rounds)
    )
    return hmac.compare_digest(digest.hex(), digest_hex)


def sign_in(conn, email: str, password: str, now: dt.datetime) -> dict | None:
    row = conn.execute(
        "SELECT id, password_hash, role FROM account WHERE lower(email) = lower(%s)",
        (email,),
    ).fetchone()
    if row is None or not password_matches(password, row["password_hash"]):
        return None
    token = secrets.token_urlsafe(32)
    conn.execute(
        "INSERT INTO desk_session (token, account_id, created_at) VALUES (%s, %s, %s)",
        (token, row["id"], now),
    )
    return {"token": token, "role": row["role"]}


def account_for(conn, token: str, now: dt.datetime) -> dict | None:
    """The stored account behind a live session, or None."""
    row = conn.execute(
        """SELECT a.id, a.email, a.role, a.programme_id, s.created_at
             FROM desk_session s JOIN account a ON a.id = s.account_id
            WHERE s.token = %s""",
        (token,),
    ).fetchone()
    if row is None:
        return None
    if (now - row["created_at"]).total_seconds() > SESSION_SECONDS:
        return None
    return {
        "id": int(row["id"]),
        "email": row["email"],
        "role": row["role"],
        "programme_id": int(row["programme_id"]),
    }

"""Passwords and bearer sessions."""
import hashlib
import hmac
import secrets

from fastapi import Request

from . import db
from .errors import unauthorized

SESSION_COOKIE = "pacely_session"
_SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), **_SCRYPT)
    return hmac.compare_digest(digest.hex(), digest_hex)


def start_session(cursor, athlete_id: int) -> str:
    token = secrets.token_urlsafe(32)
    cursor.execute("INSERT INTO sessions (token, athlete_id) VALUES (%s, %s)", (token, athlete_id))
    return token


def _bearer(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return request.cookies.get(SESSION_COOKIE)


def athlete_for_request(request: Request) -> dict | None:
    token = _bearer(request)
    if not token:
        return None
    with db.cursor() as cursor:
        cursor.execute(
            """
            SELECT ath.*, (sub.id IS NOT NULL) AS subscriber
            FROM sessions s
            JOIN athletes ath ON ath.id = s.athlete_id
            LEFT JOIN subscriptions sub ON sub.athlete_id = ath.id
            WHERE s.token = %s
            """,
            (token,),
        )
        return cursor.fetchone()


def require_athlete(request: Request) -> dict:
    athlete = athlete_for_request(request)
    if athlete is None:
        raise unauthorized()
    return athlete

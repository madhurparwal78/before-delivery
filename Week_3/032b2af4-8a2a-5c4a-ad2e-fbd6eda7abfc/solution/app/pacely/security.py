"""Passwords, tokens and the session lookup."""

import asyncio
import hashlib
import hmac
import secrets

from starlette.requests import Request

from . import db
from .errors import unauthorized

DUMMY_HASH = "00" * 16 + "$" + "00" * 32  # checked when the email is unknown, so timing does not reveal accounts
SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}


def _derive(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(password.encode(), salt=salt, **SCRYPT)


async def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = await asyncio.to_thread(_derive, password, salt)
    return f"{salt.hex()}${digest.hex()}"


async def check_password(password: str, stored: str) -> bool:
    salt_hex, digest_hex = stored.split("$")
    digest = await asyncio.to_thread(_derive, password, bytes.fromhex(salt_hex))
    return hmac.compare_digest(digest, bytes.fromhex(digest_hex))


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def open_session(conn, athlete_id: int) -> str:
    token = secrets.token_urlsafe(32)
    await conn.execute("INSERT INTO sessions (token_hash, athlete_id) VALUES ($1, $2)", token_hash(token), athlete_id)
    return token


def bearer(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    return token.strip() if scheme.lower() == "bearer" and token.strip() else None


ME_COLUMNS = "a.id, a.email, a.name, a.private, a.default_visibility, a.plan, a.time_zone"


async def current_athlete(request: Request) -> dict:
    token = bearer(request)
    if token is None:
        raise unauthorized()
    row = await db.pool.fetchrow(
        f"SELECT {ME_COLUMNS} FROM sessions s JOIN athletes a ON a.id = s.athlete_id WHERE s.token_hash = $1",
        token_hash(token))
    if row is None:
        raise unauthorized()
    return dict(row)


def is_subscriber(plan: str) -> bool:
    return plan != "free"


def athlete_json(row: dict) -> dict:
    """The full record that only the athlete themselves receives."""
    return {"id": row["id"], "email": row["email"], "name": row["name"], "private": row["private"],
            "default_visibility": row["default_visibility"], "subscriber": is_subscriber(row["plan"]),
            "plan": row["plan"], "time_zone": row["time_zone"]}

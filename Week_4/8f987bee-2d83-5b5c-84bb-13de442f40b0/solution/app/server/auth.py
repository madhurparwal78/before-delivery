"""Passwords, sessions, the sign-in lockout and the per-request role check."""

import asyncio
import hashlib
import hmac
import math
import secrets
import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

import asyncpg
from fastapi import Request

from .config import settings
from .db import db, utcnow
from .errors import ApiError, forbidden

ROLE_RANK = {"viewer": 0, "editor": 1, "admin": 2}
LOCK_FAILURES = 5
_DUMMY_HASH = "scrypt$00000000000000000000000000000000$" + "0" * 64


def _scrypt(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)


async def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = await asyncio.to_thread(_scrypt, password, salt)
    return f"scrypt${salt.hex()}${digest.hex()}"


async def password_matches(password: str, stored: str) -> bool:
    _, salt, digest = stored.split("$")
    computed = await asyncio.to_thread(_scrypt, password, bytes.fromhex(salt))
    return hmac.compare_digest(computed.hex(), digest)


def normal_email(email: str) -> str:
    """Emails match case-insensitively, ignoring surrounding whitespace."""
    return email.strip().lower()


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def open_session(conn: asyncpg.Connection, user_id: uuid.UUID) -> str:
    token = secrets.token_urlsafe(32)
    await conn.execute("INSERT INTO sessions (token_hash, user_id, created_at) VALUES ($1, $2, $3)",
                       token_hash(token), user_id, utcnow())
    return token


@dataclass(frozen=True)
class Member:
    """The signed-in user and the role their membership holds at the moment the request arrives."""

    id: uuid.UUID
    email: str
    name: str
    role: str
    workspace_id: uuid.UUID
    preferences: dict[str, Any]
    session: str

    def require(self, role: str) -> None:
        if ROLE_RANK[self.role] < ROLE_RANK[role]:
            raise forbidden()

    def public(self) -> dict[str, Any]:
        return {"id": str(self.id), "email": self.email, "name": self.name, "role": self.role,
                "workspace_id": str(self.workspace_id), "preferences": self.preferences}


async def member_for_token(token: str | None) -> Member:
    if not token:
        raise ApiError(401, "unauthenticated")
    async with db.snapshot() as conn:
        row = await conn.fetchrow(
            """SELECT u.id, u.email, u.name, u.preferences, m.role, m.workspace_id
               FROM sessions s JOIN users u ON u.id = s.user_id JOIN memberships m ON m.user_id = u.id
               WHERE s.token_hash = $1""", token_hash(token))
    if row is None:
        raise ApiError(401, "unauthenticated")
    return Member(row["id"], row["email"], row["name"], row["role"], row["workspace_id"], row["preferences"],
                  token_hash(token))


def bearer(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    scheme, _, value = header.partition(" ")
    return value.strip() if scheme.lower() == "bearer" and value.strip() else None


async def current_member(request: Request) -> Member:
    return await member_for_token(bearer(request))


async def sign_in(conn: asyncpg.Connection, email: str, password: str) -> asyncpg.Record | ApiError:
    """The lockout rule: five failures within one period lock the email for one period from the fifth.
    Known and unknown emails take exactly the same path. A refusal is returned, not raised, so the
    attempt it records commits with the caller's transaction."""
    email = normal_email(email)
    period = timedelta(seconds=settings.lockout_seconds)
    now = utcnow()
    await conn.execute("INSERT INTO sign_in_attempts (email) VALUES ($1) ON CONFLICT (email) DO NOTHING", email)
    attempts = await conn.fetchrow("SELECT failures, locked_until FROM sign_in_attempts WHERE email = $1 FOR UPDATE",
                                   email)
    if attempts["locked_until"] is not None and attempts["locked_until"] > now:
        remaining = (attempts["locked_until"] - now).total_seconds()
        wait = min(settings.lockout_seconds, max(1, math.ceil(remaining)))
        return ApiError(429, "too_many_attempts", headers={"Retry-After": str(wait)})
    user = await conn.fetchrow("SELECT id, email, name, password_hash FROM users WHERE email = $1", email)
    matched = await password_matches(password, user["password_hash"] if user else _DUMMY_HASH)
    if matched and user is not None:
        await conn.execute("UPDATE sign_in_attempts SET failures = '{}', locked_until = NULL WHERE email = $1", email)
        return user
    failures = [moment for moment in attempts["failures"] if moment > now - period] + [now]
    locked_until = now + period if len(failures) >= LOCK_FAILURES else None
    await conn.execute("UPDATE sign_in_attempts SET failures = $2, locked_until = $3 WHERE email = $1",
                       email, [] if locked_until else failures, locked_until)
    return ApiError(401, "invalid_credentials")

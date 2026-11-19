"""Accounts: sign-up, sign-in with the sign-in throttle, sessions and sign-out."""

import hashlib
import secrets
from dataclasses import dataclass

import asyncpg
from starlette.responses import JSONResponse, Response

from . import lockout
from .config import SETTINGS
from .db import DB, serialise
from .errors import NO_STORE, ApiError, validation
from .inputs import required
from .passwords import UNKNOWN_ACCOUNT_HASH, hash_password, verify_password

SIGN_IN_LIMIT = 10
EMAIL_LENGTH = (3, 254)
NAME_LENGTH = (1, 40)
PASSWORD_LENGTH = (8, 128)
DIRECTION_CONTROLS = {"؜", "‎", "‏", *map(chr, range(0x202A, 0x202F)), *map(chr, range(0x2066, 0x206A))}


@dataclass(frozen=True, slots=True)
class User:
    id: int
    email: str
    display_name: str

    def published(self) -> dict[str, object]:
        return {"id": self.id, "email": self.email, "display_name": self.display_name}


def _token_sha256(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def normalise_email(value: str) -> str:
    return value.strip().lower()


def _is_control(ch: str) -> bool:
    return ch <= "\x1f" or "\x7f" <= ch <= "\x9f"


def _email_problem(email: str) -> str | None:
    local, at, domain = email.partition("@")
    if (not EMAIL_LENGTH[0] <= len(email) <= EMAIL_LENGTH[1] or email.count("@") != 1 or not local
            or "." not in domain or any(ch.isspace() or _is_control(ch) for ch in email)):
        return "Enter a valid email"
    return None


def _name_problem(sent: str) -> str | None:
    """Checked on the name as sent: trimming must not hide a control character such as U+0085."""
    if not NAME_LENGTH[0] <= len(sent.strip()) <= NAME_LENGTH[1]:
        return "Display name must be 1 to 40 characters"
    if any(_is_control(ch) or ch in DIRECTION_CONTROLS for ch in sent):
        return "Display name cannot contain control or direction characters"
    return None


def _password_problem(password: str) -> str | None:
    if not PASSWORD_LENGTH[0] <= len(password) <= PASSWORD_LENGTH[1]:
        return "Password must be 8 to 128 characters"
    return None


async def _open_session(conn: asyncpg.Connection, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    await conn.execute("INSERT INTO sessions (token_sha256, user_id) VALUES ($1, $2)", _token_sha256(token), user_id)
    return token


def _signed_in(status: int, token: str, user: User) -> JSONResponse:
    return JSONResponse({"token": token, "user": user.published()}, status_code=status, headers=NO_STORE)


async def session_user(token: str) -> User | None:
    async with DB.connection() as conn:
        row = await conn.fetchrow(
            "SELECT u.id, u.email, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id "
            "WHERE s.token_sha256 = $1", _token_sha256(token))
    return User(row["id"], row["email"], row["display_name"]) if row else None


async def sign_up(body: dict) -> Response:
    fields = required(body, "email", "display_name", "password")
    email, name, password = normalise_email(fields["email"]), fields["display_name"], fields["password"]
    async with DB.connection() as conn:
        if await conn.fetchval("SELECT EXISTS (SELECT 1 FROM users WHERE email = $1)", email):
            raise ApiError(409, "email_taken")
    problems = {key: problem for key, problem in (("email", _email_problem(email)), ("display_name", _name_problem(name)),
                                                  ("password", _password_problem(password))) if problem}
    if problems:
        raise validation(problems)
    password_hash = await hash_password(password)
    async with DB.transaction() as conn:
        row = await conn.fetchrow(
            "INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3) "
            "ON CONFLICT (email) DO NOTHING RETURNING id, email, display_name", email, name.strip(), password_hash)
        if row is None:
            raise ApiError(409, "email_taken")
        token = await _open_session(conn, row["id"])
    return _signed_in(201, token, User(row["id"], row["email"], row["display_name"]))


async def _sign_in_lock(conn: asyncpg.Connection, email: str) -> int:
    """The sign-in throttle: seconds left on this email's lock, 0 when sign-in may proceed."""
    failures = await conn.fetchval(
        "SELECT coalesce(array_agg(created_at ORDER BY id), '{}') FROM login_attempts "
        "WHERE email = $1 AND NOT succeeded AND id > coalesce("
        "(SELECT max(id) FROM login_attempts WHERE email = $1 AND succeeded), 0)", email)
    now = await conn.fetchval("SELECT clock_timestamp()")
    return lockout.seconds_left(failures, now, SIGN_IN_LIMIT, SETTINGS.sign_in_lock_seconds)


async def sign_in(body: dict) -> Response:
    fields = required(body, "email", "password")
    email, password = normalise_email(fields["email"]), fields["password"]
    async with DB.connection() as conn:
        account = await conn.fetchrow("SELECT id, email, display_name, password_hash FROM users WHERE email = $1",
                                      email)
    matches = await verify_password(password, account["password_hash"] if account else UNKNOWN_ACCOUNT_HASH)
    succeeded = account is not None and matches
    token = None
    async with DB.transaction() as conn:
        await serialise(conn, f"sign-in:{email}")
        if left := await _sign_in_lock(conn, email):
            raise ApiError(429, "too_many_attempts", headers={"Retry-After": str(left)})
        await conn.execute("INSERT INTO login_attempts (email, succeeded) VALUES ($1, $2)", email, succeeded)
        if succeeded:
            token = await _open_session(conn, account["id"])
    if token is None:
        raise ApiError(401, "invalid_credentials")
    return _signed_in(200, token, User(account["id"], account["email"], account["display_name"]))


async def sign_out(token: str) -> Response:
    async with DB.connection() as conn:
        await conn.execute("DELETE FROM sessions WHERE token_sha256 = $1", _token_sha256(token))
    return Response(status_code=204, headers=NO_STORE)

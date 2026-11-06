"""Sign-in, sessions, step-up proofs and the shared attempt limit."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import math
import re
import secrets
import struct
import time

import asyncpg

from wardline import fields, ledger
from wardline.access import grant_in_force, safe_landing
from wardline.config import CONFIG
from wardline.db import DB, next_id
from wardline.errors import ApiError
from wardline.web import Person, Reply, Request, route

COOKIE = "wardline_session"
ATTEMPT_LIMIT = 5
TOKEN_SHAPE = re.compile(r"[A-Za-z0-9_-]{32,128}")
_DUMMY_HASH = "scrypt:00000000000000000000000000000000:" + "0" * 64


def digest_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_token() -> str:
    return secrets.token_urlsafe(32)


def _scrypt(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(password.encode("utf-8", "surrogatepass"), salt=salt, n=2**14, r=8, p=1, dklen=32)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    return f"scrypt:{salt.hex()}:{_scrypt(password, salt).hex()}"


async def verify_password(password: str, stored: str | None) -> bool:
    """The same work whether or not an account exists."""
    _, salt, expected = (stored or _DUMMY_HASH).split(":")
    computed = await asyncio.to_thread(_scrypt, password, bytes.fromhex(salt))
    return stored is not None and hmac.compare_digest(computed.hex(), expected)


def totp_valid(secret: str, code: str) -> bool:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8))
    step = int(time.time()) // 30
    for moment in (step - 1, step, step + 1):
        digest = hmac.new(key, struct.pack(">Q", moment), hashlib.sha1).digest()
        offset = digest[-1] & 15
        value = (struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF) % 1_000_000
        if hmac.compare_digest(f"{value:06d}".encode(), code.encode("utf-8", "replace")):
            return True
    return False


def _identity(email: str) -> str:
    return hashlib.sha256(email.encode("utf-8", "surrogatepass")).hexdigest()


async def _locked_for(identity: str) -> int | None:
    async with DB.connection() as conn:
        until = await conn.fetchval(
            "SELECT locked_until FROM sign_in_limits WHERE identity = $1 AND locked_until > now()", identity
        )
    if until is None:
        return None
    return max(1, math.ceil((until - fields.now()).total_seconds()))


async def _record_failure(identity: str, target: str, actor_id: str, session_id: str | None) -> None:
    async with DB.tx() as conn:
        failures = await conn.fetchval(
            """INSERT INTO sign_in_limits (identity, failures) VALUES ($1, 1)
               ON CONFLICT (identity) DO UPDATE SET
                 failures = CASE WHEN sign_in_limits.locked_until <= now() THEN 1 ELSE sign_in_limits.failures + 1 END,
                 locked_until = CASE WHEN sign_in_limits.locked_until <= now() THEN NULL ELSE sign_in_limits.locked_until END
               RETURNING failures""",
            identity,
        )
        if failures == ATTEMPT_LIMIT:
            await conn.execute(
                "UPDATE sign_in_limits SET locked_until = now() + make_interval(secs => $2) WHERE identity = $1",
                identity,
                float(CONFIG.lockout_seconds),
            )
            await ledger.append(conn, actor_id=actor_id, session_id=session_id, action="signin.locked", target=target)
            await ledger.raise_signal(conn, "sign_in_lockout", target)


async def _clear_failures(conn: asyncpg.Connection, identity: str) -> None:
    await conn.execute("DELETE FROM sign_in_limits WHERE identity = $1", identity)


def _locked(retry_after: int) -> ApiError:
    return ApiError("sign_in_locked", retry_after=retry_after)


def _sign_in_form(body: dict) -> tuple[str, str]:
    form = fields.Form(body)
    email, password = body.get("email"), body.get("password")
    if not isinstance(email, str) or not email.strip(fields.TRIM):
        form.errors["email"] = fields.REQUIRED
    if not isinstance(password, str) or not password.strip(fields.TRIM):
        form.errors["password"] = fields.REQUIRED
    form.done()
    return email, password


@route("POST", "/api/sign-in", auth=False)
async def sign_in(request: Request) -> Reply:
    body = request.require_body()
    email, password = _sign_in_form(body)
    email = email.strip(fields.TRIM).lower()
    if fields.unstorable(email) or fields.unstorable(password):
        raise ApiError("sign_in_failed")
    identity = _identity(email)
    if (retry_after := await _locked_for(identity)) is not None:
        raise _locked(retry_after)
    async with DB.connection() as conn:
        person = await conn.fetchrow("SELECT * FROM people WHERE email = $1", email)
    if not await verify_password(password, person["password_hash"] if person else None):
        target = person["id"] if person else f"email:{identity}"
        await _record_failure(identity, target, "system", None)
        raise ApiError("sign_in_failed")
    token = new_token()
    async with DB.tx() as conn:
        await _clear_failures(conn, identity)
        session_id = await next_id(conn, "SES", "sessions_seq")
        await conn.execute(
            "INSERT INTO sessions (id, token_hash, user_id, created_at, last_activity, life_ends_at)"
            " VALUES ($1, $2, $3, now(), now(), now() + make_interval(secs => $4))",
            session_id,
            digest_token(token),
            person["id"],
            float(CONFIG.session_ttl_seconds),
        )
        await ledger.append(conn, actor_id=person["id"], session_id=session_id, action="session.opened", target=session_id)
    secure = "; Secure" if CONFIG.public_url.startswith("https:") else ""
    return Reply(
        200,
        {
            "user": {"id": person["id"], "name": person["name"], "role": person["role"]},
            "session_id": session_id,
            "landing": safe_landing(person["role"], body.get("next")),
        },
        {"set-cookie": f"{COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict{secure}"},
    )


def _cookie_token(request: Request) -> str | None:
    for part in request.headers.get("cookie", "").split(";"):
        name, _, value = part.strip().partition("=")
        if name == COOKIE and TOKEN_SHAPE.fullmatch(value):
            return value
    return None


def session_ending(alias: str = "") -> str:
    """SQL for the one rule of a session's end: `expired`, `idle`, or NULL while it lives, on the server's clock."""
    prefix = f"{alias}." if alias else ""
    return (
        f"CASE WHEN now() >= {prefix}life_ends_at THEN 'expired'"
        f" WHEN now() >= {prefix}last_activity + make_interval(secs => {CONFIG.session_idle_seconds}) THEN 'idle' END"
    )


async def close_session(conn: asyncpg.Connection, session_id: str, reason: str, actor_id: str, actor_session: str | None) -> bool:
    """End a session once. Returns whether this call was the one that ended it."""
    closed = await conn.fetchval(
        "UPDATE sessions SET closed_at = now() WHERE id = $1 AND closed_at IS NULL RETURNING id", session_id
    )
    if closed is None:
        return False
    await ledger.append(
        conn, actor_id=actor_id, session_id=actor_session, action="session.closed", target=session_id, detail={"reason": reason}
    )
    return True


async def authenticate(request: Request) -> Person:
    token = _cookie_token(request)
    if token is None:
        raise ApiError("unauthenticated")
    token_hash = digest_token(token)
    async with DB.connection() as conn:
        row = await conn.fetchrow(
            f"""SELECT s.id AS session_id, {session_ending("s")} AS ending, p.id, p.name, p.email, p.role
               FROM sessions s JOIN people p ON p.id = s.user_id
               WHERE s.token_hash = $1 AND s.closed_at IS NULL""",
            token_hash,
        )
        if row is None:
            raise ApiError("unauthenticated")
        if row["ending"]:
            async with conn.transaction():
                await close_session(conn, row["session_id"], row["ending"], "system", None)
            raise ApiError("unauthenticated")
        if not request.background:
            await conn.execute("UPDATE sessions SET last_activity = now() WHERE id = $1", row["session_id"])
    return Person(row["id"], row["name"], row["email"], row["role"], row["session_id"])


async def touch_session(person: Person) -> None:
    """A registration in flight, and its completion, count as activity."""
    async with DB.connection() as conn:
        await conn.execute("UPDATE sessions SET last_activity = now() WHERE id = $1 AND closed_at IS NULL", person.session_id)


@route("POST", "/api/sign-out")
async def sign_out(request: Request) -> Reply:
    person = request.person
    async with DB.tx() as conn:
        await close_session(conn, person.session_id, "signed_out", person.id, person.session_id)
    return Reply(204, None, {"set-cookie": f"{COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"})


@route("GET", "/api/session")
async def session_status(request: Request) -> Reply:
    person = request.person
    async with DB.connection() as conn:
        rows = await conn.fetch(
            f"""SELECT compartment_id, expires_at FROM grants
               WHERE user_id = $1 AND kind = 'break_glass' AND {grant_in_force()}
               ORDER BY compartment_id""",
            person.id,
        )
    return Reply(
        200,
        {
            "user": {"id": person.id, "name": person.name, "role": person.role, "email": person.email},
            "session_id": person.session_id,
            "server_time": fields.format_time(fields.now()),
            "break_glass": [
                {"compartment_id": r["compartment_id"], "ends_at": fields.format_time(r["expires_at"])} for r in rows
            ],
        },
    )


@route("POST", "/api/step-up")
async def step_up(request: Request) -> Reply:
    person = request.person
    identity = _identity(person.email)
    if (retry_after := await _locked_for(identity)) is not None:
        raise _locked(retry_after)
    body = request.require_body()
    form = fields.Form(body)
    password, code = body.get("password"), body.get("code")
    if not isinstance(password, str) or not password.strip(fields.TRIM):
        form.errors["password"] = fields.REQUIRED
    if not isinstance(code, str) or not code.strip(fields.TRIM):
        form.errors["code"] = fields.REQUIRED
    form.done()
    async with DB.connection() as conn:
        stored = await conn.fetchrow("SELECT password_hash, totp_secret FROM people WHERE id = $1", person.id)
    password_ok = await verify_password(password, stored["password_hash"])
    if not (password_ok and totp_valid(stored["totp_secret"], code.strip(fields.TRIM))):
        await _record_failure(identity, person.id, person.id, person.session_id)
        raise ApiError("step_up_failed")
    proof = new_token()
    async with DB.tx() as conn:
        await _clear_failures(conn, identity)
        await conn.execute(
            "INSERT INTO step_up_proofs (token_hash, session_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))",
            digest_token(proof),
            person.session_id,
            float(CONFIG.step_up_ttl_seconds),
        )
    return Reply(201, {"proof": proof, "expires_in_seconds": CONFIG.step_up_ttl_seconds})


def _proof_hash(request: Request) -> str | None:
    proof = request.headers.get("x-step-up-proof", "")
    return digest_token(proof) if TOKEN_SHAPE.fullmatch(proof) else None


async def require_proof(request: Request, conn: asyncpg.Connection) -> None:
    """A usable proof for this session, not yet consumed. Missing, expired, spent or foreign all answer alike."""
    proof_hash = _proof_hash(request)
    usable = proof_hash and await conn.fetchval(
        "SELECT 1 FROM step_up_proofs WHERE token_hash = $1 AND session_id = $2 AND used_at IS NULL AND expires_at > now()",
        proof_hash,
        request.person.session_id,
    )
    if not usable:
        raise request.step_up_required()


async def consume_proof(request: Request, conn: asyncpg.Connection) -> None:
    """Consume the proof in the action's own transaction. Of concurrent requests, one wins."""
    consumed = await conn.fetchval(
        """UPDATE step_up_proofs SET used_at = now()
           WHERE token_hash = $1 AND session_id = $2 AND used_at IS NULL AND expires_at > now() RETURNING 1""",
        _proof_hash(request),
        request.person.session_id,
    )
    if not consumed:
        raise request.step_up_required()

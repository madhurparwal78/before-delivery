"""Sessions, pending sign-ins, the sign-in routes and who is calling."""
from __future__ import annotations

import base64
import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import urlencode, urlsplit

import asyncpg
from starlette.requests import Request
from starlette.responses import RedirectResponse, Response

from . import db, domain, pages
from .errors import ApiError
from .realm import Identity, RealmUnavailable
from .state import State

SESSION_COOKIE = "strongroom_session"
SIGNIN_COOKIE = "strongroom_signin"
UNTOUCHED_PATHS = frozenset({"/api/events", "/api/status", "/api/health"})
ENDED_ALLOWED = frozenset({"/api/me", "/api/contact/grant"})


def digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@dataclass(frozen=True, slots=True)
class Grant:
    id: uuid.UUID
    contact_name: str
    contact_email: str
    contact_user_id: str | None
    duration: str
    levels: tuple[str, ...]
    created_at: datetime
    ends_at: datetime
    status: str
    remaining_seconds: int

    @classmethod
    def from_row(cls, row: asyncpg.Record, now: datetime) -> Grant:
        status = domain.grant_status(row["revoked_at"], row["ends_at"], now)
        return cls(row["id"], row["contact_name"], row["contact_email"], row["contact_user_id"], row["duration"],
                   domain.ordered_levels(row["levels"]), row["created_at"], row["ends_at"], status,
                   domain.remaining_seconds(status, row["ends_at"], now))


@dataclass(frozen=True, slots=True)
class Caller:
    session_id: str
    sub: str
    role: str
    vault_id: uuid.UUID
    email: str
    name: str
    now: datetime
    grant: Grant | None

    @property
    def is_owner(self) -> bool:
        return self.role == "owner"

    @property
    def scope(self) -> frozenset[str] | None:
        """The levels a contact sees; None for the owner, who sees everything."""
        return None if self.grant is None else frozenset(self.grant.levels)


async def session_of(state: State, conn: asyncpg.Connection, token: str | None, *, touch: bool) -> Caller | None:
    if not token:
        return None
    query = ("UPDATE app_session SET last_active = clock_timestamp() "
             "WHERE id = $1 AND clock_timestamp() < last_active + make_interval(secs => $2) "
             "RETURNING sub, role, vault_id, email, name, clock_timestamp() AS now") if touch else (
            "SELECT sub, role, vault_id, email, name, clock_timestamp() AS now FROM app_session "
            "WHERE id = $1 AND clock_timestamp() < last_active + make_interval(secs => $2)")
    row = await conn.fetchrow(query, digest(token), float(state.config.session_idle_seconds))
    if row is None:
        return None
    grant = None
    if row["role"] == "contact":
        found = await conn.fetchrow(
            "SELECT * FROM access_grant WHERE vault_id = $1 AND contact_user_id = $2 ORDER BY created_at DESC LIMIT 1",
            row["vault_id"], row["sub"])
        if found is not None:
            grant = Grant.from_row(found, row["now"])
    return Caller(token, row["sub"], row["role"], row["vault_id"], row["email"], row["name"], row["now"], grant)


async def caller(request: Request, conn: asyncpg.Connection) -> Caller:
    """The signed-in person, refused with 401 or (a contact whose grant ended) 403 as the precedence orders."""
    state: State = request.app.state.strongroom
    found = await session_of(state, conn, request.cookies.get(SESSION_COOKIE),
                             touch=request.url.path not in UNTOUCHED_PATHS)
    if found is None:
        raise ApiError("signed_out")
    if found.role == "contact" and (found.grant is None or found.grant.status != "active") \
            and request.url.path not in ENDED_ALLOWED:
        raise ApiError("access_ended")
    return found


# --------------------------------------------------------------------------- sign-in routes


def _origin(request: Request) -> str:
    state: State = request.app.state.strongroom
    return state.config.public_origin or f"{request.url.scheme}://{request.headers.get('host', request.url.netloc)}"


async def login(request: Request) -> Response:
    state: State = request.app.state.strongroom
    try:
        if not await state.realm.is_up():
            raise RealmUnavailable("realm down")
        try:
            seeded = await state.realm.ensure_seeded(db.SEED_ACCOUNTS)
        except RealmUnavailable:
            if not await state.realm.is_up():
                raise
            seeded = {}  # the realm answers; the seeded accounts are checked again on the next sign-in
    except RealmUnavailable:
        return pages.signin_unavailable()
    pending_id, signin_state, nonce = secrets.token_urlsafe(32), secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    async with state.pool.acquire() as conn:
        for email, user_id in seeded.items():
            await conn.execute("UPDATE access_grant SET contact_user_id = $1 WHERE contact_email = $2 "
                               "AND contact_user_id IS NULL", user_id, email)
        await conn.execute("DELETE FROM pending_signin WHERE created_at < clock_timestamp() - interval '1 day'")
        await conn.execute("INSERT INTO pending_signin (id, state, nonce, verifier, next_path) VALUES ($1,$2,$3,$4,$5)",
                           digest(pending_id), signin_state, nonce, verifier, request.query_params.get("next"))
    query = urlencode({"client_id": state.config.client_id, "response_type": "code", "scope": "openid email profile",
                       "redirect_uri": f"{_origin(request)}/auth/callback", "state": signin_state, "nonce": nonce,
                       "code_challenge": challenge, "code_challenge_method": "S256"})
    response = RedirectResponse(f"{state.realm.authorization_url()}?{query}", status_code=302)
    response.set_cookie(SIGNIN_COOKIE, pending_id, httponly=True, samesite="lax", path="/")
    return response


async def callback(request: Request) -> Response:
    state: State = request.app.state.strongroom
    pending_id, signin_state = request.cookies.get(SIGNIN_COOKIE), request.query_params.get("state")
    code = request.query_params.get("code")
    if not pending_id or not signin_state or not code:
        return pages.signin_failed()
    async with state.pool.acquire() as conn:
        pending = await conn.fetchrow(
            "UPDATE pending_signin SET consumed_at = clock_timestamp() WHERE id = $1 AND state = $2 "
            "AND consumed_at IS NULL AND clock_timestamp() < created_at + make_interval(secs => $3) "
            "RETURNING nonce, verifier, next_path", digest(pending_id), signin_state,
            float(state.config.signin_pending_seconds))
    if pending is None:
        return pages.signin_failed()
    try:
        identity = await state.realm.exchange_code(code, pending["verifier"], f"{_origin(request)}/auth/callback",
                                                   pending["nonce"])
    except RealmUnavailable:
        return pages.signin_unavailable()
    if identity is None:
        return pages.signin_failed()
    token = secrets.token_urlsafe(32)
    async with state.pool.acquire() as conn:
        role, vault_id, name = await _resolve(conn, identity)
        await conn.execute("INSERT INTO app_session (id, sub, role, vault_id, email, name) VALUES ($1,$2,$3,$4,$5,$6)",
                           digest(token), identity.sub, role, vault_id, identity.email, name)
    response = RedirectResponse(domain.safe_return_path(pending["next_path"], role), status_code=303)
    response.set_cookie(SESSION_COOKIE, token, httponly=True, samesite="lax", path="/")
    response.delete_cookie(SIGNIN_COOKIE, path="/")
    return response


async def _resolve(conn: asyncpg.Connection, identity: Identity) -> tuple[str, uuid.UUID, str]:
    """Matches the account to its vault or grant; any other account gets exactly one new vault."""
    async with conn.transaction():
        owned = await conn.fetchrow("SELECT id, owner_name FROM vault WHERE owner_sub = $1", identity.sub)
        if owned is None:
            owned = await conn.fetchrow("UPDATE vault SET owner_sub = $1 WHERE owner_sub IS NULL AND owner_email = $2 "
                                        "RETURNING id, owner_name", identity.sub, identity.email)
        if owned is not None:
            return "owner", owned["id"], owned["owner_name"]
        grant = await conn.fetchrow(
            "UPDATE access_grant SET contact_user_id = $1 WHERE id = (SELECT id FROM access_grant "
            "WHERE contact_user_id = $1 OR (contact_user_id IS NULL AND contact_email = $2) "
            "ORDER BY created_at DESC LIMIT 1) RETURNING vault_id, contact_name", identity.sub, identity.email)
        if grant is not None:
            return "contact", grant["vault_id"], grant["contact_name"]
        created = await conn.fetchval(
            "INSERT INTO vault (id, owner_sub, owner_email, owner_name) VALUES ($1, $2, $3, $4) "
            "ON CONFLICT (owner_sub) DO NOTHING RETURNING id", uuid.uuid4(), identity.sub, identity.email, identity.name)
        if created is not None:
            await db.insert_rules(conn, created, [(k, "", lv) for k, lv in domain.DEFAULT_RULES])
            return "owner", created, identity.name
        owned = await conn.fetchrow("SELECT id, owner_name FROM vault WHERE owner_sub = $1", identity.sub)
        return "owner", owned["id"], owned["owner_name"]


async def logout(request: Request) -> Response:
    state: State = request.app.state.strongroom
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        async with state.pool.acquire() as conn:
            await conn.execute("DELETE FROM app_session WHERE id = $1", digest(token))
    response = Response(status_code=204)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response


def same_origin(request: Request, origin: str) -> bool:
    own = urlsplit(f"{request.url.scheme}://{request.headers.get('host', '')}")
    other = urlsplit(origin)
    return (other.scheme, other.netloc.lower()) == (own.scheme, own.netloc.lower())

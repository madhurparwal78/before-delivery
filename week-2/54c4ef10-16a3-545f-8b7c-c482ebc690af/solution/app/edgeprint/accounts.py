"""Accounts and sessions: scrypt password hashes, hashed session tokens, sign-up, sign-in, sign-out and /api/me."""

import secrets
import uuid
from typing import Any

import anyio
import asyncpg
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from .context import latest_aligned_frame
from .errors import ApiError
from .http import read_json, require_account, respond
from .passwords import hash_password, password_matches
from .sessions import SESSION_COOKIE, Account, token_hash
from .validation import Form, email, password

async def _start_session(request: Request, account: Account, status: int) -> JSONResponse:
    ttl = request.app.state.settings.session_ttl_seconds
    token = secrets.token_urlsafe(32)
    async with request.app.state.db.connection() as connection:
        await connection.execute(
            "INSERT INTO sessions (token_hash, account_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))",
            token_hash(token), account.id, float(ttl))
    response = respond({"id": str(account.id), "email": account.email}, status)
    response.set_cookie(SESSION_COOKIE, token, max_age=ttl, httponly=True, samesite="lax", path="/")
    return response


def _credentials(body: dict[str, Any]) -> dict[str, Any]:
    form = Form(body)
    form.field("email", email)
    form.field("password", password)
    return form.done()


async def sign_up(request: Request) -> JSONResponse:
    values = _credentials(await read_json(request))
    password_hash = await anyio.to_thread.run_sync(hash_password, values["password"])
    account = Account(uuid.uuid4(), values["email"])
    try:
        async with request.app.state.db.connection() as connection:
            await connection.execute("INSERT INTO accounts (id, email, password_hash) VALUES ($1, $2, $3)",
                                     account.id, account.email, password_hash)
    except asyncpg.UniqueViolationError as error:
        raise ApiError(409, "email_taken") from error
    return await _start_session(request, account, 201)


async def sign_in(request: Request) -> JSONResponse:
    body = await read_json(request)
    address, password = body.get("email"), body.get("password")
    async with request.app.state.db.connection() as connection:
        row = await connection.fetchrow("SELECT id, email, password_hash FROM accounts WHERE email = $1",
                                        address.strip().lower() if isinstance(address, str) else "")
    if row is None or not isinstance(password, str) \
            or not await anyio.to_thread.run_sync(password_matches, password, row["password_hash"]):
        raise ApiError(401, "invalid_credentials")
    return await _start_session(request, Account(row["id"], row["email"]), 200)


async def sign_out(request: Request) -> Response:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        async with request.app.state.db.connection() as connection:
            await connection.execute("DELETE FROM sessions WHERE token_hash = $1", token_hash(token))
    response = Response(status_code=204)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response


async def me(request: Request) -> JSONResponse:
    account = await require_account(request)
    async with request.app.state.db.connection() as connection:
        frame = await latest_aligned_frame(connection, account.id)
    return respond({"id": str(account.id), "email": account.email, "latest_aligned_frame": frame})


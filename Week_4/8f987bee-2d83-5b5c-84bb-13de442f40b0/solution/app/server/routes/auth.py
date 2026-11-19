"""Sign-in, sign-out, invitation acceptance and the signed-in user's own record."""

import uuid
from typing import Literal

import asyncpg
from fastapi import APIRouter, Depends, Request, Response

from ..auth import Member, current_member, hash_password, open_session, sign_in, token_hash
from ..db import db, utcnow
from ..errors import ApiError, not_found, validation
from ..inputs import Body, parse, raw_json, shape_errors
from ..invites import expired
from ..redirects import redirect_to
from ..views import Accepted, Me, PreferencesOut, SignedIn

router = APIRouter()
NEXT_MAX = 2000
PASSWORD_MIN = 12


class LoginIn(Body):
    email: str
    password: str
    next: str = ""


class AcceptIn(Body):
    invite_token: str
    password: str = ""


class PreferencesIn(Body):
    sync_sounds: bool | None = None
    theme: Literal["light", "dark"] | None = None


async def user_view(conn: asyncpg.Connection, user_id: uuid.UUID) -> dict:
    row = await conn.fetchrow("SELECT u.id, u.email, u.name, u.preferences, m.role, m.workspace_id FROM users u "
                              "JOIN memberships m ON m.user_id = u.id WHERE u.id = $1", user_id)
    return {"id": str(row["id"]), "email": row["email"], "name": row["name"], "role": row["role"],
            "workspace_id": str(row["workspace_id"]), "preferences": row["preferences"]}


@router.post("/api/auth/login", response_model=SignedIn)
async def login(request: Request) -> dict:
    body = parse(request, LoginIn)
    if len(body.next) > NEXT_MAX:
        raise validation({"next": "Send a return address of at most 2,000 characters."})
    async with db.transaction() as conn:
        outcome = await sign_in(conn, body.email, body.password)
        if isinstance(outcome, ApiError):
            refusal = outcome
        else:
            refusal = None
            session_token = await open_session(conn, outcome["id"])
            user = await user_view(conn, outcome["id"])
    if refusal is not None:
        raise refusal
    return {"token": session_token, "user": user, "redirect_to": redirect_to(body.next)}


@router.post("/api/auth/logout", status_code=204)
async def logout(request: Request, member: Member = Depends(current_member)) -> Response:
    parse(request, Body)
    async with db.transaction() as conn:
        await conn.execute("DELETE FROM sessions WHERE token_hash = $1", member.session)
    return Response(status_code=204)


@router.post("/api/auth/accept-invite", response_model=Accepted)
async def accept_invite(request: Request) -> dict:
    """Acceptance checks in its own order: input, unknown, used, expired, unusable, password."""
    parsed, fields = shape_errors(AcceptIn, raw_json(request))
    if fields:
        raise validation(fields)
    async with db.transaction() as conn:
        invite = await conn.fetchrow("SELECT * FROM invites WHERE token_hash = $1 FOR UPDATE",
                                     token_hash(parsed.invite_token))
        if invite is None:
            raise not_found()
        if invite["used"]:
            raise ApiError(409, "invite_used")
        if expired(invite["expires_at"]):
            raise ApiError(410, "invite_expired")
        if await conn.fetchval("SELECT EXISTS (SELECT 1 FROM users WHERE email = $1)", invite["email"]):
            raise ApiError(409, "invite_unusable")
        if len(parsed.password) < PASSWORD_MIN:
            raise validation({"password": "Choose a password of at least 12 characters."})
        user_id = uuid.uuid4()
        now = utcnow()
        await conn.execute("INSERT INTO users (id, email, name, password_hash, preferences, created_at) "
                           "VALUES ($1, $2, $3, $4, $5, $6)", user_id, invite["email"], invite["name"],
                           await hash_password(parsed.password), {"sync_sounds": False, "theme": "light"}, now)
        await conn.execute("INSERT INTO memberships (user_id, workspace_id, role, created_at) VALUES ($1, $2, $3, $4)",
                           user_id, invite["workspace_id"], invite["role"], now)
        await conn.execute("UPDATE invites SET used = true WHERE id = $1", invite["id"])
        session_token = await open_session(conn, user_id)
        user = await user_view(conn, user_id)
    return {"token": session_token, "user": user}


@router.get("/api/me", response_model=Me)
async def me(member: Member = Depends(current_member)) -> dict:
    return {"user": member.public()}


@router.patch("/api/me/preferences", response_model=PreferencesOut)
async def preferences(request: Request, member: Member = Depends(current_member)) -> dict:
    body = parse(request, PreferencesIn)
    changes = body.model_dump(exclude_none=True)
    async with db.transaction() as conn:
        stored = await conn.fetchval("UPDATE users SET preferences = preferences || $2::jsonb WHERE id = $1 "
                                     "RETURNING preferences", member.id, changes)
    return {"preferences": stored}

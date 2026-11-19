"""Sessions, lockout, invitation acceptance, the signed-in user and their preferences."""

from __future__ import annotations

import math
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import Response

from ..config import settings
from ..context import Caller, require_session
from ..db import database
from ..errors import ApiError
from ..models import AcceptInviteBody, LoginBody, PreferencesBody
from ..navigation import resolve_return_address
from ..security import hash_password, new_token, token_fingerprint, verify_password
from ..seed import DEFAULT_PREFERENCES
from ..validation import parse_body
from .common import ok, raw_body

router = APIRouter()

MINIMUM_PASSWORD_LENGTH = 12
FAILURES_BEFORE_LOCK = 5


def user_payload(caller: Caller) -> dict[str, Any]:
    return {
        "id": str(caller.user_id),
        "email": caller.email,
        "name": caller.name,
        "role": caller.role,
        "workspace_id": str(caller.workspace_id),
        "preferences": caller.preferences,
    }


def normalized_email(raw: str) -> str:
    return raw.strip().lower()


@router.post("/api/auth/login")
async def login(request: Request) -> Any:
    body = parse_body(await raw_body(request), LoginBody)
    email = normalized_email(body.email)
    now = datetime.now(timezone.utc)
    locked_seconds: int | None = None
    token: str | None = None
    user = membership = None
    async with database.transaction() as conn:
        attempts = await conn.fetchrow(
            "SELECT * FROM login_attempts WHERE email = $1 FOR UPDATE", email
        )
        if attempts is not None and attempts["locked_until"] is not None and attempts["locked_until"] > now:
            locked_seconds = math.ceil((attempts["locked_until"] - now).total_seconds())
        else:
            user = await conn.fetchrow("SELECT * FROM users WHERE email = $1", email)
            if user is None or not verify_password(body.password, user["password_hash"]):
                await _record_failure(conn, email, attempts, now)
                user = None
            else:
                await conn.execute("DELETE FROM login_attempts WHERE email = $1", email)
                token = new_token()
                await conn.execute(
                    "INSERT INTO sessions (token_hash, user_id, created_at) VALUES ($1, $2, $3)",
                    token_fingerprint(token),
                    user["id"],
                    now,
                )
                membership = await conn.fetchrow(
                    "SELECT role, workspace_id FROM memberships WHERE user_id = $1", user["id"]
                )
    if locked_seconds is not None:
        raise ApiError(
            "too_many_attempts",
            headers={"Retry-After": str(max(1, min(locked_seconds, settings.lockout_seconds)))},
        )
    if user is None:
        raise ApiError("invalid_credentials")
    return ok(
        {
            "token": token,
            "user": {
                "id": str(user["id"]),
                "email": user["email"],
                "name": user["name"],
                "role": membership["role"],
                "workspace_id": str(membership["workspace_id"]),
                "preferences": user["preferences"],
            },
            "redirect_to": resolve_return_address(body.next),
        }
    )


async def _record_failure(conn: Any, email: str, attempts: Any, now: datetime) -> None:
    window = timedelta(seconds=settings.lockout_seconds)
    if attempts is None or now - attempts["window_started_at"] > window or attempts["locked_until"] is not None:
        failures, window_started_at = 1, now
    else:
        failures, window_started_at = attempts["failures"] + 1, attempts["window_started_at"]
    locked_until = now + window if failures >= FAILURES_BEFORE_LOCK else None
    await conn.execute(
        """
        INSERT INTO login_attempts (email, failures, window_started_at, locked_until)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (email) DO UPDATE
            SET failures = $2, window_started_at = $3, locked_until = $4
        """,
        email,
        failures,
        window_started_at,
        locked_until,
    )


@router.post("/api/auth/logout")
async def logout(request: Request) -> Any:
    caller = await require_session(request)
    await database.execute("DELETE FROM sessions WHERE token_hash = $1", token_fingerprint(caller.token))
    return Response(status_code=204)


@router.post("/api/auth/accept-invite")
async def accept_invite(request: Request) -> Any:
    body = parse_body(await raw_body(request), AcceptInviteBody)
    now = datetime.now(timezone.utc)
    async with database.transaction() as conn:
        invite = await conn.fetchrow(
            "SELECT * FROM invites WHERE token_hash = $1 FOR UPDATE",
            token_fingerprint(body.invite_token),
        )
        if invite is None:
            raise ApiError("not_found")
        if invite["used"]:
            raise ApiError("invite_used")
        if now >= invite["expires_at"]:
            raise ApiError("invite_expired")
        existing = await conn.fetchval("SELECT exists (SELECT 1 FROM users WHERE email = $1)", invite["email"])
        if existing:
            raise ApiError("invite_unusable")
        if body.password is None or len(body.password) < MINIMUM_PASSWORD_LENGTH:
            raise ApiError(
                "validation", fields={"password": "This password must be at least twelve characters."}
            )
        user_id = uuid.uuid4()
        await conn.execute(
            """
            INSERT INTO users (id, email, name, password_hash, preferences, created_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            user_id,
            invite["email"],
            invite["name"],
            hash_password(body.password),
            DEFAULT_PREFERENCES,
            now,
        )
        await conn.execute(
            "INSERT INTO memberships (user_id, workspace_id, role) VALUES ($1, $2, $3)",
            user_id,
            invite["workspace_id"],
            invite["role"],
        )
        await conn.execute("UPDATE invites SET used = true WHERE id = $1", invite["id"])
        token = new_token()
        await conn.execute(
            "INSERT INTO sessions (token_hash, user_id, created_at) VALUES ($1, $2, $3)",
            token_fingerprint(token),
            user_id,
            now,
        )
    return ok(
        {
            "token": token,
            "user": {
                "id": str(user_id),
                "email": invite["email"],
                "name": invite["name"],
                "role": invite["role"],
                "workspace_id": str(invite["workspace_id"]),
                "preferences": DEFAULT_PREFERENCES,
            },
        }
    )


@router.get("/api/me")
async def read_me(request: Request) -> Any:
    caller = await require_session(request)
    return ok({"user": user_payload(caller)})


@router.patch("/api/me/preferences")
async def change_preferences(request: Request) -> Any:
    caller = await require_session(request)
    body = parse_body(await raw_body(request), PreferencesBody)
    preferences = dict(caller.preferences)
    if body.sync_sounds is not None:
        preferences["sync_sounds"] = body.sync_sounds
    if body.theme is not None:
        preferences["theme"] = body.theme
    await database.execute(
        "UPDATE users SET preferences = $2 WHERE id = $1", caller.user_id, preferences
    )
    return ok({"preferences": preferences})


@router.get("/api/health")
async def health(request: Request) -> Any:
    if not database.ready:
        return ok({"status": "starting"}, status=503)
    return ok({"status": "ok"})

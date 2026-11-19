"""Sign-up, sign-in, the session and the member's own profile."""

from __future__ import annotations

from typing import Any

import asyncpg
from starlette.responses import Response

from ..app import Ctx
from ..auth import (
    clear_login_failures,
    confirm_email_token,
    create_session,
    lock_login_email,
    lockout_refusal,
    queue_confirmation,
    record_login_failure,
    revoke_other_sessions,
    revoke_session,
    self_user,
)
from ..db import DB
from ..errors import ApiError, conflict, invalid
from ..mail import queue_email
from ..passwords import hash_password, verify_password
from ..users import APP_ICONS, STATUSES
from ..validation import (
    clean_date_of_birth,
    clean_display_name,
    clean_email,
    clean_password,
    clean_username,
)
from .common import json_response, no_content


async def health(ctx: Ctx) -> Response:
    if await DB.healthy():
        return json_response({"status": "ok"})
    return json_response({"status": "starting"}, 503)


async def signup(ctx: Ctx) -> Response:
    body = ctx.body()
    email = clean_email(body.raw("email"))
    display_name = clean_display_name(body.raw("display_name"))
    username = clean_username(body.raw("username"))
    password = clean_password(body.raw("password"))
    date_of_birth = clean_date_of_birth(body.raw("date_of_birth"))

    async with DB.transaction() as conn:
        try:
            async with conn.transaction():
                row = await conn.fetchrow(
                    """
                    INSERT INTO members (email, username, display_name, avatar_ref,
                                         password_hash, date_of_birth, status, tier, app_icon)
                    VALUES ($1, $2, $3, 'avatars/default.png', $4, $5,
                            'online', 'free', 'classic')
                    RETURNING id, email, username, display_name
                    """,
                    email,
                    username,
                    display_name,
                    hash_password(password),
                    date_of_birth,
                )
        except asyncpg.UniqueViolationError:
            raise await _duplicate_field(conn, email) from None
        await queue_confirmation(conn, row)
        token = await create_session(conn, row["id"])
        user = await self_user(conn, row["id"])
    return json_response({"access_token": token, "token_type": "bearer", "user": user}, 201)


async def _duplicate_field(conn: asyncpg.Connection, email: str) -> ApiError:
    taken = await conn.fetchval("SELECT 1 FROM members WHERE lower(email) = lower($1)", email)
    return conflict("email") if taken else conflict("username")


async def login(ctx: Ctx) -> Response:
    body = ctx.body()
    raw_email = body.text("email") or ""
    password = body.text("password") or ""
    refusal: ApiError | None = None
    token = ""
    user: dict[str, Any] = {}
    async with DB.transaction() as conn:
        await lock_login_email(conn, raw_email)
        refusal = await lockout_refusal(conn, raw_email)
        if refusal is None:
            row = await conn.fetchrow(
                "SELECT id, password_hash FROM members WHERE lower(email) = lower($1)", raw_email
            )
            if row is None or not verify_password(password, row["password_hash"]):
                await record_login_failure(conn, raw_email)
                refusal = ApiError(401, "invalid_credentials")
            else:
                await clear_login_failures(conn, raw_email)
                token = await create_session(conn, row["id"])
                user = await self_user(conn, row["id"])
    if refusal is not None:
        raise refusal
    return json_response({"access_token": token, "token_type": "bearer", "user": user})


async def logout(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    async with DB.transaction() as conn:
        await revoke_session(conn, ctx.caller.token_digest)
    return no_content()


async def verify_email(ctx: Ctx) -> Response:
    body = ctx.body()
    token = body.text("token")
    if not token:
        raise invalid("token")
    async with DB.transaction() as conn:
        await confirm_email_token(conn, token)
    return json_response({"email_verified": True})


async def resend_confirmation(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    async with DB.transaction() as conn:
        row = await conn.fetchrow(
            "SELECT id, email, username, display_name, email_verified FROM members WHERE id = $1",
            ctx.caller.id,
        )
        if row["email_verified"]:
            raise conflict(None)
        await queue_confirmation(conn, row)
    return no_content()


async def read_me(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    return json_response(ctx.caller.as_self())


async def patch_me(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    body = ctx.body()
    updates: dict[str, Any] = {}
    if body.has("display_name"):
        updates["display_name"] = clean_display_name(body.raw("display_name"))
    if body.has("status"):
        status = body.text("status")
        if status not in STATUSES:
            raise invalid("status")
        updates["status"] = status
    if body.has("app_icon"):
        app_icon = body.text("app_icon")
        if app_icon not in APP_ICONS:
            raise invalid("app_icon")
        if app_icon != "classic" and not ctx.caller.has("custom_app_icons"):
            raise ApiError(403, "entitlement_required")
        updates["app_icon"] = app_icon

    async with DB.transaction() as conn:
        if updates:
            assignments = ", ".join(
                f"{name} = ${index}" for index, name in enumerate(updates, start=2)
            )
            await conn.execute(
                f"UPDATE members SET {assignments} WHERE id = $1",
                ctx.caller.id,
                *updates.values(),
            )
        if "status" in updates:
            await _announce_presence(conn, ctx.caller.id)
        user = await self_user(conn, ctx.caller.id)
    return json_response(user)


async def _announce_presence(conn: asyncpg.Connection, member_id: int) -> None:
    from ..live import publish
    from ..users import public_user, visible_status

    row = await conn.fetchrow(
        "SELECT id, username, display_name, avatar_ref, status FROM members WHERE id = $1",
        member_id,
    )
    communities = await conn.fetch(
        "SELECT community_id FROM memberships WHERE member_id = $1", member_id
    )
    for community in communities:
        await publish(
            conn,
            "presence_update",
            {
                "community_id": community["community_id"],
                "user": public_user(row),
                "status": visible_status(row["status"]),
            },
            community_id=community["community_id"],
        )


async def change_password(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    body = ctx.body()
    current_password = clean_password(body.raw("current_password"), "current_password")
    new_password = clean_password(body.raw("new_password"), "new_password")

    async with DB.transaction() as conn:
        row = await conn.fetchrow(
            "SELECT id, email, display_name, password_hash FROM members WHERE id = $1 FOR UPDATE",
            ctx.caller.id,
        )
        if not verify_password(current_password, row["password_hash"]):
            raise invalid("current_password")
        if verify_password(new_password, row["password_hash"]):
            raise invalid("new_password")
        await conn.execute(
            "UPDATE members SET password_hash = $2 WHERE id = $1",
            ctx.caller.id,
            hash_password(new_password),
        )
        await revoke_other_sessions(conn, ctx.caller.id, ctx.caller.token_digest)
        await queue_email(
            conn,
            recipient=row["email"],
            recipient_name=row["display_name"],
            subject="Your Community Hub password was changed",
            body=(
                f"Hi {row['display_name']}, the password for your Community Hub account "
                "was just changed.\nEvery other signed-in session has been signed out.\n"
                "If this was not you, change your password again straight away.\n"
            ),
        )
    return no_content()

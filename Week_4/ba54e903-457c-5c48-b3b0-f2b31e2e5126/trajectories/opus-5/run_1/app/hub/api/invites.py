"""Invites: their shape, their validity by the database clock, and accepting them."""

from __future__ import annotations

import secrets
from typing import Any

import asyncpg
from starlette.responses import Response

from ..app import Ctx
from ..db import DB
from ..errors import forbidden, not_found
from ..times import iso
from ..users import public_user
from .common import COMMUNITY_COLUMNS, community_row, json_response, no_content
from .communities import default_channel_id, join_community

CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
VALID = """
    i.revoked_at IS NULL
    AND (i.max_uses = 0 OR i.uses < i.max_uses)
    AND (i.expires_at IS NULL OR i.expires_at > clock_timestamp())
"""

INVITE_COLUMNS = """
    i.id, i.code, i.community_id, i.uses, i.max_uses, i.max_age_seconds, i.expires_at,
    i.created_at, i.inviter_id, m.username AS inviter_username,
    m.display_name AS inviter_display_name, m.avatar_ref AS inviter_avatar_ref
"""


def new_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))


async def invite_json(conn: asyncpg.Connection, row: asyncpg.Record) -> dict[str, Any]:
    channel_id = await default_channel_id(conn, row["community_id"])
    return {
        "code": row["code"],
        "community_id": row["community_id"],
        "channel_id": channel_id,
        "inviter": public_user(
            {
                "id": row["inviter_id"],
                "username": row["inviter_username"],
                "display_name": row["inviter_display_name"],
                "avatar_ref": row["inviter_avatar_ref"],
            }
        ),
        "uses": row["uses"],
        "max_uses": row["max_uses"],
        "max_age_seconds": row["max_age_seconds"],
        "expires_at": iso(row["expires_at"]),
        "created_at": iso(row["created_at"]),
    }


async def create_invite(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    body = ctx.body()
    max_uses = body.whole_number("max_uses", 0, 100) if body.has("max_uses") else 0
    max_age = (
        body.whole_number("max_age_seconds", 0, 604800) if body.has("max_age_seconds") else 86400
    )
    async with DB.transaction() as conn:
        community = await community_row(conn, ctx.params["slug"], ctx.caller)
        from ..permissions import load_member_state

        state = await load_member_state(conn, community["id"], ctx.caller.id)
        if state is None or not state.can("create_invite"):
            raise forbidden()
        row = await conn.fetchrow(
            f"""
            WITH made AS (
                INSERT INTO invites (code, community_id, inviter_id, uses, max_uses,
                                     max_age_seconds, created_at, expires_at)
                VALUES ($1, $2, $3, 0, $4, $5, date_trunc('second', clock_timestamp()),
                        CASE WHEN $5 = 0 THEN NULL
                             ELSE date_trunc('second', clock_timestamp())
                                  + make_interval(secs => $5) END)
                RETURNING *
            )
            SELECT {INVITE_COLUMNS} FROM made i JOIN members m ON m.id = i.inviter_id
            """,
            new_code(),
            community["id"],
            ctx.caller.id,
            max_uses,
            max_age,
        )
        payload = await invite_json(conn, row)
    return json_response(payload, 201)


async def list_invites(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    async with DB.connection() as conn:
        community = await community_row(conn, ctx.params["slug"], ctx.caller)
        if community["owner_id"] != ctx.caller.id:
            raise forbidden()
        rows = await conn.fetch(
            f"""
            SELECT {INVITE_COLUMNS} FROM invites i JOIN members m ON m.id = i.inviter_id
            WHERE i.community_id = $1 AND {VALID} ORDER BY i.created_at, i.id
            """,
            community["id"],
        )
        data = [await invite_json(conn, row) for row in rows]
    return json_response({"data": data})


async def read_invite(ctx: Ctx) -> Response:
    async with DB.connection() as conn:
        row = await conn.fetchrow(
            f"""
            SELECT {INVITE_COLUMNS} FROM invites i JOIN members m ON m.id = i.inviter_id
            WHERE i.code = $1 AND {VALID}
            """,
            ctx.params["code"],
        )
        if row is None:
            raise not_found()
        community = await conn.fetchrow(
            f"SELECT {COMMUNITY_COLUMNS} FROM communities c WHERE c.id = $1", row["community_id"]
        )
    return json_response(
        {
            "code": row["code"],
            "community": {
                "id": community["id"],
                "slug": community["slug"],
                "name": community["name"],
                "icon_url": f"/static/media/{community['icon_ref']}",
                "member_count": int(community["member_count"]),
                "presence_count": int(community["presence_count"]),
            },
            "inviter": public_user(
                {
                    "id": row["inviter_id"],
                    "username": row["inviter_username"],
                    "display_name": row["inviter_display_name"],
                    "avatar_ref": row["inviter_avatar_ref"],
                }
            ),
            "expires_at": iso(row["expires_at"]),
        }
    )


async def revoke_invite(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    async with DB.transaction() as conn:
        row = await conn.fetchrow(
            f"""
            SELECT i.*, c.owner_id FROM invites i JOIN communities c ON c.id = i.community_id
            WHERE i.code = $1 AND {VALID}
            FOR UPDATE OF i
            """,
            ctx.params["code"],
        )
        if row is None:
            raise not_found()
        if ctx.caller.id not in (row["inviter_id"], row["owner_id"]):
            raise forbidden()
        await conn.execute(
            "UPDATE invites SET revoked_at = date_trunc('second', now()) WHERE id = $1",
            row["id"],
        )
    return no_content()


async def accept_invite(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    async with DB.transaction() as conn:
        row = await conn.fetchrow(
            f"SELECT i.* FROM invites i WHERE i.code = $1 AND {VALID} FOR UPDATE",
            ctx.params["code"],
        )
        if row is None:
            raise not_found()
        created = await join_community(conn, row["community_id"], ctx.caller.id)
        if created:
            await conn.execute("UPDATE invites SET uses = uses + 1 WHERE id = $1", row["id"])
        channel_id = await default_channel_id(conn, row["community_id"])
        role = await conn.fetchval(
            "SELECT role FROM memberships WHERE community_id = $1 AND member_id = $2",
            row["community_id"],
            ctx.caller.id,
        )
    return json_response(
        {
            "joined": True,
            "community_id": row["community_id"],
            "default_channel_id": channel_id,
            "role": role,
        },
        201 if created else 200,
    )

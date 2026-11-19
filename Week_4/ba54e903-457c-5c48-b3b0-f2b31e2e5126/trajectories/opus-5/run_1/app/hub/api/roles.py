"""Roles, assignments, channel overwrites and the caller's own permissions."""

from __future__ import annotations

from typing import Any

import asyncpg
from starlette.responses import Response

from ..app import Ctx
from ..db import DB
from ..errors import conflict, forbidden, invalid, not_found
from ..live import publish
from ..permissions import (
    PERMISSION_KEYS,
    MemberState,
    channel_permissions,
    load_member_state,
    outranks,
    rank_of,
)
from ..validation import bounded_text
from .common import (
    channel_row,
    community_row,
    is_member,
    json_response,
    member_state_or_403,
    no_content,
)


def role_json(row: asyncpg.Record) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "position": row["position"],
        "permissions": sorted(row["permissions"]),
        "is_default": row["is_default"],
    }


def clean_permissions(raw: Any, field: str) -> list[str]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise invalid(field)
    keys: list[str] = []
    for item in raw:
        if not isinstance(item, str) or item not in PERMISSION_KEYS:
            raise invalid(field)
        keys.append(item)
    return sorted(set(keys))


async def lock_actor_roles(
    conn: asyncpg.Connection, community_id: int, member_id: int
) -> None:
    """Hold the actor's own role assignments, so a removal that answers first wins."""
    await conn.fetch(
        "SELECT id FROM member_roles WHERE community_id = $1 AND member_id = $2 FOR SHARE",
        community_id,
        member_id,
    )


async def manager_state(
    conn: asyncpg.Connection, community_id: int, ctx: Ctx
) -> MemberState:
    assert ctx.caller is not None
    await lock_actor_roles(conn, community_id, ctx.caller.id)
    state = await member_state_or_403(conn, community_id, ctx.caller)
    if not state.can("manage_roles"):
        raise forbidden()
    return state


def refuse_keys_the_manager_lacks(state: MemberState, keys: list[str], field: str) -> None:
    if state.is_owner:
        return
    if set(keys) - set(state.community_permissions):
        raise forbidden()


async def list_roles(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    async with DB.connection() as conn:
        community = await community_row(conn, ctx.params["slug"], ctx.caller)
        if not await is_member(conn, community["id"], ctx.caller.id):
            raise forbidden()
        rows = await conn.fetch(
            "SELECT * FROM roles WHERE community_id = $1 ORDER BY position, id", community["id"]
        )
    return json_response({"data": [role_json(row) for row in rows]})


async def create_role(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    async with DB.transaction() as conn:
        community = await community_row(conn, ctx.params["slug"], ctx.caller)
        state = await manager_state(conn, community["id"], ctx)
        body = ctx.body()
        name = bounded_text(body, "name", 1, 32)
        if name.lower() == "@everyone":
            raise invalid("name")
        permissions = clean_permissions(body.raw("permissions"), "permissions")
        refuse_keys_the_manager_lacks(state, permissions, "permissions")
        taken = await conn.fetchval(
            "SELECT 1 FROM roles WHERE community_id = $1 AND lower(name) = lower($2)",
            community["id"],
            name,
        )
        if taken:
            raise conflict("name")
        if state.is_owner:
            position = int(
                await conn.fetchval(
                    "SELECT COALESCE(max(position), 0) + 1 FROM roles WHERE community_id = $1",
                    community["id"],
                )
            )
        else:
            position = state.rank
            await conn.execute(
                "UPDATE roles SET position = position + 1 WHERE community_id = $1 "
                "AND position >= $2",
                community["id"],
                position,
            )
        row = await conn.fetchrow(
            """
            INSERT INTO roles (community_id, name, position, permissions, is_default)
            VALUES ($1, $2, $3, $4, false) RETURNING *
            """,
            community["id"],
            name,
            position,
            permissions,
        )
    return json_response(role_json(row), 201)


async def _role_and_community(
    conn: asyncpg.Connection, role_id: int
) -> tuple[asyncpg.Record, int]:
    row = await conn.fetchrow("SELECT * FROM roles WHERE id = $1", role_id)
    if row is None:
        raise not_found()
    return row, row["community_id"]


async def patch_role(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    async with DB.transaction() as conn:
        role, community_id = await _role_and_community(conn, ctx.params["role_id"])
        state = await manager_state(conn, community_id, ctx)
        if not outranks(state, role["position"]):
            raise forbidden()
        body = ctx.body()
        updates: dict[str, Any] = {}
        if body.has("name"):
            name = bounded_text(body, "name", 1, 32)
            if role["is_default"]:
                raise invalid("name")
            if name.lower() == "@everyone":
                raise invalid("name")
            taken = await conn.fetchval(
                """
                SELECT 1 FROM roles WHERE community_id = $1 AND lower(name) = lower($2)
                  AND id <> $3
                """,
                community_id,
                name,
                role["id"],
            )
            if taken:
                raise conflict("name")
            updates["name"] = name
        if body.has("permissions"):
            permissions = clean_permissions(body.raw("permissions"), "permissions")
            refuse_keys_the_manager_lacks(state, permissions, "permissions")
            updates["permissions"] = permissions
        if updates:
            assignments = ", ".join(
                f"{name} = ${index}" for index, name in enumerate(updates, start=2)
            )
            await conn.execute(
                f"UPDATE roles SET {assignments} WHERE id = $1", role["id"], *updates.values()
            )
        fresh = await conn.fetchrow("SELECT * FROM roles WHERE id = $1", role["id"])
        await _announce_community_access(conn, community_id)
    return json_response(role_json(fresh))


async def delete_role(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    async with DB.transaction() as conn:
        role, community_id = await _role_and_community(conn, ctx.params["role_id"])
        state = await manager_state(conn, community_id, ctx)
        if role["is_default"]:
            raise conflict("role_id")
        if not outranks(state, role["position"]):
            raise forbidden()
        holders = [
            row["member_id"]
            for row in await conn.fetch(
                "SELECT member_id FROM member_roles WHERE role_id = $1", role["id"]
            )
        ]
        await conn.execute("DELETE FROM roles WHERE id = $1", role["id"])
        for member_id in holders:
            await publish(
                conn, "access_update", {"community_id": community_id}, recipient_id=member_id
            )
    return no_content()


async def _announce_community_access(conn: asyncpg.Connection, community_id: int) -> None:
    await publish(
        conn, "access_update", {"community_id": community_id}, community_id=community_id
    )


async def assign_role(ctx: Ctx) -> Response:
    return await _set_assignment(ctx, assign=True)


async def unassign_role(ctx: Ctx) -> Response:
    return await _set_assignment(ctx, assign=False)


async def _set_assignment(ctx: Ctx, *, assign: bool) -> Response:
    assert ctx.caller is not None
    target_id = ctx.params["user_id"]
    async with DB.transaction() as conn:
        community = await community_row(conn, ctx.params["slug"], ctx.caller)
        state = await manager_state(conn, community["id"], ctx)
        role = await conn.fetchrow(
            "SELECT * FROM roles WHERE id = $1 AND community_id = $2",
            ctx.params["role_id"],
            community["id"],
        )
        if role is None:
            raise not_found()
        if not await is_member(conn, community["id"], target_id):
            raise not_found()
        if target_id == community["owner_id"]:
            raise forbidden()
        if role["is_default"]:
            raise invalid("role_id")
        if not outranks(state, role["position"]) or not outranks(
            state, await rank_of(conn, community["id"], target_id)
        ):
            raise forbidden()
        if assign:
            await conn.execute(
                """
                INSERT INTO member_roles (community_id, member_id, role_id) VALUES ($1, $2, $3)
                ON CONFLICT (member_id, role_id) DO NOTHING
                """,
                community["id"],
                target_id,
                role["id"],
            )
        else:
            await conn.execute(
                "DELETE FROM member_roles WHERE member_id = $1 AND role_id = $2",
                target_id,
                role["id"],
            )
        await publish(
            conn, "access_update", {"community_id": community["id"]}, recipient_id=target_id
        )
    return no_content()


# --- channel overwrites ---------------------------------------------------


def overwrite_json(row: asyncpg.Record) -> dict[str, Any]:
    return {
        "channel_id": row["channel_id"],
        "target_type": row["target_type"],
        "target_id": row["target_id"],
        "allow": sorted(row["allow"]),
        "deny": sorted(row["deny"]),
    }


async def list_overwrites(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    async with DB.connection() as conn:
        channel = await channel_row(conn, ctx.params["channel_id"])
        state = await load_member_state(conn, channel["community_id"], ctx.caller.id)
        if state is None:
            raise forbidden()
        if not state.can("manage_roles"):
            raise forbidden()
        rows = await conn.fetch(
            """
            SELECT o.*, r.position AS role_position
            FROM channel_overwrites o
            LEFT JOIN roles r ON o.target_type = 'role' AND r.id = o.target_id
            WHERE o.channel_id = $1
            ORDER BY (o.target_type = 'member'), COALESCE(r.position, 0), o.target_id
            """,
            channel["id"],
        )
    return json_response({"data": [overwrite_json(row) for row in rows]})


async def put_overwrite(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    target_type = ctx.params["target_type"]
    target_id = ctx.params["target_id"]
    if target_type not in ("role", "member") or not target_id.isdigit():
        raise not_found()
    target = int(target_id)
    async with DB.transaction() as conn:
        channel = await channel_row(conn, ctx.params["channel_id"])
        state = await manager_state(conn, channel["community_id"], ctx)
        body = ctx.body()
        allow = clean_permissions(body.raw("allow"), "allow")
        deny = clean_permissions(body.raw("deny"), "deny")
        if set(allow) & set(deny):
            raise invalid("deny")
        refuse_keys_the_manager_lacks(state, allow, "allow")
        await _check_overwrite_target(conn, channel, state, target_type, target)
        row = await conn.fetchrow(
            """
            INSERT INTO channel_overwrites (channel_id, target_type, target_id, allow, deny)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (channel_id, target_type, target_id)
            DO UPDATE SET allow = EXCLUDED.allow, deny = EXCLUDED.deny
            RETURNING *
            """,
            channel["id"],
            target_type,
            target,
            allow,
            deny,
        )
        await _announce_overwrite(conn, channel, target_type, target)
    return json_response(overwrite_json(row))


async def _check_overwrite_target(
    conn: asyncpg.Connection,
    channel: asyncpg.Record,
    state: MemberState,
    target_type: str,
    target: int,
) -> None:
    if target_type == "role":
        role = await conn.fetchrow(
            "SELECT * FROM roles WHERE id = $1 AND community_id = $2",
            target,
            channel["community_id"],
        )
        if role is None:
            raise not_found()
        if not outranks(state, role["position"]):
            raise forbidden()
        return
    if not await is_member(conn, channel["community_id"], target):
        raise not_found()
    if target == channel["owner_id"]:
        raise forbidden()
    if not outranks(state, await rank_of(conn, channel["community_id"], target)):
        raise forbidden()


async def _announce_overwrite(
    conn: asyncpg.Connection, channel: asyncpg.Record, target_type: str, target: int
) -> None:
    if target_type == "member":
        await publish(
            conn,
            "access_update",
            {"community_id": channel["community_id"]},
            recipient_id=target,
        )
        return
    await _announce_community_access(conn, channel["community_id"])


async def delete_overwrite(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    target_type = ctx.params["target_type"]
    target_id = ctx.params["target_id"]
    if target_type not in ("role", "member") or not target_id.isdigit():
        raise not_found()
    target = int(target_id)
    async with DB.transaction() as conn:
        channel = await channel_row(conn, ctx.params["channel_id"])
        state = await manager_state(conn, channel["community_id"], ctx)
        await _check_overwrite_target(conn, channel, state, target_type, target)
        removed = await conn.fetchval(
            """
            DELETE FROM channel_overwrites
            WHERE channel_id = $1 AND target_type = $2 AND target_id = $3 RETURNING id
            """,
            channel["id"],
            target_type,
            target,
        )
        if removed is None:
            raise not_found()
        await _announce_overwrite(conn, channel, target_type, target)
    return no_content()


async def read_channel_permissions(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    async with DB.connection() as conn:
        channel = await channel_row(conn, ctx.params["channel_id"])
        state = await load_member_state(conn, channel["community_id"], ctx.caller.id)
        if state is None:
            raise forbidden()
        permissions = await channel_permissions(conn, channel["id"], state)
    return json_response(
        {"channel_id": channel["id"], "permissions": sorted(permissions)}
    )

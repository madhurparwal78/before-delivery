"""Read markers and the notification inbox, with its visibility and paging rules."""

from __future__ import annotations

from typing import Any

import asyncpg
from starlette.responses import Response

from ..app import Ctx
from ..db import DB
from ..errors import forbidden, invalid, not_found
from ..permissions import load_member_state, permissions_by_channel
from ..times import iso
from ..users import public_user
from .common import community_row, is_member, json_response
from .messages import channel_access

PAGE_SCAN = 50


class Scope:
    """What one member may currently see: their communities and viewable channels."""

    def __init__(self, communities: set[int], channels: set[int]) -> None:
        self.communities = communities
        self.channels = channels

    def allows(self, community_id: int, channel_id: int | None) -> bool:
        if community_id not in self.communities:
            return False
        return channel_id is None or channel_id in self.channels


async def visible_scope(conn: asyncpg.Connection, member_id: int) -> Scope:
    rows = await conn.fetch(
        "SELECT community_id FROM memberships WHERE member_id = $1", member_id
    )
    communities = {row["community_id"] for row in rows}
    channels: set[int] = set()
    for community_id in communities:
        state = await load_member_state(conn, community_id, member_id)
        if state is None:
            continue
        channel_rows = await conn.fetch(
            "SELECT id FROM channels WHERE community_id = $1", community_id
        )
        ids = [row["id"] for row in channel_rows]
        if not ids:
            continue
        permissions = await permissions_by_channel(conn, ids, state)
        channels |= {
            channel_id for channel_id in ids if "view_channel" in permissions[channel_id]
        }
    return Scope(communities, channels)


def notification_json(row: asyncpg.Record) -> dict[str, Any]:
    return {
        "id": row["id"],
        "kind": row["kind"],
        "read": row["read"],
        "created_at": iso(row["created_at"]),
        "message_id": row["message_id"],
        "channel_id": row["channel_id"],
        "community_id": row["community_id"],
        "actor": public_user(
            {
                "id": row["actor_id"],
                "username": row["actor_username"],
                "display_name": row["actor_display_name"],
                "avatar_ref": row["actor_avatar_ref"],
            }
        ),
    }


NOTIFICATION_COLUMNS = """
    n.id, n.kind, n.read, n.created_at, n.message_id, n.channel_id, n.community_id,
    n.actor_id, a.username AS actor_username, a.display_name AS actor_display_name,
    a.avatar_ref AS actor_avatar_ref
"""


async def list_notifications(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    unread_only = ctx.query.flag("unread")
    limit = ctx.query.whole_number("limit", 20, 1, 50)
    before = ctx.query.whole_number("before", 0, 1, 2147483647) if ctx.query.has("before") else 0

    async with DB.connection() as conn:
        scope = await visible_scope(conn, ctx.caller.id)
        collected: list[asyncpg.Record] = []
        cursor = before
        exhausted = False
        while len(collected) <= limit and not exhausted:
            batch = await conn.fetch(
                f"""
                SELECT {NOTIFICATION_COLUMNS}
                FROM notifications n LEFT JOIN members a ON a.id = n.actor_id
                WHERE n.recipient_id = $1 AND ($2 = 0 OR n.id < $2)
                  AND (NOT $4 OR NOT n.read)
                ORDER BY n.id DESC LIMIT $3
                """,
                ctx.caller.id,
                cursor,
                PAGE_SCAN,
                unread_only,
            )
            if len(batch) < PAGE_SCAN:
                exhausted = True
            if not batch:
                break
            cursor = batch[-1]["id"]
            for row in batch:
                if scope.allows(row["community_id"], row["channel_id"]):
                    collected.append(row)
                    if len(collected) > limit:
                        break
        has_more = len(collected) > limit
        page = collected[:limit]
        unread_count = await _unread_count(conn, ctx.caller.id, scope)
    return json_response(
        {
            "data": [notification_json(row) for row in page],
            "unread_count": unread_count,
            "has_more": has_more,
        }
    )


async def _unread_count(conn: asyncpg.Connection, member_id: int, scope: Scope) -> int:
    rows = await conn.fetch(
        """
        SELECT community_id, channel_id FROM notifications
        WHERE recipient_id = $1 AND NOT read
        """,
        member_id,
    )
    return sum(1 for row in rows if scope.allows(row["community_id"], row["channel_id"]))


async def read_notification(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    async with DB.transaction() as conn:
        row = await conn.fetchrow(
            "SELECT id, recipient_id, community_id, channel_id FROM notifications WHERE id = $1",
            ctx.params["id"],
        )
        if row is None or row["recipient_id"] != ctx.caller.id:
            raise not_found()
        scope = await visible_scope(conn, ctx.caller.id)
        if not scope.allows(row["community_id"], row["channel_id"]):
            raise not_found()
        await conn.execute("UPDATE notifications SET read = true WHERE id = $1", row["id"])
    return json_response({"id": row["id"], "read": True})


async def read_all_notifications(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    async with DB.transaction() as conn:
        scope = await visible_scope(conn, ctx.caller.id)
        rows = await conn.fetch(
            """
            SELECT id, community_id, channel_id FROM notifications
            WHERE recipient_id = $1 AND NOT read
            """,
            ctx.caller.id,
        )
        ids = [
            row["id"] for row in rows if scope.allows(row["community_id"], row["channel_id"])
        ]
        if ids:
            await conn.execute(
                "UPDATE notifications SET read = true WHERE id = ANY($1::int[])", ids
            )
    return json_response({"updated": len(ids)})


async def read_states(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    async with DB.connection() as conn:
        community = await community_row(conn, ctx.params["slug"], ctx.caller)
        if not await is_member(conn, community["id"], ctx.caller.id):
            raise forbidden()
        state = await load_member_state(conn, community["id"], ctx.caller.id)
        channels = await conn.fetch(
            """
            SELECT id FROM channels WHERE community_id = $1 AND type = 'text'
            ORDER BY position, id
            """,
            community["id"],
        )
        ids = [row["id"] for row in channels]
        permissions = await permissions_by_channel(conn, ids, state) if ids else {}
        data = []
        for channel_id in ids:
            if "view_channel" not in permissions[channel_id]:
                continue
            data.append(await _read_state(conn, ctx.caller.id, channel_id))
    return json_response({"data": data})


async def _read_state(
    conn: asyncpg.Connection, member_id: int, channel_id: int
) -> dict[str, Any]:
    marker = await conn.fetchval(
        "SELECT last_read_message_id FROM read_states WHERE member_id = $1 AND channel_id = $2",
        member_id,
        channel_id,
    )
    counts = await conn.fetchrow(
        """
        SELECT count(*) FILTER (WHERE author_id <> $2) AS unread_count,
               count(*) FILTER (WHERE $2 = ANY(mentions)) AS mention_count
        FROM messages
        WHERE channel_id = $1 AND ($3::int IS NULL OR id > $3)
        """,
        channel_id,
        member_id,
        marker,
    )
    return {
        "channel_id": channel_id,
        "last_read_message_id": marker,
        "unread_count": int(counts["unread_count"]),
        "mention_count": int(counts["mention_count"]),
    }


async def acknowledge(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    channel_id = ctx.params["channel_id"]
    async with DB.transaction() as conn:
        await channel_access(conn, channel_id, ctx.caller.id)
        body = ctx.body()
        message_id = body.raw("message_id")
        if isinstance(message_id, bool) or not isinstance(message_id, int):
            raise invalid("message_id")
        exists = await conn.fetchval(
            "SELECT 1 FROM messages WHERE id = $1 AND channel_id = $2", message_id, channel_id
        )
        if not exists:
            raise invalid("message_id")
        await conn.execute(
            """
            INSERT INTO read_states (member_id, channel_id, last_read_message_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (member_id, channel_id) DO UPDATE
            SET last_read_message_id = GREATEST(
                COALESCE(read_states.last_read_message_id, 0), EXCLUDED.last_read_message_id)
            """,
            ctx.caller.id,
            channel_id,
            message_id,
        )
        state = await _read_state(conn, ctx.caller.id, channel_id)
    return json_response(state)

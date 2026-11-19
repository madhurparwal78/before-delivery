"""Communities: the directory, a community and its channels, membership and moderation."""

from __future__ import annotations

from typing import Any

import asyncpg
from starlette.responses import Response

from ..app import Ctx
from ..db import DB
from ..errors import conflict, forbidden, invalid, not_found
from ..live import publish
from ..permissions import outranks, permissions_by_channel, rank_of
from ..times import iso
from ..users import public_user, visible_status
from ..validation import bounded_text, clean_slug
from .common import (
    COMMUNITY_COLUMNS,
    channel_json,
    community_json,
    community_row,
    is_member,
    json_response,
    member_state_or_403,
    no_content,
    viewer_state,
)

CATEGORIES = ("gaming", "entertainment", "education", "music", "science-and-tech")
DIRECTORY_CATEGORIES = ("all",) + CATEGORIES
DEFAULT_PERMISSIONS = [
    "add_reactions",
    "attach_files",
    "create_invite",
    "send_messages",
    "view_channel",
]


def clean_query_text(raw: str | None) -> str:
    """Directory search text: trimmed, at most 100 code points, matched literally."""
    text = (raw or "").strip()
    if len(text) > 100:
        raise invalid("q")
    return text


MATCHES = """
    c.published AND (c.category = $2 OR $2 = 'all') AND ($1 = '' OR
    position(lower($1) in lower(c.name)) > 0 OR
    position(lower($1) in lower(c.description)) > 0 OR
    EXISTS (SELECT 1 FROM unnest(c.keywords) k WHERE position(lower($1) in lower(k)) > 0))
"""


async def directory_results(
    conn: asyncpg.Connection, query: str, category: str, page: int, per_page: int
) -> dict[str, Any]:
    """The published directory, shared by the API and the directory page."""
    total = await conn.fetchval(
        f"SELECT count(*) FROM communities c WHERE {MATCHES}", query, category
    )
    rows = await conn.fetch(
        f"""
        SELECT {COMMUNITY_COLUMNS} FROM communities c WHERE {MATCHES}
        ORDER BY member_count DESC, c.slug ASC LIMIT $3 OFFSET $4
        """,
        query,
        category,
        per_page,
        (page - 1) * per_page,
    )
    return {
        "data": [community_json(row) for row in rows],
        "page": page,
        "per_page": per_page,
        "total": int(total),
    }


async def category_counts(conn: asyncpg.Connection) -> dict[str, int]:
    """Chip counts follow the category alone, never the search text."""
    rows = await conn.fetch(
        "SELECT category, count(*) AS total FROM communities WHERE published GROUP BY category"
    )
    counts = {row["category"]: int(row["total"]) for row in rows}
    counts["all"] = sum(counts.values())
    return {category: counts.get(category, 0) for category in DIRECTORY_CATEGORIES}


async def list_servers(ctx: Ctx) -> Response:
    query = clean_query_text(ctx.query.get("q"))
    category = ctx.query.get("category", "all") or "all"
    if category not in DIRECTORY_CATEGORIES:
        raise invalid("category")
    page = ctx.query.whole_number("page", 1, 1, 1000)
    per_page = ctx.query.whole_number("per_page", 12, 1, 50)
    async with DB.connection() as conn:
        return json_response(
            await directory_results(conn, query, category, page, per_page)
        )


async def create_server(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    body = ctx.body()
    name = bounded_text(body, "name", 2, 100)
    slug = clean_slug(body.raw("slug"))
    category = body.text("category")
    if category not in CATEGORIES:
        raise invalid("category")
    description = bounded_text(body, "description", 0, 300, required=False) or ""

    async with DB.transaction() as conn:
        taken = await conn.fetchval("SELECT 1 FROM communities WHERE slug = $1", slug)
        if taken:
            raise conflict("slug")
        community_id = await conn.fetchval(
            """
            INSERT INTO communities (slug, name, description, icon_ref, splash_ref, banner_ref,
                                     category, keywords, published, verification_level,
                                     presence_baseline, member_baseline, owner_id)
            VALUES ($1, $2, $3, 'icons/draft-hall.png', 'splashes/draft-hall.png',
                    'banners/draft-hall.png', $4, '{}', true, 'none', 0, 0, $5)
            RETURNING id
            """,
            slug,
            name,
            description,
            category,
            ctx.caller.id,
        )
        await conn.execute(
            """
            INSERT INTO roles (community_id, name, position, permissions, is_default)
            VALUES ($1, '@everyone', 0, $2, true)
            """,
            community_id,
            DEFAULT_PERMISSIONS,
        )
        channel_id = await conn.fetchval(
            """
            INSERT INTO channels (community_id, name, category_group, position, topic, type)
            VALUES ($1, 'general', 'Text Channels', 0, '', 'text')
            RETURNING id
            """,
            community_id,
        )
        await conn.execute(
            "INSERT INTO memberships (member_id, community_id, role) VALUES ($1, $2, 'owner')",
            ctx.caller.id,
            community_id,
        )
        await conn.execute(
            "INSERT INTO read_states (member_id, channel_id, last_read_message_id) "
            "VALUES ($1, $2, NULL)",
            ctx.caller.id,
            channel_id,
        )
        row = await conn.fetchrow(
            f"SELECT {COMMUNITY_COLUMNS} FROM communities c WHERE c.id = $1", community_id
        )
        channels = await conn.fetch(
            "SELECT * FROM channels WHERE community_id = $1 ORDER BY position, id", community_id
        )
    return json_response(
        {**community_json(row), "channels": [channel_json(channel) for channel in channels]},
        201,
    )


async def read_server(ctx: Ctx) -> Response:
    async with DB.connection() as conn:
        row = await community_row(conn, ctx.params["slug"], ctx.caller)
        state = await viewer_state(conn, row["id"], ctx.caller)
        channels = await conn.fetch(
            "SELECT * FROM channels WHERE community_id = $1 ORDER BY position, id", row["id"]
        )
        permissions = await permissions_by_channel(
            conn, [channel["id"] for channel in channels], state
        )
        me: dict[str, Any] | None = None
        if state.is_member:
            me = {
                "role": state.membership_role,
                "muted": state.muted,
                "communication_disabled_until": (
                    iso(state.communication_disabled_until) if state.timed_out else None
                ),
            }
    return json_response(
        {
            **community_json(row),
            "channels": [
                channel_json(channel)
                for channel in channels
                if "view_channel" in permissions[channel["id"]]
            ],
            "me": me,
        }
    )


async def patch_server(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    body = ctx.body()
    async with DB.transaction() as conn:
        row = await community_row(conn, ctx.params["slug"], ctx.caller)
        if row["owner_id"] != ctx.caller.id:
            raise forbidden()
        updates: dict[str, Any] = {}
        if body.has("name"):
            updates["name"] = bounded_text(body, "name", 2, 100)
        if body.has("description"):
            updates["description"] = bounded_text(body, "description", 0, 300, required=False) or ""
        if body.has("published"):
            published = body.boolean("published")
            if published is None:
                raise invalid("published")
            updates["published"] = published
        if body.has("verification_level"):
            level = body.text("verification_level")
            if level not in ("none", "email"):
                raise invalid("verification_level")
            updates["verification_level"] = level
        if updates:
            assignments = ", ".join(
                f"{name} = ${index}" for index, name in enumerate(updates, start=2)
            )
            await conn.execute(
                f"UPDATE communities SET {assignments} WHERE id = $1",
                row["id"],
                *updates.values(),
            )
        fresh = await conn.fetchrow(
            f"SELECT {COMMUNITY_COLUMNS} FROM communities c WHERE c.id = $1", row["id"]
        )
    return json_response(community_json(fresh))


async def _start_read_states(
    conn: asyncpg.Connection, community_id: int, member_id: int
) -> None:
    await conn.execute(
        """
        INSERT INTO read_states (member_id, channel_id, last_read_message_id)
        SELECT $2, ch.id, (SELECT max(id) FROM messages WHERE channel_id = ch.id)
        FROM channels ch WHERE ch.community_id = $1 AND ch.type = 'text'
        ON CONFLICT (member_id, channel_id) DO NOTHING
        """,
        community_id,
        member_id,
    )


async def default_channel_id(conn: asyncpg.Connection, community_id: int) -> int | None:
    return await conn.fetchval(
        """
        SELECT id FROM channels WHERE community_id = $1 AND type = 'text'
        ORDER BY position, id LIMIT 1
        """,
        community_id,
    )


async def announce_membership(
    conn: asyncpg.Connection, community_id: int, member_id: int
) -> None:
    """Counts and rails follow a join, a leave or a ban at once."""
    await publish(conn, "membership_update", {"community_id": community_id},
                  community_id=community_id)
    await publish(conn, "access_update", {"community_id": community_id},
                  recipient_id=member_id)


async def join_community(
    conn: asyncpg.Connection, community_id: int, member_id: int
) -> bool:
    banned = await conn.fetchval(
        "SELECT 1 FROM bans WHERE community_id = $1 AND member_id = $2", community_id, member_id
    )
    if banned:
        raise forbidden()
    created = await conn.fetchval(
        """
        INSERT INTO memberships (member_id, community_id, role) VALUES ($1, $2, 'member')
        ON CONFLICT (member_id, community_id) DO NOTHING
        RETURNING id
        """,
        member_id,
        community_id,
    )
    if created is None:
        return False
    await _start_read_states(conn, community_id, member_id)
    await announce_membership(conn, community_id, member_id)
    return True


async def join_server(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    async with DB.transaction() as conn:
        row = await community_row(conn, ctx.params["slug"], ctx.caller)
        created = await join_community(conn, row["id"], ctx.caller.id)
        channel_id = await default_channel_id(conn, row["id"])
        role = await conn.fetchval(
            "SELECT role FROM memberships WHERE community_id = $1 AND member_id = $2",
            row["id"],
            ctx.caller.id,
        )
    return json_response(
        {
            "joined": True,
            "community_id": row["id"],
            "default_channel_id": channel_id,
            "role": role,
        },
        201 if created else 200,
    )


async def leave_server(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    async with DB.transaction() as conn:
        row = await community_row(conn, ctx.params["slug"], ctx.caller)
        if row["owner_id"] == ctx.caller.id:
            raise conflict(None)
        removed = await conn.fetchval(
            """
            DELETE FROM memberships WHERE community_id = $1 AND member_id = $2 RETURNING id
            """,
            row["id"],
            ctx.caller.id,
        )
        if removed is None:
            raise not_found()
        await announce_membership(conn, row["id"], ctx.caller.id)
    return no_content()


async def patch_membership(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    body = ctx.body()
    muted = body.boolean("muted")
    if muted is None:
        raise invalid("muted")
    async with DB.transaction() as conn:
        row = await community_row(conn, ctx.params["slug"], ctx.caller)
        updated = await conn.fetchval(
            """
            UPDATE memberships SET muted = $3 WHERE community_id = $1 AND member_id = $2
            RETURNING muted
            """,
            row["id"],
            ctx.caller.id,
            muted,
        )
        if updated is None:
            raise not_found()
    return json_response({"muted": updated})


async def list_members(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    async with DB.connection() as conn:
        row = await community_row(conn, ctx.params["slug"], ctx.caller)
        if not await is_member(conn, row["id"], ctx.caller.id):
            raise forbidden()
        members = await conn.fetch(
            """
            SELECT m.id, m.username, m.display_name, m.avatar_ref, m.status, ms.role
            FROM memberships ms JOIN members m ON m.id = ms.member_id
            WHERE ms.community_id = $1
            ORDER BY (ms.role = 'owner') DESC, m.username ASC
            """,
            row["id"],
        )
    return json_response(
        {
            "data": [
                {
                    "user": public_user(member),
                    "role": member["role"],
                    "status": visible_status(member["status"]),
                }
                for member in members
            ]
        }
    )


# --- moderation -----------------------------------------------------------


async def _moderator_state(
    conn: asyncpg.Connection, community_id: int, ctx: Ctx, key: str
) -> Any:
    assert ctx.caller is not None
    state = await member_state_or_403(conn, community_id, ctx.caller)
    if not state.can(key):
        raise forbidden()
    return state


async def list_bans(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    async with DB.connection() as conn:
        row = await community_row(conn, ctx.params["slug"], ctx.caller)
        if row["owner_id"] != ctx.caller.id:
            raise forbidden()
        bans = await conn.fetch(
            """
            SELECT m.id, m.username, m.display_name, m.avatar_ref, b.created_at
            FROM bans b JOIN members m ON m.id = b.member_id
            WHERE b.community_id = $1 ORDER BY m.username
            """,
            row["id"],
        )
    return json_response(
        {"data": [{"user": public_user(ban), "created_at": iso(ban["created_at"])} for ban in bans]}
    )


async def ban_member(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    target_id = ctx.params["user_id"]
    async with DB.transaction() as conn:
        row = await community_row(conn, ctx.params["slug"], ctx.caller)
        state = await _moderator_state(conn, row["id"], ctx, "ban_members")
        target = await conn.fetchval("SELECT id FROM members WHERE id = $1", target_id)
        if target is None:
            raise not_found()
        if target_id == ctx.caller.id or target_id == row["owner_id"]:
            raise forbidden()
        if not outranks(state, await rank_of(conn, row["id"], target_id)):
            raise forbidden()
        await conn.execute(
            """
            INSERT INTO bans (community_id, member_id) VALUES ($1, $2)
            ON CONFLICT (community_id, member_id) DO NOTHING
            """,
            row["id"],
            target_id,
        )
        await conn.execute(
            "DELETE FROM memberships WHERE community_id = $1 AND member_id = $2",
            row["id"],
            target_id,
        )
        await conn.execute(
            "DELETE FROM member_roles WHERE community_id = $1 AND member_id = $2",
            row["id"],
            target_id,
        )
        await conn.execute(
            """
            DELETE FROM channel_overwrites
            WHERE target_type = 'member' AND target_id = $2
              AND channel_id IN (SELECT id FROM channels WHERE community_id = $1)
            """,
            row["id"],
            target_id,
        )
        await announce_membership(conn, row["id"], target_id)
    return no_content()


async def unban_member(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    async with DB.transaction() as conn:
        row = await community_row(conn, ctx.params["slug"], ctx.caller)
        await _moderator_state(conn, row["id"], ctx, "ban_members")
        removed = await conn.fetchval(
            "DELETE FROM bans WHERE community_id = $1 AND member_id = $2 RETURNING id",
            row["id"],
            ctx.params["user_id"],
        )
        if removed is None:
            raise not_found()
    return no_content()


async def set_timeout(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    body = ctx.body()
    seconds = body.whole_number("seconds", 0, 2_419_200)
    target_id = ctx.params["user_id"]
    async with DB.transaction() as conn:
        row = await community_row(conn, ctx.params["slug"], ctx.caller)
        state = await _moderator_state(conn, row["id"], ctx, "ban_members")
        if target_id == ctx.caller.id or target_id == row["owner_id"]:
            raise forbidden()
        member = await conn.fetchval(
            "SELECT id FROM memberships WHERE community_id = $1 AND member_id = $2",
            row["id"],
            target_id,
        )
        if member is None:
            raise not_found()
        if not outranks(state, await rank_of(conn, row["id"], target_id)):
            raise forbidden()
        until = await conn.fetchval(
            """
            UPDATE memberships
            SET communication_disabled_until = CASE WHEN $3 = 0 THEN NULL
                ELSE date_trunc('second', clock_timestamp()) + make_interval(secs => $3) END
            WHERE community_id = $1 AND member_id = $2
            RETURNING communication_disabled_until
            """,
            row["id"],
            target_id,
            seconds,
        )
        await publish(
            conn,
            "timeout_update",
            {
                "community_id": row["id"],
                "user_id": target_id,
                "communication_disabled_until": iso(until),
            },
            community_id=row["id"],
        )
    return json_response({"user_id": target_id, "communication_disabled_until": iso(until)})

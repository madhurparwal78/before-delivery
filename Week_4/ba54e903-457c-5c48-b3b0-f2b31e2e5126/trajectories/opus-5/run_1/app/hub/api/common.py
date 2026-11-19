"""Helpers shared by the API handlers."""

from __future__ import annotations

import json
from typing import Any, Mapping

import asyncpg
from starlette.responses import Response

from ..errors import forbidden, not_found
from ..permissions import MemberState, load_member_state, outsider_state
from ..users import Caller

COMMUNITY_COLUMNS = """
    c.id, c.slug, c.name, c.description, c.icon_ref, c.splash_ref, c.banner_ref,
    c.category, c.keywords, c.verified, c.partnered, c.published, c.verification_level,
    c.owner_id,
    c.member_baseline + (SELECT count(*) FROM memberships ms WHERE ms.community_id = c.id)
        AS member_count,
    c.presence_baseline + (SELECT count(*) FROM memberships ms
                           JOIN members mm ON mm.id = ms.member_id
                           WHERE ms.community_id = c.id
                             AND mm.status IN ('online', 'idle', 'dnd')) AS presence_count
"""


def json_response(data: Any, status: int = 200) -> Response:
    return Response(
        json.dumps(data, ensure_ascii=False).encode("utf-8"),
        status_code=status,
        media_type="application/json",
    )


def no_content() -> Response:
    return Response(b"", status_code=204)


def media_url(reference: str) -> str:
    return f"/static/media/{reference}"


def community_json(row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "slug": row["slug"],
        "name": row["name"],
        "description": row["description"],
        "icon_url": media_url(row["icon_ref"]),
        "splash_url": media_url(row["splash_ref"]),
        "banner_url": media_url(row["banner_ref"]),
        "category": row["category"],
        "keywords": list(row["keywords"]),
        "verified": row["verified"],
        "partnered": row["partnered"],
        "presence_count": int(row["presence_count"]),
        "member_count": int(row["member_count"]),
        "owner_id": row["owner_id"],
        "verification_level": row["verification_level"],
    }


def channel_json(row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "category": row["category_group"],
        "position": row["position"],
        "topic": row["topic"],
        "type": row["type"],
        "slowmode_seconds": row["slowmode_seconds"],
    }


async def is_member(conn: asyncpg.Connection, community_id: int, member_id: int | None) -> bool:
    if member_id is None:
        return False
    return bool(
        await conn.fetchval(
            "SELECT 1 FROM memberships WHERE community_id = $1 AND member_id = $2",
            community_id,
            member_id,
        )
    )


async def community_row(
    conn: asyncpg.Connection, slug: str, caller: Caller | None
) -> asyncpg.Record:
    """A community the caller may see at all; published visibility decides."""
    row = await conn.fetchrow(
        f"SELECT {COMMUNITY_COLUMNS} FROM communities c WHERE c.slug = $1", slug
    )
    if row is None:
        raise not_found()
    if not row["published"] and not await is_member(conn, row["id"], caller.id if caller else None):
        raise not_found()
    return row


async def member_state_or_403(
    conn: asyncpg.Connection, community_id: int, caller: Caller
) -> MemberState:
    state = await load_member_state(conn, community_id, caller.id)
    if state is None:
        raise forbidden()
    return state


async def viewer_state(
    conn: asyncpg.Connection, community_id: int, caller: Caller | None
) -> MemberState:
    """The caller's standing, or the default-role view for anyone who has not joined."""
    state = await load_member_state(conn, community_id, caller.id if caller else None)
    if state is None:
        return await outsider_state(conn, community_id)
    return state


async def channel_row(conn: asyncpg.Connection, channel_id: int) -> asyncpg.Record:
    row = await conn.fetchrow(
        """
        SELECT ch.id, ch.community_id, ch.name, ch.category_group, ch.position, ch.topic,
               ch.type, ch.slowmode_seconds, c.slug AS community_slug, c.owner_id,
               c.verification_level
        FROM channels ch JOIN communities c ON c.id = ch.community_id
        WHERE ch.id = $1
        """,
        channel_id,
    )
    if row is None:
        raise not_found()
    return row

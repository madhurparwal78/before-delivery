"""Posting, history, edits, deletions, reactions and threads."""

from __future__ import annotations

import math
from typing import Any, Sequence

import asyncpg
from starlette.responses import Response

from ..app import Ctx
from ..config import CONFIG
from ..db import DB
from ..errors import ApiError, forbidden, invalid, not_found, rate_limited
from ..live import publish
from ..mentions import mention_tokens
from ..permissions import MemberState, channel_permissions, load_member_state
from ..serialize import message_json, messages_in_order
from ..users import message_limit_for
from .common import channel_row, json_response, no_content

EMOJI_MAX = 16
CUSTOM_EMOJI = set("abcdefghijklmnopqrstuvwxyz0123456789_")
BAD_EMOJI_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ")


async def channel_access(
    conn: asyncpg.Connection, channel_id: int, member_id: int
) -> tuple[asyncpg.Record, MemberState, frozenset[str]]:
    """A channel path: a non-member is refused, and so is a member without the key."""
    channel = await channel_row(conn, channel_id)
    state = await load_member_state(conn, channel["community_id"], member_id)
    if state is None:
        raise forbidden()
    permissions = await channel_permissions(conn, channel_id, state)
    if "view_channel" not in permissions:
        raise forbidden()
    return channel, state, permissions


async def lock_membership(conn: asyncpg.Connection, community_id: int, member_id: int) -> None:
    """Hold the membership still, so a ban that answers first always wins the race."""
    row = await conn.fetchval(
        """
        SELECT id FROM memberships WHERE community_id = $1 AND member_id = $2 FOR SHARE
        """,
        community_id,
        member_id,
    )
    if row is None:
        raise forbidden()


async def read_messages(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    limit = ctx.query.whole_number("limit", 50, 1, 100)
    before = ctx.query.whole_number("before", 0, 0, 2147483647)
    async with DB.connection() as conn:
        await channel_access(conn, ctx.params["channel_id"], ctx.caller.id)
        rows = await conn.fetch(
            """
            SELECT id FROM messages
            WHERE channel_id = $1 AND ($2 = 0 OR id < $2)
            ORDER BY id DESC LIMIT $3
            """,
            ctx.params["channel_id"],
            before,
            limit + 1,
        )
        has_more = len(rows) > limit
        ids = [row["id"] for row in rows[:limit]][::-1]
        data = await messages_in_order(conn, ids, ctx.caller.id)
    return json_response({"data": data, "has_more": has_more})


async def _resolve_mentions(
    conn: asyncpg.Connection,
    channel: asyncpg.Record,
    author_id: int,
    body: str,
    permissions: frozenset[str],
) -> list[int]:
    tokens = mention_tokens(body)
    if not tokens.usernames and not (tokens.everyone or tokens.here):
        return []
    candidates = await _viewers(conn, channel)
    mentioned: set[int] = set()
    for member in candidates:
        if member["member_id"] == author_id:
            continue
        if member["username"].lower() in tokens.usernames:
            mentioned.add(member["member_id"])
        elif "mention_everyone" in permissions and tokens.everyone:
            mentioned.add(member["member_id"])
        elif (
            "mention_everyone" in permissions
            and tokens.here
            and member["status"] == "online"
        ):
            mentioned.add(member["member_id"])
    return sorted(mentioned)


async def _viewers(conn: asyncpg.Connection, channel: asyncpg.Record) -> list[dict[str, Any]]:
    """Every member of the community who may view this channel, right now."""
    rows = await conn.fetch(
        """
        SELECT ms.member_id, ms.muted, m.username, m.status
        FROM memberships ms JOIN members m ON m.id = ms.member_id
        WHERE ms.community_id = $1
        """,
        channel["community_id"],
    )
    viewers: list[dict[str, Any]] = []
    for row in rows:
        state = await load_member_state(conn, channel["community_id"], row["member_id"])
        if state is None:
            continue
        permissions = await channel_permissions(conn, channel["id"], state)
        if "view_channel" in permissions:
            viewers.append(
                {
                    "member_id": row["member_id"],
                    "muted": row["muted"],
                    "username": row["username"],
                    "status": row["status"],
                }
            )
    return viewers


async def _notify(
    conn: asyncpg.Connection,
    channel: asyncpg.Record,
    message_id: int,
    author_id: int,
    mentions: Sequence[int],
    reply_parent_author: int | None,
) -> None:
    for viewer in await _viewers(conn, channel):
        member_id = viewer["member_id"]
        if member_id == author_id:
            continue
        if member_id in mentions:
            kind = "mention"
        elif reply_parent_author is not None and member_id == reply_parent_author:
            kind = "reply"
        elif viewer["muted"]:
            continue
        else:
            kind = "message"
        await _insert_notification(
            conn, member_id, message_id, channel, author_id, kind
        )


async def _insert_notification(
    conn: asyncpg.Connection,
    recipient_id: int,
    message_id: int,
    channel: asyncpg.Record,
    actor_id: int,
    kind: str,
) -> None:
    row = await conn.fetchrow(
        """
        INSERT INTO notifications (recipient_id, message_id, channel_id, community_id,
                                   actor_id, kind)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (recipient_id, message_id, kind) WHERE message_id IS NOT NULL DO NOTHING
        RETURNING id, created_at
        """,
        recipient_id,
        message_id,
        channel["id"],
        channel["community_id"],
        actor_id,
        kind,
    )
    if row is None:
        return
    await publish(
        conn,
        "notification_create",
        {"notification_id": row["id"]},
        recipient_id=recipient_id,
    )


async def post_message(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    channel_id = ctx.params["channel_id"]
    async with DB.transaction() as conn:
        channel = await channel_row(conn, channel_id)
        await lock_membership(conn, channel["community_id"], ctx.caller.id)
        state = await load_member_state(conn, channel["community_id"], ctx.caller.id)
        if state is None:
            raise forbidden()
        permissions = await channel_permissions(conn, channel_id, state)
        if "view_channel" not in permissions:
            raise forbidden()
        if channel["type"] != "text":
            raise forbidden()
        if "send_messages" not in permissions:
            raise forbidden()
        if channel["verification_level"] == "email" and not ctx.caller.email_verified:
            raise forbidden()

        body_raw = ctx.body()
        attachment_ids = body_raw.id_list("attachment_ids", 10) or []
        if attachment_ids and "attach_files" not in permissions:
            raise forbidden()

        nonce = body_raw.text("nonce")
        if nonce is not None and not 1 <= len(nonce) <= 64:
            raise invalid("nonce")
        if nonce:
            existing = await conn.fetchval(
                """
                SELECT id FROM messages
                WHERE channel_id = $1 AND author_id = $2 AND nonce = $3
                  AND created_at > clock_timestamp() - make_interval(secs => $4)
                """,
                channel_id,
                ctx.caller.id,
                nonce,
                CONFIG.message_nonce_ttl_seconds,
            )
            if existing is not None:
                return json_response(await message_json(conn, existing, ctx.caller.id))

        await _slowmode_refusal(conn, channel, ctx.caller.id, permissions)

        body = (body_raw.text("body") or "").strip()
        limit = message_limit_for(ctx.caller.tier)
        if len(body) > limit:
            raise invalid("body")
        if not body and not attachment_ids:
            raise invalid("body")

        reply_to_id = body_raw.raw("reply_to_id")
        if reply_to_id is not None:
            if isinstance(reply_to_id, bool) or not isinstance(reply_to_id, int):
                raise invalid("reply_to_id")
            parent_channel = await conn.fetchval(
                "SELECT channel_id FROM messages WHERE id = $1", reply_to_id
            )
            if parent_channel != channel_id:
                raise invalid("reply_to_id")

        if attachment_ids:
            owned = await conn.fetchval(
                """
                SELECT count(*) FROM attachments
                WHERE id = ANY($1::int[]) AND uploader_id = $2 AND message_id IS NULL
                """,
                attachment_ids,
                ctx.caller.id,
            )
            if owned != len(set(attachment_ids)) or len(set(attachment_ids)) != len(
                attachment_ids
            ):
                raise invalid("attachment_ids")

        mentions = await _resolve_mentions(conn, channel, ctx.caller.id, body, permissions)
        try:
            async with conn.transaction():
                row = await conn.fetchrow(
                    """
                    INSERT INTO messages (channel_id, author_id, body, reply_to_id, nonce,
                                          mentions)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    RETURNING id
                    """,
                    channel_id,
                    ctx.caller.id,
                    body,
                    reply_to_id,
                    nonce,
                    mentions,
                )
        except asyncpg.UniqueViolationError:
            existing = await conn.fetchval(
                """
                SELECT id FROM messages
                WHERE channel_id = $1 AND author_id = $2 AND nonce = $3
                """,
                channel_id,
                ctx.caller.id,
                nonce,
            )
            return json_response(await message_json(conn, existing, ctx.caller.id))

        message_id = row["id"]
        for position, attachment_id in enumerate(attachment_ids):
            await conn.execute(
                "UPDATE attachments SET message_id = $2, position = $3 WHERE id = $1",
                attachment_id,
                message_id,
                position,
            )
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
        parent_author = None
        if reply_to_id is not None:
            parent_author = await conn.fetchval(
                "SELECT author_id FROM messages WHERE id = $1", reply_to_id
            )
        await _notify(conn, channel, message_id, ctx.caller.id, mentions, parent_author)
        await publish(
            conn,
            "message_create",
            {"message_id": message_id, "channel_id": channel_id},
            community_id=channel["community_id"],
            channel_id=channel_id,
        )
        if reply_to_id is not None:
            await publish(
                conn,
                "message_update",
                {"message_id": reply_to_id, "channel_id": channel_id},
                community_id=channel["community_id"],
                channel_id=channel_id,
            )
        message = await message_json(conn, message_id, ctx.caller.id)
    return json_response(message, 201)


async def _slowmode_refusal(
    conn: asyncpg.Connection,
    channel: asyncpg.Record,
    member_id: int,
    permissions: frozenset[str],
) -> None:
    if channel["slowmode_seconds"] <= 0 or "manage_messages" in permissions:
        return
    seconds_left = await conn.fetchval(
        """
        SELECT EXTRACT(EPOCH FROM (max(created_at) + make_interval(secs => $3)
                                   - clock_timestamp()))
        FROM messages WHERE channel_id = $1 AND author_id = $2
          AND created_at > clock_timestamp() - make_interval(secs => $3)
        """,
        channel["id"],
        member_id,
        channel["slowmode_seconds"],
    )
    if seconds_left is None or float(seconds_left) <= 0:
        return
    whole = int(math.ceil(float(seconds_left)))
    raise rate_limited(max(1, min(channel["slowmode_seconds"], whole)))


async def _message_for_caller(
    conn: asyncpg.Connection, message_id: int, member_id: int
) -> tuple[asyncpg.Record, asyncpg.Record, frozenset[str]]:
    """A message id path: anything the caller may not view answers not found."""
    row = await conn.fetchrow(
        "SELECT id, channel_id, author_id, body FROM messages WHERE id = $1", message_id
    )
    if row is None:
        raise not_found()
    channel = await channel_row(conn, row["channel_id"])
    state = await load_member_state(conn, channel["community_id"], member_id)
    if state is None:
        raise not_found()
    permissions = await channel_permissions(conn, row["channel_id"], state)
    if "view_channel" not in permissions:
        raise not_found()
    return row, channel, permissions


async def patch_message(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    async with DB.transaction() as conn:
        row, channel, permissions = await _message_for_caller(
            conn, ctx.params["message_id"], ctx.caller.id
        )
        if row["author_id"] != ctx.caller.id:
            raise forbidden()
        body = (ctx.body().text("body") or "").strip()
        limit = message_limit_for(ctx.caller.tier)
        if len(body) > limit:
            raise invalid("body")
        has_attachments = await conn.fetchval(
            "SELECT 1 FROM attachments WHERE message_id = $1", row["id"]
        )
        if not body and not has_attachments:
            raise invalid("body")
        mentions = await _resolve_mentions(conn, channel, ctx.caller.id, body, permissions)
        await conn.execute(
            """
            UPDATE messages SET body = $2, edited_at = date_trunc('second', now()), mentions = $3
            WHERE id = $1
            """,
            row["id"],
            body,
            mentions,
        )
        already = await conn.fetch(
            "SELECT recipient_id FROM notifications WHERE message_id = $1 AND kind = 'mention'",
            row["id"],
        )
        notified = {entry["recipient_id"] for entry in already}
        viewers = {viewer["member_id"] for viewer in await _viewers(conn, channel)}
        for member_id in mentions:
            if member_id not in notified and member_id in viewers:
                await _insert_notification(
                    conn, member_id, row["id"], channel, ctx.caller.id, "mention"
                )
        await publish(
            conn,
            "message_update",
            {"message_id": row["id"], "channel_id": row["channel_id"]},
            community_id=channel["community_id"],
            channel_id=row["channel_id"],
        )
        await _publish_replies_changed(conn, channel, row["id"])
        message = await message_json(conn, row["id"], ctx.caller.id)
    return json_response(message)


async def _publish_replies_changed(
    conn: asyncpg.Connection, channel: asyncpg.Record, parent_id: int
) -> None:
    """Every reply carries its parent as it stands now, so replies follow a parent."""
    replies = await conn.fetch("SELECT id FROM messages WHERE reply_to_id = $1", parent_id)
    for reply in replies:
        await publish(
            conn,
            "message_update",
            {"message_id": reply["id"], "channel_id": channel["id"]},
            community_id=channel["community_id"],
            channel_id=channel["id"],
        )


async def delete_message(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    async with DB.transaction() as conn:
        row, channel, permissions = await _message_for_caller(
            conn, ctx.params["message_id"], ctx.caller.id
        )
        if row["author_id"] != ctx.caller.id and "manage_messages" not in permissions:
            raise forbidden()
        parent_id = await conn.fetchval(
            "SELECT reply_to_id FROM messages WHERE id = $1", row["id"]
        )
        reply_ids = [
            reply["id"]
            for reply in await conn.fetch(
                "SELECT id FROM messages WHERE reply_to_id = $1", row["id"]
            )
        ]
        recipients = [
            entry["recipient_id"]
            for entry in await conn.fetch(
                "SELECT recipient_id FROM notifications WHERE message_id = $1", row["id"]
            )
        ]
        await conn.execute("DELETE FROM messages WHERE id = $1", row["id"])
        await publish(
            conn,
            "message_delete",
            {"message_id": row["id"], "channel_id": row["channel_id"]},
            community_id=channel["community_id"],
            channel_id=row["channel_id"],
        )
        for recipient_id in recipients:
            await publish(
                conn,
                "notification_remove",
                {"message_id": row["id"]},
                recipient_id=recipient_id,
            )
        for reply_id in reply_ids:
            await publish(
                conn,
                "message_update",
                {"message_id": reply_id, "channel_id": row["channel_id"]},
                community_id=channel["community_id"],
                channel_id=row["channel_id"],
            )
        if parent_id is not None:
            await publish(
                conn,
                "message_update",
                {"message_id": parent_id, "channel_id": row["channel_id"]},
                community_id=channel["community_id"],
                channel_id=row["channel_id"],
            )
    return no_content()


async def read_replies(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    async with DB.connection() as conn:
        row, _, _ = await _message_for_caller(conn, ctx.params["message_id"], ctx.caller.id)
        rows = await conn.fetch(
            "SELECT id FROM messages WHERE reply_to_id = $1 ORDER BY id", row["id"]
        )
        data = await messages_in_order(conn, [entry["id"] for entry in rows], ctx.caller.id)
    return json_response({"data": data})


def clean_emoji(raw: str) -> str:
    if raw.startswith(":") and raw.endswith(":") and len(raw) > 2:
        name = raw[1:-1]
        if not 2 <= len(name) <= 32 or any(ch not in CUSTOM_EMOJI for ch in name):
            raise invalid("emoji")
        return raw
    if not 1 <= len(raw) <= EMOJI_MAX:
        raise invalid("emoji")
    if any(ch in BAD_EMOJI_CHARS for ch in raw):
        raise invalid("emoji")
    return raw


def is_custom(emoji: str) -> bool:
    return emoji.startswith(":") and emoji.endswith(":")


async def add_reaction(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    async with DB.transaction() as conn:
        row, channel, permissions = await _message_for_caller(
            conn, ctx.params["message_id"], ctx.caller.id
        )
        if "add_reactions" not in permissions:
            raise forbidden()
        emoji = clean_emoji(ctx.params["emoji"])
        if is_custom(emoji) and not ctx.caller.has("custom_emoji"):
            raise ApiError(403, "entitlement_required")
        await conn.execute(
            """
            INSERT INTO reactions (message_id, member_id, emoji) VALUES ($1, $2, $3)
            ON CONFLICT (message_id, member_id, emoji) DO NOTHING
            """,
            row["id"],
            ctx.caller.id,
            emoji,
        )
        await publish(
            conn,
            "reaction_update",
            {"message_id": row["id"], "channel_id": row["channel_id"]},
            community_id=channel["community_id"],
            channel_id=row["channel_id"],
        )
    return no_content()


async def remove_reaction(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    async with DB.transaction() as conn:
        row, channel, _ = await _message_for_caller(
            conn, ctx.params["message_id"], ctx.caller.id
        )
        emoji = clean_emoji(ctx.params["emoji"])
        removed = await conn.fetchval(
            """
            DELETE FROM reactions WHERE message_id = $1 AND member_id = $2 AND emoji = $3
            RETURNING id
            """,
            row["id"],
            ctx.caller.id,
            emoji,
        )
        if removed is None:
            raise not_found()
        await publish(
            conn,
            "reaction_update",
            {"message_id": row["id"], "channel_id": row["channel_id"]},
            community_id=channel["community_id"],
            channel_id=row["channel_id"],
        )
    return no_content()

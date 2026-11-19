"""Message objects, including the quoted parent as it stands at the moment of a read."""

from __future__ import annotations

from typing import Any, Mapping, Sequence

import asyncpg

from .times import iso
from .users import public_user

MESSAGE_SQL = """
SELECT m.id, m.channel_id, m.body, m.created_at, m.edited_at, m.reply_to_id, m.mentions,
       a.id AS author_id, a.username AS author_username,
       a.display_name AS author_display_name, a.avatar_ref AS author_avatar_ref,
       p.id AS parent_id, p.body AS parent_body, p.edited_at AS parent_edited_at,
       pa.id AS parent_author_id, pa.username AS parent_username,
       pa.display_name AS parent_display_name, pa.avatar_ref AS parent_avatar_ref,
       (SELECT count(*) FROM messages r WHERE r.reply_to_id = m.id) AS reply_count
FROM messages m
JOIN members a ON a.id = m.author_id
LEFT JOIN messages p ON p.id = m.reply_to_id
LEFT JOIN members pa ON pa.id = p.author_id
WHERE m.id = ANY($1::int[])
"""


def attachment_json(row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "filename": row["filename"],
        "size_bytes": row["size_bytes"],
        "content_type": row["content_type"],
        "sha256": row["sha256"],
        "url": f"/media/{row['id']}",
        "width": row["width"],
        "height": row["height"],
        "duration_ms": row["duration_ms"],
    }


def _message_json(
    row: Mapping[str, Any],
    reactions: list[dict[str, Any]],
    attachments: list[dict[str, Any]],
) -> dict[str, Any]:
    referenced = None
    if row["parent_id"] is not None:
        referenced = {
            "id": row["parent_id"],
            "author": public_user(
                {
                    "id": row["parent_author_id"],
                    "username": row["parent_username"],
                    "display_name": row["parent_display_name"],
                    "avatar_ref": row["parent_avatar_ref"],
                }
            ),
            "body": row["parent_body"],
            "edited_at": iso(row["parent_edited_at"]),
        }
    return {
        "id": row["id"],
        "channel_id": row["channel_id"],
        "author": public_user(
            {
                "id": row["author_id"],
                "username": row["author_username"],
                "display_name": row["author_display_name"],
                "avatar_ref": row["author_avatar_ref"],
            }
        ),
        "body": row["body"],
        "created_at": iso(row["created_at"]),
        "edited_at": iso(row["edited_at"]),
        "reply_to_id": row["parent_id"],
        "referenced_message": referenced,
        "reply_count": int(row["reply_count"]),
        "mentions": sorted(row["mentions"]),
        "reactions": reactions,
        "attachments": attachments,
    }


async def messages_by_id(
    conn: asyncpg.Connection, message_ids: Sequence[int], viewer_id: int | None
) -> dict[int, dict[str, Any]]:
    ids = list(message_ids)
    if not ids:
        return {}
    rows = await conn.fetch(MESSAGE_SQL, ids)
    reaction_rows = await conn.fetch(
        """
        SELECT message_id, emoji, count(*) AS count,
               bool_or(member_id = $2) AS me, min(id) AS first_id
        FROM reactions WHERE message_id = ANY($1::int[])
        GROUP BY message_id, emoji
        ORDER BY min(id)
        """,
        ids,
        viewer_id or 0,
    )
    attachment_rows = await conn.fetch(
        """
        SELECT message_id, id, filename, size_bytes, content_type, sha256,
               width, height, duration_ms
        FROM attachments WHERE message_id = ANY($1::int[])
        ORDER BY message_id, position, id
        """,
        ids,
    )
    reactions: dict[int, list[dict[str, Any]]] = {}
    for row in reaction_rows:
        reactions.setdefault(row["message_id"], []).append(
            {"emoji": row["emoji"], "count": int(row["count"]), "me": bool(row["me"])}
        )
    attachments: dict[int, list[dict[str, Any]]] = {}
    for row in attachment_rows:
        attachments.setdefault(row["message_id"], []).append(attachment_json(row))
    return {
        row["id"]: _message_json(
            row, reactions.get(row["id"], []), attachments.get(row["id"], [])
        )
        for row in rows
    }


async def message_json(
    conn: asyncpg.Connection, message_id: int, viewer_id: int | None
) -> dict[str, Any] | None:
    found = await messages_by_id(conn, [message_id], viewer_id)
    return found.get(message_id)


async def messages_in_order(
    conn: asyncpg.Connection, message_ids: Sequence[int], viewer_id: int | None
) -> list[dict[str, Any]]:
    found = await messages_by_id(conn, message_ids, viewer_id)
    return [found[message_id] for message_id in message_ids if message_id in found]

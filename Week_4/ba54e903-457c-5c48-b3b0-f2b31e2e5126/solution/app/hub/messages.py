"""Channel messages: history, posting, edits, deletes, replies, reactions and read markers.

Counters (reply_count, reaction counts, mention counts) are derived when a message is read, so they
always equal their recomputed values. Posts by one author in one channel are serialised by an
advisory lock, which also makes nonce replays and slowmode exact under concurrency.
"""

from __future__ import annotations

import re
from typing import Any

from flask import g

from . import catalog, communities, config, db, events, perms
from .errors import ApiError, invalid, retry_after
from .router import route
from .serialize import iso, public_user

MESSAGE_PAGE = 50
REPLY_CAP = 500
ATTACHMENT_CAP = 10
NONCE_MAX = 64
CUSTOM_EMOJI = re.compile(r":[a-z0-9_]{2,32}:")
_ASCII_WORD_OR_SPACE = re.compile(r"[A-Za-z0-9 ]")
_FENCE = re.compile(r"^```.*?(?:^```|\Z)", re.MULTILINE | re.DOTALL)
_INLINE_CODE = re.compile(r"`[^`\n]*`")
_MENTION = re.compile(r"(?<![A-Za-z0-9_.])@([A-Za-z0-9_.]+)")

_MESSAGE_SQL = """
SELECT m.id, m.channel_id, m.body, m.created_at, m.edited_at, m.reply_to_id, m.mentions,
       a.id AS a_id, a.username AS a_username, a.display_name AS a_display_name,
       (SELECT count(*) FROM messages r WHERE r.reply_to_id = m.id) AS reply_count,
       p.id AS p_id, p.body AS p_body, p.edited_at AS p_edited_at,
       pa.id AS pa_id, pa.username AS pa_username, pa.display_name AS pa_display_name
FROM messages m
JOIN members a ON a.id = m.author_id
LEFT JOIN messages p ON p.id = m.reply_to_id
LEFT JOIN members pa ON pa.id = p.author_id
WHERE m.id = ANY(%s)
"""


# --- shapes ------------------------------------------------------------------------------------------------------

def load_messages(cur: db.Cursor, ids: list[int], viewer_id: int) -> dict[int, dict[str, Any]]:
    """The message shape of each existing id, as ``viewer_id`` sees it (reactions carry that viewer's ``me``)."""
    if not ids:
        return {}
    cur.execute(_MESSAGE_SQL, (ids,))
    rows = cur.fetchall()
    cur.execute(
        "SELECT message_id, emoji, count(*) AS count, bool_or(member_id = %s) AS me FROM reactions "
        "WHERE message_id = ANY(%s) GROUP BY message_id, emoji ORDER BY min(id)", (viewer_id, ids))
    reactions: dict[int, list[dict[str, Any]]] = {}
    for row in cur.fetchall():
        reactions.setdefault(row["message_id"], []).append(
            {"emoji": row["emoji"], "count": row["count"], "me": row["me"]})
    cur.execute(
        "SELECT id, message_id, filename, size_bytes, content_type, sha256, width, height, duration_ms "
        "FROM attachments WHERE message_id = ANY(%s) ORDER BY position, id", (ids,))
    attachments: dict[int, list[dict[str, Any]]] = {}
    for row in cur.fetchall():
        attachments.setdefault(row["message_id"], []).append(attachment_shape(row))
    shaped: dict[int, dict[str, Any]] = {}
    for row in rows:
        parent = None
        if row["p_id"] is not None:
            parent = {"id": row["p_id"],
                      "author": public_user({"id": row["pa_id"], "username": row["pa_username"],
                                             "display_name": row["pa_display_name"]}),
                      "body": row["p_body"], "edited_at": iso(row["p_edited_at"])}
        shaped[row["id"]] = {
            "id": row["id"], "channel_id": row["channel_id"],
            "author": public_user({"id": row["a_id"], "username": row["a_username"],
                                   "display_name": row["a_display_name"]}),
            "body": row["body"], "created_at": iso(row["created_at"]), "edited_at": iso(row["edited_at"]),
            "reply_to_id": row["reply_to_id"], "referenced_message": parent, "reply_count": row["reply_count"],
            "mentions": sorted(row["mentions"]), "reactions": reactions.get(row["id"], []),
            "attachments": attachments.get(row["id"], [])}
    return shaped


def attachment_shape(row: dict[str, Any]) -> dict[str, Any]:
    return {"id": row["id"], "filename": row["filename"], "size_bytes": row["size_bytes"],
            "content_type": row["content_type"], "sha256": row["sha256"], "url": f"/media/{row['id']}",
            "width": row["width"], "height": row["height"], "duration_ms": row["duration_ms"]}


# --- contexts: who may touch what ----------------------------------------------------------------------------------

def channel_context(cur: db.Cursor, member_id: int, channel_id: int) -> tuple[dict[str, Any], perms.Access]:
    """The channel and the caller's Access; 404 for an unknown channel, 403 for a non-member."""
    found = perms.channel_access(cur, member_id, channel_id)
    if found is None:
        raise ApiError("not_found")
    channel, access = found
    if not access.is_member:
        raise ApiError("forbidden")
    return channel, access


def message_context(cur: db.Cursor, member_id: int, message_id: int,
                    lock: bool = False) -> tuple[dict[str, Any], dict[str, Any], perms.Access]:
    """The message, its channel and the caller's Access; a message the caller cannot view is 404."""
    cur.execute("SELECT * FROM messages WHERE id = %s" + (" FOR UPDATE" if lock else ""), (message_id,))
    message = cur.fetchone()
    if message is None:
        raise ApiError("not_found")
    found = perms.channel_access(cur, member_id, message["channel_id"])
    channel, access = found
    if not access.is_member or not access.can(channel["id"], "view_channel"):
        raise ApiError("not_found")
    return message, channel, access


def member_community(cur: db.Cursor, slug: str, member_id: int) -> tuple[dict[str, Any], perms.Access]:
    """A community by slug for a member-only path: 404 when hidden or unknown, 403 for a non-member."""
    community = communities.visible_community(cur, slug, member_id)
    communities.require_membership(cur, community, member_id)
    return community, perms.load_access(cur, member_id, community["id"], community["owner_id"])


# --- mentions and notifications --------------------------------------------------------------------------------

def mention_tokens(body: str) -> list[str]:
    """Lower-cased names after an at sign, outside inline code spans and fenced code blocks."""
    text = _FENCE.sub("", body)
    text = _INLINE_CODE.sub("", text)
    names: list[str] = []
    for found in _MENTION.finditer(text):
        name = found.group(1).lower()
        names.append(name)
        while name.endswith("."):
            name = name[:-1]
            names.append(name)
    return names


def channel_viewers(cur: db.Cursor, channel: dict[str, Any]) -> dict[int, dict[str, Any]]:
    """Every member who may view the channel now: id -> {username, status, muted, access}."""
    everyone = perms.load_community_access(cur, channel["community_id"], channel["owner_id"])
    allowed = [mid for mid, access in everyone.items() if access.can(channel["id"], "view_channel")]
    cur.execute(
        "SELECT m.id, lower(m.username) AS username, m.status, ms.muted FROM members m "
        "JOIN memberships ms ON ms.member_id = m.id AND ms.community_id = %s WHERE m.id = ANY(%s)",
        (channel["community_id"], allowed))
    return {row["id"]: {**row, "access": everyone[row["id"]]} for row in cur.fetchall()}


def compute_mentions(body: str, author_id: int, can_mention_everyone: bool,
                     viewers: dict[int, dict[str, Any]]) -> list[int]:
    by_name = {v["username"]: mid for mid, v in viewers.items()}
    found: set[int] = set()
    for name in mention_tokens(body):
        if name == "everyone" and can_mention_everyone:
            found |= viewers.keys()
        elif name == "here" and can_mention_everyone:
            found |= {mid for mid, v in viewers.items() if v["status"] == "online"}
        elif name in by_name:
            found.add(by_name[name])
    found.discard(author_id)
    return sorted(found)


def notify(cur: db.Cursor, message_id: int, channel: dict[str, Any], author_id: int, kinds: dict[int, str]) -> None:
    """Insert one notification per receiver (``kinds``: receiver -> kind) and tell their open workspaces."""
    if not kinds:
        return
    receivers = list(kinds)
    cur.execute(
        "INSERT INTO notifications (recipient_id, message_id, community_id, actor_id, kind) "
        "SELECT unnest(%s::int[]), %s, %s, %s, unnest(%s::text[])",
        (receivers, message_id, channel["community_id"], author_id, [kinds[r] for r in receivers]))
    events.publish_to_members(cur, "notifications.changed", receivers, community_id=channel["community_id"])


# --- history -----------------------------------------------------------------------------------------------------

@route("GET", "/api/channels/{channel_id}/messages", session="required")
def history(channel_id: int):
    with db.tx() as cur:
        channel, access = channel_context(cur, g.member["id"], channel_id)
        if not access.can(channel_id, "view_channel"):
            raise ApiError("forbidden")
        limit = g.query.integer("limit", MESSAGE_PAGE, 1, 100)
        before = g.query.integer("before", None, 1, 2147483647)
        cur.execute(
            "SELECT id FROM messages WHERE channel_id = %s AND (%s::int IS NULL OR id < %s) "
            "ORDER BY messages.id DESC LIMIT %s", (channel_id, before, before, limit + 1))
        ids = [row["id"] for row in cur.fetchall()]
        has_more = len(ids) > limit
        ids = sorted(ids[:limit])
        shaped = load_messages(cur, ids, g.member["id"])
        return {"data": [shaped[i] for i in ids], "has_more": has_more}


# --- posting -----------------------------------------------------------------------------------------------------

def _body_limit(member: dict[str, Any]) -> int:
    return catalog.BODY_LIMIT_LONG if "longer_messages" in catalog.ENTITLEMENTS[member["tier"]] else catalog.BODY_LIMIT


def _replay(cur: db.Cursor, author_id: int, channel_id: int, nonce: str) -> int | None:
    cur.execute(
        "SELECT id FROM messages WHERE (author_id, channel_id) = (%s, %s) AND nonce = %s "
        "AND created_at > clock_timestamp() - make_interval(secs => %s) ORDER BY messages.id DESC LIMIT 1",
        (author_id, channel_id, nonce, config.MESSAGE_NONCE_TTL_SECONDS))
    row = cur.fetchone()
    return row["id"] if row else None


def _check_slowmode(cur: db.Cursor, author_id: int, channel: dict[str, Any], access: perms.Access) -> None:
    window = channel["slowmode_seconds"]
    if not window or access.can(channel["id"], "manage_messages"):
        return
    cur.execute(
        "SELECT ceil(extract(epoch FROM (max(created_at) + make_interval(secs => %s) - clock_timestamp()))) AS left "
        "FROM messages WHERE channel_id = %s AND author_id = %s", (window, channel["id"], author_id))
    left = cur.fetchone()["left"]
    if left is not None and left > 0:
        raise ApiError("rate_limited", headers=retry_after(min(int(left), window)))


def _claim_attachments(cur: db.Cursor, member_id: int, ids: list[int]) -> None:
    cur.execute("SELECT id FROM attachments WHERE id = ANY(%s) AND uploader_id = %s AND message_id IS NULL "
                "FOR UPDATE", (ids, member_id))
    if len(cur.fetchall()) != len(ids) or len(set(ids)) != len(ids):
        raise invalid("attachment_ids")


@route("POST", "/api/channels/{channel_id}/messages", session="required", body="json")
def post_message(channel_id: int):
    me = g.member
    with db.tx() as cur:
        cur.execute("SELECT community_id FROM channels WHERE id = %s", (channel_id,))
        found = cur.fetchone()
        if found is None:
            raise ApiError("not_found")
        cur.execute("SELECT 1 FROM memberships WHERE (member_id, community_id) = (%s, %s) FOR SHARE",
                    (me["id"], found["community_id"]))
        channel, access = channel_context(cur, me["id"], channel_id)
        if not access.can(channel_id, "send_messages"):
            raise ApiError("forbidden")
        cur.execute("SELECT verification_level FROM communities WHERE id = %s", (channel["community_id"],))
        if cur.fetchone()["verification_level"] == "email" and not me["email_verified"]:
            raise ApiError("forbidden")
        wanted = g.body.raw("attachment_ids")
        if isinstance(wanted, list) and wanted and not access.can(channel_id, "attach_files"):
            raise ApiError("forbidden")
        nonce = g.body.string("nonce", None, min_length=1, max_length=NONCE_MAX)
        db.advisory(cur, f"post:{me['id']}:{channel_id}")
        if nonce is not None and (stored := _replay(cur, me["id"], channel_id, nonce)) is not None:
            return load_messages(cur, [stored], me["id"])[stored], 200
        _check_slowmode(cur, me["id"], channel, access)
        attachment_ids = g.body.integers("attachment_ids", [], max_items=ATTACHMENT_CAP)
        body = g.body.string("body", "", strip=True)
        if len(body) > _body_limit(me) or (not body and not attachment_ids):
            raise invalid("body")
        parent_id = g.body.integer("reply_to_id", None)
        parent_author = None
        if parent_id is not None:
            cur.execute("SELECT author_id FROM messages WHERE (id, channel_id) = (%s, %s) FOR SHARE",
                        (parent_id, channel_id))
            parent = cur.fetchone()
            if parent is None:
                raise invalid("reply_to_id")
            parent_author = parent["author_id"]
        if attachment_ids:
            _claim_attachments(cur, me["id"], attachment_ids)
        viewers = channel_viewers(cur, channel)
        mentions = compute_mentions(body, me["id"], access.can(channel_id, "mention_everyone"), viewers)
        cur.execute(
            "INSERT INTO messages (channel_id, author_id, body, reply_to_id, nonce, mentions, ever_mentioned) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (channel_id, me["id"], body, parent_id, nonce, mentions, mentions))
        message_id = cur.fetchone()["id"]
        for position, attachment_id in enumerate(attachment_ids):
            cur.execute("UPDATE attachments SET message_id = %s, position = %s WHERE id = %s",
                        (message_id, position, attachment_id))
        cur.execute(
            "INSERT INTO read_states (member_id, channel_id, last_read_message_id) VALUES (%s, %s, %s) "
            "ON CONFLICT (member_id, channel_id) DO UPDATE SET last_read_message_id = "
            "GREATEST(read_states.last_read_message_id, EXCLUDED.last_read_message_id)",
            (me["id"], channel_id, message_id))
        kinds = {}
        for receiver, viewer in viewers.items():
            if receiver == me["id"]:
                continue
            kind = "mention" if receiver in mentions else "reply" if receiver == parent_author else "message"
            if kind == "message" and viewer["muted"]:
                continue
            kinds[receiver] = kind
        notify(cur, message_id, channel, me["id"], kinds)
        events.publish(cur, "message.created", community_id=channel["community_id"], channel_id=channel_id,
                       data={"message_id": message_id})
        if parent_id is not None:
            events.publish(cur, "message.updated", community_id=channel["community_id"], channel_id=channel_id,
                           data={"message_id": parent_id})
        return load_messages(cur, [message_id], me["id"])[message_id], 201


# --- edit and delete -----------------------------------------------------------------------------------------------

def _touch_replies(cur: db.Cursor, channel: dict[str, Any], message_id: int) -> None:
    cur.execute("SELECT id FROM messages WHERE reply_to_id = %s ORDER BY id LIMIT %s", (message_id, REPLY_CAP))
    for reply in cur.fetchall():
        events.publish(cur, "message.updated", community_id=channel["community_id"], channel_id=channel["id"],
                       data={"message_id": reply["id"]})


@route("PATCH", "/api/messages/{message_id}", session="required", body="json")
def edit_message(message_id: int):
    me = g.member
    with db.tx() as cur:
        message, channel, access = message_context(cur, me["id"], message_id, lock=True)
        if message["author_id"] != me["id"]:
            raise ApiError("forbidden")
        cur.execute("SELECT count(*) AS n FROM attachments WHERE message_id = %s", (message_id,))
        has_files = cur.fetchone()["n"] > 0
        body = g.body.string("body", strip=True)
        if len(body) > _body_limit(me) or (not body and not has_files):
            raise invalid("body")
        viewers = channel_viewers(cur, channel)
        mentions = compute_mentions(body, me["id"], access.can(channel["id"], "mention_everyone"), viewers)
        fresh = [m for m in mentions if m not in message["ever_mentioned"]]
        cur.execute(
            "UPDATE messages SET body = %s, edited_at = clock_timestamp(), mentions = %s, "
            "ever_mentioned = %s WHERE id = %s",
            (body, mentions, sorted(set(message["ever_mentioned"]) | set(mentions)), message_id))
        notify(cur, message_id, channel, me["id"], {m: "mention" for m in fresh})
        events.publish(cur, "message.updated", community_id=channel["community_id"], channel_id=channel["id"],
                       data={"message_id": message_id})
        _touch_replies(cur, channel, message_id)
        return load_messages(cur, [message_id], me["id"])[message_id]


@route("DELETE", "/api/messages/{message_id}", session="required")
def delete_message(message_id: int):
    me = g.member
    with db.tx() as cur:
        message, channel, access = message_context(cur, me["id"], message_id, lock=True)
        if message["author_id"] != me["id"] and not access.can(channel["id"], "manage_messages"):
            raise ApiError("forbidden")
        cur.execute("SELECT DISTINCT recipient_id FROM notifications WHERE message_id = %s", (message_id,))
        recipients = [row["recipient_id"] for row in cur.fetchall()]
        cur.execute("SELECT id FROM messages WHERE reply_to_id = %s ORDER BY id LIMIT %s", (message_id, REPLY_CAP))
        replies = [row["id"] for row in cur.fetchall()]
        cur.execute("DELETE FROM messages WHERE id = %s", (message_id,))
        events.publish(cur, "message.deleted", community_id=channel["community_id"], channel_id=channel["id"],
                       data={"message_id": message_id})
        for reply_id in replies + ([message["reply_to_id"]] if message["reply_to_id"] else []):
            events.publish(cur, "message.updated", community_id=channel["community_id"], channel_id=channel["id"],
                           data={"message_id": reply_id})
        events.publish_to_members(cur, "notifications.changed", recipients, community_id=channel["community_id"])
        return None


@route("GET", "/api/messages/{message_id}/replies", session="required")
def replies(message_id: int):
    with db.tx() as cur:
        message_context(cur, g.member["id"], message_id)
        cur.execute("SELECT id FROM messages WHERE reply_to_id = %s ORDER BY id LIMIT %s", (message_id, REPLY_CAP))
        ids = [row["id"] for row in cur.fetchall()]
        shaped = load_messages(cur, ids, g.member["id"])
        return {"data": [shaped[i] for i in ids]}


# --- reactions -----------------------------------------------------------------------------------------------------

def _valid_emoji(emoji: str) -> bool:
    if CUSTOM_EMOJI.fullmatch(emoji):
        return True
    return 1 <= len(emoji) <= 16 and not _ASCII_WORD_OR_SPACE.search(emoji)


@route("PUT", "/api/messages/{message_id}/reactions/{emoji}", session="required")
def add_reaction(message_id: int, emoji: str):
    me = g.member
    with db.tx() as cur:
        message, channel, access = message_context(cur, me["id"], message_id, lock=True)
        if not access.can(channel["id"], "add_reactions"):
            raise ApiError("forbidden")
        if CUSTOM_EMOJI.fullmatch(emoji) and "custom_emoji" not in catalog.ENTITLEMENTS[me["tier"]]:
            raise ApiError("entitlement_required")
        if not _valid_emoji(emoji):
            raise invalid("emoji")
        cur.execute("INSERT INTO reactions (message_id, member_id, emoji) VALUES (%s, %s, %s) "
                    "ON CONFLICT DO NOTHING", (message_id, me["id"], emoji))
        if cur.rowcount:
            events.publish(cur, "message.updated", community_id=channel["community_id"], channel_id=channel["id"],
                           data={"message_id": message_id})
        return None


@route("DELETE", "/api/messages/{message_id}/reactions/{emoji}", session="required")
def remove_reaction(message_id: int, emoji: str):
    me = g.member
    with db.tx() as cur:
        message, channel, access = message_context(cur, me["id"], message_id, lock=True)
        if not _valid_emoji(emoji):
            raise invalid("emoji")
        cur.execute("DELETE FROM reactions WHERE (message_id, member_id) = (%s, %s) AND emoji = %s",
                    (message_id, me["id"], emoji))
        if not cur.rowcount:
            raise ApiError("not_found")
        events.publish(cur, "message.updated", community_id=channel["community_id"], channel_id=channel["id"],
                       data={"message_id": message_id})
        return None


# --- read markers --------------------------------------------------------------------------------------------------

_READ_STATE_SQL = """
SELECT c.id AS channel_id, rs.last_read_message_id,
  (SELECT count(*) FROM messages m WHERE m.channel_id = c.id AND m.author_id <> %(me)s
     AND (rs.last_read_message_id IS NULL OR m.id > rs.last_read_message_id)) AS unread_count,
  (SELECT count(*) FROM messages m WHERE m.channel_id = c.id AND m.author_id <> %(me)s AND %(me)s = ANY(m.mentions)
     AND (rs.last_read_message_id IS NULL OR m.id > rs.last_read_message_id)) AS mention_count
FROM channels c LEFT JOIN read_states rs ON rs.channel_id = c.id AND rs.member_id = %(me)s
WHERE c.id = ANY(%(channels)s) ORDER BY c.position, c.id
"""


@route("GET", "/api/servers/{slug}/read-states", session="required")
def read_states(slug: str):
    with db.tx() as cur:
        community, access = member_community(cur, slug, g.member["id"])
        channels = [c["id"] for c in communities.viewable_channels(cur, access) if c["type"] == "text"]
        cur.execute(_READ_STATE_SQL, {"me": g.member["id"], "channels": channels})
        return {"data": cur.fetchall()}


@route("POST", "/api/channels/{channel_id}/ack", session="required", body="json")
def acknowledge(channel_id: int):
    me = g.member
    with db.tx() as cur:
        channel, access = channel_context(cur, me["id"], channel_id)
        if not access.can(channel_id, "view_channel"):
            raise ApiError("forbidden")
        message_id = g.body.integer("message_id")
        cur.execute("SELECT 1 FROM messages WHERE (id, channel_id) = (%s, %s)", (message_id, channel_id))
        if cur.fetchone() is None:
            raise invalid("message_id")
        cur.execute(
            "INSERT INTO read_states (member_id, channel_id, last_read_message_id) VALUES (%s, %s, %s) "
            "ON CONFLICT (member_id, channel_id) DO UPDATE SET last_read_message_id = "
            "GREATEST(read_states.last_read_message_id, EXCLUDED.last_read_message_id)",
            (me["id"], channel_id, message_id))
        cur.execute(_READ_STATE_SQL, {"me": me["id"], "channels": [channel_id]})
        return cur.fetchone()

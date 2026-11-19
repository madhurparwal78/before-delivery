"""Communities: the directory, detail, creation, ownership changes, membership, bans and time-outs.

Every action that changes who belongs to a community or who may do what in it first locks the
community row, so racing requests settle as if they arrived one at a time.
"""

from __future__ import annotations

import re
from typing import Any

from flask import g

from . import art, catalog, db, events, perms
from .counts import MEMBER_COUNT, PRESENCE_COUNT
from .errors import ApiError, invalid
from .inputs import Body
from .perms import Access
from .router import route
from .serialize import iso, public_user, seen_status

SLUG_PATTERN = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
COMMUNITY_SELECT = (f"SELECT k.*, {MEMBER_COUNT} AS member_count, {PRESENCE_COUNT} AS presence_count "
                    "FROM communities k")
# q is plain text: position() matches it literally, so percent, underscore and backslash are never wildcards or escapes.
DIRECTORY_FILTER = (
    "WHERE k.published AND (%(category)s = 'all' OR k.category = %(category)s) AND (%(q)s::text = '' "
    "OR position(lower(%(q)s::text) IN lower(k.name)) > 0 OR position(lower(%(q)s::text) IN lower(k.description)) > 0 "
    "OR position(lower(%(q)s::text) IN lower(k.keywords)) > 0)")


def get_community(cur: db.Cursor, slug: str) -> dict[str, Any] | None:
    """The community row with its derived counts, or None."""
    cur.execute(COMMUNITY_SELECT + " WHERE k.slug = %s", (slug,))
    return cur.fetchone()


def serialize_community(cur: db.Cursor, row: dict[str, Any]) -> dict[str, Any]:
    return {"id": row["id"], "slug": row["slug"], "name": row["name"], "description": row["description"],
            "icon_url": row["icon"], "splash_url": row["splash"], "banner_url": row["banner"],
            "category": row["category"], "keywords": [k for k in row["keywords"].split(",") if k],
            "verified": row["verified"], "partnered": row["partnered"], "presence_count": row["presence_count"],
            "member_count": row["member_count"], "owner_id": row["owner_id"],
            "verification_level": row["verification_level"]}


def default_channel_id(cur: db.Cursor, community_id: int) -> int:
    cur.execute("SELECT id FROM channels WHERE community_id = %s AND type = 'text' ORDER BY position, id LIMIT 1",
                (community_id,))
    return cur.fetchone()["id"]


def joined_communities(cur: db.Cursor, member_id: int) -> list[dict[str, Any]]:
    cur.execute(
        "SELECT k.id, k.slug, k.name, k.icon, (SELECT c.id FROM channels c WHERE c.community_id = k.id "
        "AND c.type = 'text' ORDER BY c.position, c.id LIMIT 1) AS default_channel_id "
        "FROM memberships ms JOIN communities k ON k.id = ms.community_id WHERE ms.member_id = %s "
        "ORDER BY ms.joined_at, k.id", (member_id,))
    return [{"id": r["id"], "slug": r["slug"], "name": r["name"], "icon_url": r["icon"],
             "default_channel_id": r["default_channel_id"]} for r in cur.fetchall()]


def lock_community(cur: db.Cursor, community_id: int) -> None:
    cur.execute("SELECT 1 FROM communities WHERE id = %s FOR NO KEY UPDATE", (community_id,))


def membership_of(cur: db.Cursor, member_id: int, community_id: int) -> dict[str, Any] | None:
    cur.execute("SELECT * FROM memberships WHERE (member_id, community_id) = (%s, %s)", (member_id, community_id))
    return cur.fetchone()


def visible_community(cur: db.Cursor, slug: str, member_id: int | None, *, lock: bool = False) -> dict[str, Any]:
    """The community when the caller may see it: published, or the caller is a member. Else 404."""
    row = get_community(cur, slug)
    if row is not None and not row["published"]:
        if member_id is None or membership_of(cur, member_id, row["id"]) is None:
            row = None
    if row is None:
        raise ApiError("not_found")
    if lock:
        lock_community(cur, row["id"])
        row = get_community(cur, slug)
    return row


def require_membership(cur: db.Cursor, row: dict[str, Any], member_id: int) -> dict[str, Any]:
    membership = membership_of(cur, member_id, row["id"])
    if membership is None:
        raise ApiError("forbidden")
    return membership


def enroll(cur: db.Cursor, member_id: int, community_id: int, role: str = "member") -> None:
    """Create a membership and a read marker at the newest message of every text channel."""
    cur.execute("INSERT INTO memberships (member_id, community_id, role) VALUES (%s, %s, %s)",
                (member_id, community_id, role))
    cur.execute(
        "INSERT INTO read_states (member_id, channel_id, last_read_message_id) "
        "SELECT %s, c.id, (SELECT max(m.id) FROM messages m WHERE m.channel_id = c.id) "
        "FROM channels c WHERE c.community_id = %s AND c.type = 'text' ON CONFLICT DO NOTHING", (member_id, community_id))
    events.publish(cur, "access.changed", community_id=community_id, member_id=member_id)
    events.publish(cur, "members.changed", community_id=community_id)


def remove_membership(cur: db.Cursor, member_id: int, community_id: int) -> bool:
    """Drop a membership with its roles, member overwrites and read markers. True when it existed."""
    cur.execute("DELETE FROM memberships WHERE (member_id, community_id) = (%s, %s)", (member_id, community_id))
    existed = cur.rowcount > 0
    cur.execute("DELETE FROM member_roles WHERE (member_id, community_id) = (%s, %s)", (member_id, community_id))
    cur.execute("DELETE FROM channel_overwrites WHERE target_type = 'member' AND target_id = %s "
                "AND channel_id IN (SELECT id FROM channels WHERE community_id = %s)", (member_id, community_id))
    cur.execute("DELETE FROM read_states WHERE member_id = %s "
                "AND channel_id IN (SELECT id FROM channels WHERE community_id = %s)", (member_id, community_id))
    if existed:
        events.publish(cur, "access.changed", community_id=community_id, member_id=member_id)
        events.publish(cur, "members.changed", community_id=community_id)
    return existed


def viewable_channels(cur: db.Cursor, access: Access) -> list[dict[str, Any]]:
    cur.execute("SELECT id, name, category, position, topic, type, slowmode_seconds FROM channels "
                "WHERE community_id = %s ORDER BY position, id", (access.community_id,))
    return [c for c in cur.fetchall() if "view_channel" in access.channel_permissions(c["id"])]


def moderator_access(cur: db.Cursor, row: dict[str, Any], key: str) -> Access:
    """The caller's Access when they are the owner or hold ``key``; 403 otherwise (including non-members)."""
    access = perms.load_access(cur, g.member["id"], row["id"], row["owner_id"])
    if not access.is_member or key not in access.community_permissions():
        raise ApiError("forbidden")
    return access


def _text(body: Body, name: str, low: int, high: int) -> str:
    return body.string(name, strip=True, min_length=low, max_length=high)


def directory_listing(q: str, category: str, page: int, per_page: int) -> dict[str, Any]:
    """One directory page of published communities, as GET /api/servers answers it and /servers first draws it."""
    params = {"category": category, "q": q, "limit": per_page, "offset": (page - 1) * per_page}
    with db.tx() as cur:
        cur.execute(f"SELECT * FROM ({COMMUNITY_SELECT} {DIRECTORY_FILTER}) t "
                    "ORDER BY member_count DESC, slug LIMIT %(limit)s OFFSET %(offset)s", params)
        rows = cur.fetchall()
        cur.execute(f"SELECT count(*) AS total FROM communities k {DIRECTORY_FILTER}", params)
        total = cur.fetchone()["total"]
        data = [serialize_community(cur, r) for r in rows]
    return {"data": data, "page": page, "per_page": per_page, "total": total}


def category_counts() -> dict[str, int]:
    """Published communities per directory category, plus "all"; the chip counts never follow the search text."""
    rows = db.all_rows("SELECT category, count(*) AS n FROM communities k WHERE k.published GROUP BY category")
    found = {row["category"]: row["n"] for row in rows}
    return {"all": sum(found.values()), **{c: found.get(c, 0) for c in catalog.CATEGORY_IDS if c != "all"}}


@route("GET", "/api/servers")
def directory() -> dict[str, Any]:
    query = g.query
    q = query.string("q", "").strip()
    if len(q) > 100:
        raise invalid("q")
    category = query.choice("category", catalog.CATEGORY_IDS, "all")
    page = query.integer("page", 1, 1, 1000)
    per_page = query.integer("per_page", 12, 1, 50)
    return directory_listing(q, category, page, per_page)


@route("GET", "/api/servers/{slug}", session="optional")
def detail(slug: str) -> dict[str, Any]:
    member_id = g.member["id"] if g.member else None
    with db.tx() as cur:
        row = visible_community(cur, slug, member_id)
        access = perms.load_access(cur, member_id, row["id"], row["owner_id"])
        me = None
        if access.is_member:
            cur.execute(
                "SELECT role, muted, CASE WHEN communication_disabled_until > clock_timestamp() "
                "THEN communication_disabled_until END AS until FROM memberships WHERE (member_id, community_id) = (%s, %s)",
                (member_id, row["id"]))
            ms = cur.fetchone()
            me = {"role": ms["role"], "muted": ms["muted"], "communication_disabled_until": iso(ms["until"])}
        return {**serialize_community(cur, row), "channels": viewable_channels(cur, access), "me": me}


@route("POST", "/api/servers", session="required", body="json")
def create() -> tuple[dict[str, Any], int]:
    body: Body = g.body
    name = _text(body, "name", 2, 100)
    slug = body.string("slug")
    if not 3 <= len(slug) <= 40 or not SLUG_PATTERN.fullmatch(slug):
        raise invalid("slug")
    category = body.string("category")
    if category not in catalog.CREATE_CATEGORY_IDS:
        raise invalid("category")
    description = body.string("description", "", max_length=300)
    art_urls = art.community_art(slug)
    try:
        with db.tx() as cur:
            cur.execute(
                "INSERT INTO communities (slug, name, description, icon, splash, banner, category, owner_id) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (slug, name, description, art_urls["icon"], art_urls["splash"], art_urls["banner"], category,
                 g.member["id"]))
            community_id = cur.fetchone()["id"]
            cur.execute("INSERT INTO roles (community_id, name, position, permissions, is_default) "
                        "VALUES (%s, '@everyone', 0, %s, true)", (community_id, list(perms.DEFAULT_PERMISSIONS)))
            cur.execute("INSERT INTO channels (community_id, name, category, position) VALUES (%s, 'general', 'Text Channels', 0)",
                        (community_id,))
            enroll(cur, g.member["id"], community_id, "owner")
            row = get_community(cur, slug)
            access = perms.load_access(cur, g.member["id"], community_id, g.member["id"])
            result = {**serialize_community(cur, row), "channels": viewable_channels(cur, access)}
    except db.UniqueViolation:
        raise ApiError("conflict", "slug") from None
    return result, 201


@route("PATCH", "/api/servers/{slug}", session="required", body="json")
def update(slug: str) -> dict[str, Any]:
    body: Body = g.body
    with db.tx() as cur:
        row = visible_community(cur, slug, g.member["id"], lock=True)
        if row["owner_id"] != g.member["id"]:
            raise ApiError("forbidden")
        changes: dict[str, Any] = {}
        if body.has("name"):
            changes["name"] = _text(body, "name", 2, 100)
        if body.has("description"):
            changes["description"] = body.string("description", max_length=300)
        if body.has("published"):
            changes["published"] = body.boolean("published")
        if body.has("verification_level"):
            level = body.string("verification_level")
            if level not in ("none", "email"):
                raise invalid("verification_level")
            changes["verification_level"] = level
        if changes:
            assignments = ", ".join(f"{column} = %s" for column in changes)
            cur.execute(f"UPDATE communities SET {assignments} WHERE id = %s", (*changes.values(), row["id"]))
            if "verification_level" in changes:
                events.publish(cur, "members.changed", community_id=row["id"])
        return serialize_community(cur, get_community(cur, slug))


def _membership_answer(cur: db.Cursor, row: dict[str, Any], role: str) -> dict[str, Any]:
    return {"joined": True, "community_id": row["id"], "default_channel_id": default_channel_id(cur, row["id"]),
            "role": role}


def admit(cur: db.Cursor, row: dict[str, Any], member_id: int) -> tuple[dict[str, Any], int]:
    """Join a locked community: 201 for a new membership, 200 for an existing one, 403 for a banned member."""
    existing = membership_of(cur, member_id, row["id"])
    if existing is not None:
        return _membership_answer(cur, row, existing["role"]), 200
    cur.execute("SELECT 1 FROM bans WHERE (community_id, member_id) = (%s, %s)", (row["id"], member_id))
    if cur.fetchone():
        raise ApiError("forbidden")
    enroll(cur, member_id, row["id"])
    return _membership_answer(cur, row, "member"), 201


@route("POST", "/api/servers/{slug}/join", session="required")
def join(slug: str) -> tuple[dict[str, Any], int]:
    with db.tx() as cur:
        row = visible_community(cur, slug, g.member["id"], lock=True)
        return admit(cur, row, g.member["id"])


@route("DELETE", "/api/servers/{slug}/membership", session="required")
def leave(slug: str) -> None:
    with db.tx() as cur:
        row = visible_community(cur, slug, g.member["id"], lock=True)
        if membership_of(cur, g.member["id"], row["id"]) is None:
            raise ApiError("not_found")
        if row["owner_id"] == g.member["id"]:
            raise ApiError("conflict")
        remove_membership(cur, g.member["id"], row["id"])


@route("PATCH", "/api/servers/{slug}/membership", session="required", body="json")
def mute(slug: str) -> dict[str, bool]:
    with db.tx() as cur:
        row = visible_community(cur, slug, g.member["id"])
        if membership_of(cur, g.member["id"], row["id"]) is None:
            raise ApiError("not_found")
        muted = g.body.boolean("muted")
        cur.execute("UPDATE memberships SET muted = %s WHERE (member_id, community_id) = (%s, %s)",
                    (muted, g.member["id"], row["id"]))
    return {"muted": muted}


@route("GET", "/api/servers/{slug}/members", session="required")
def members(slug: str) -> dict[str, Any]:
    with db.tx() as cur:
        row = visible_community(cur, slug, g.member["id"])
        require_membership(cur, row, g.member["id"])
        cur.execute(
            "SELECT m.id, m.username, m.display_name, m.status, ms.role FROM memberships ms "
            "JOIN members m ON m.id = ms.member_id WHERE ms.community_id = %s "
            "ORDER BY (ms.role = 'owner') DESC, m.username", (row["id"],))
        return {"data": [{"user": public_user(r), "role": r["role"], "status": seen_status(r["status"])}
                         for r in cur.fetchall()]}


def _moderation_target(cur: db.Cursor, row: dict[str, Any], access: Access, user_id: int) -> None:
    """403 unless the caller may act on this user: never the owner or themselves, only users ranked below."""
    if user_id == row["owner_id"] or user_id == g.member["id"]:
        raise ApiError("forbidden")
    if not access.is_owner and perms.rank_of(cur, row["id"], row["owner_id"], user_id) >= access.rank:
        raise ApiError("forbidden")


@route("PUT", "/api/servers/{slug}/bans/{user_id}", session="required")
def ban(slug: str, user_id: int) -> None:
    with db.tx() as cur:
        row = visible_community(cur, slug, g.member["id"], lock=True)
        cur.execute("SELECT 1 FROM members WHERE id = %s", (user_id,))
        if cur.fetchone() is None:
            raise ApiError("not_found")
        access = moderator_access(cur, row, "ban_members")
        _moderation_target(cur, row, access, user_id)
        cur.execute("INSERT INTO bans (community_id, member_id) VALUES (%s, %s) ON CONFLICT DO NOTHING", (row["id"], user_id))
        remove_membership(cur, user_id, row["id"])


@route("GET", "/api/servers/{slug}/bans", session="required")
def bans(slug: str) -> dict[str, Any]:
    with db.tx() as cur:
        row = visible_community(cur, slug, g.member["id"])
        if row["owner_id"] != g.member["id"]:
            raise ApiError("forbidden")
        cur.execute("SELECT m.id, m.username, m.display_name, b.created_at FROM bans b JOIN members m ON m.id = b.member_id "
                    "WHERE b.community_id = %s ORDER BY m.username", (row["id"],))
        return {"data": [{"user": public_user(r), "created_at": iso(r["created_at"])} for r in cur.fetchall()]}


@route("DELETE", "/api/servers/{slug}/bans/{user_id}", session="required")
def unban(slug: str, user_id: int) -> None:
    with db.tx() as cur:
        row = visible_community(cur, slug, g.member["id"], lock=True)
        moderator_access(cur, row, "ban_members")
        cur.execute("DELETE FROM bans WHERE (community_id, member_id) = (%s, %s)", (row["id"], user_id))
        if cur.rowcount == 0:
            raise ApiError("not_found")


@route("PUT", "/api/servers/{slug}/members/{user_id}/timeout", session="required", body="json")
def timeout(slug: str, user_id: int) -> dict[str, Any]:
    with db.tx() as cur:
        row = visible_community(cur, slug, g.member["id"], lock=True)
        access = moderator_access(cur, row, "ban_members")
        if membership_of(cur, user_id, row["id"]) is None:
            raise ApiError("not_found")
        _moderation_target(cur, row, access, user_id)
        seconds = g.body.integer("seconds", low=0, high=2419200)
        cur.execute(
            "UPDATE memberships SET communication_disabled_until = CASE WHEN %(s)s > 0 THEN "
            "date_trunc('second', clock_timestamp()) + make_interval(secs => %(s)s) END "
            "WHERE (member_id, community_id) = (%(user)s, %(community)s) RETURNING communication_disabled_until",
            {"s": seconds, "user": user_id, "community": row["id"]})
        until = cur.fetchone()["communication_disabled_until"]
        events.publish(cur, "timeout.changed", community_id=row["id"], member_id=user_id,
                       data={"community_id": row["id"]})
    return {"user_id": user_id, "communication_disabled_until": iso(until)}

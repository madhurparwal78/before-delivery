"""Roles, role assignments, channel overwrites and the caller's own effective permissions.

Managers who are not the owner act only on roles and members ranked strictly below their own rank,
and may hand out only permissions they hold themselves.
"""

from __future__ import annotations

from typing import Any

from flask import g

from . import communities, db, events, perms
from .errors import ApiError, invalid
from .inputs import Body
from .perms import PERMISSION_KEYS, Access
from .router import route


def serialize_role(row: dict[str, Any]) -> dict[str, Any]:
    return {"id": row["id"], "name": row["name"], "position": row["position"],
            "permissions": sorted(row["permissions"]), "is_default": row["is_default"]}


def _role_name(body: Body) -> str:
    name = body.string("name", strip=True, min_length=1, max_length=32)
    if name.lower() == "@everyone":
        raise invalid("name")
    return name


def _manager(cur: db.Cursor, row: dict[str, Any]) -> Access:
    return communities.moderator_access(cur, row, "manage_roles")


def _may_grant(access: Access, keys: set[str]) -> None:
    if not access.is_owner and not keys <= access.community_permissions():
        raise ApiError("forbidden")


def _below_rank(access: Access, position: int) -> None:
    if not access.is_owner and position >= access.rank:
        raise ApiError("forbidden")


def _owned_role(cur: db.Cursor, role_id: int, *, lock: bool = False) -> tuple[dict[str, Any], dict[str, Any]]:
    """The role and its community, locked; 404 unless the caller can see the community."""
    cur.execute("SELECT community_id FROM roles WHERE id = %s", (role_id,))
    found = cur.fetchone()
    if found is None:
        raise ApiError("not_found")
    cur.execute("SELECT slug FROM communities WHERE id = %s", (found["community_id"],))
    row = communities.visible_community(cur, cur.fetchone()["slug"], g.member["id"], lock=lock)
    cur.execute("SELECT * FROM roles WHERE id = %s", (role_id,))
    role = cur.fetchone()
    if role is None:
        raise ApiError("not_found")
    return role, row


@route("GET", "/api/servers/{slug}/roles", session="required")
def list_roles(slug: str) -> dict[str, Any]:
    with db.tx() as cur:
        row = communities.visible_community(cur, slug, g.member["id"])
        communities.require_membership(cur, row, g.member["id"])
        cur.execute("SELECT * FROM roles WHERE community_id = %s ORDER BY position, id", (row["id"],))
        return {"data": [serialize_role(r) for r in cur.fetchall()]}


@route("POST", "/api/servers/{slug}/roles", session="required", body="json")
def create_role(slug: str) -> tuple[dict[str, Any], int]:
    with db.tx() as cur:
        row = communities.visible_community(cur, slug, g.member["id"], lock=True)
        access = _manager(cur, row)
        name = _role_name(g.body)
        keys = g.body.strings("permissions", [], allowed=set(PERMISSION_KEYS))
        _may_grant(access, set(keys))
        cur.execute("SELECT 1 FROM roles WHERE community_id = %s AND lower(name) = lower(%s)", (row["id"], name))
        if cur.fetchone():
            raise ApiError("conflict", "name")
        if access.is_owner:
            cur.execute("SELECT max(position) + 1 AS position FROM roles WHERE community_id = %s", (row["id"],))
            position = cur.fetchone()["position"]
        else:
            position = access.rank
            cur.execute("UPDATE roles SET position = position + 1 WHERE community_id = %s AND position >= %s",
                        (row["id"], position))
        cur.execute("INSERT INTO roles (community_id, name, position, permissions) VALUES (%s, %s, %s, %s) RETURNING *",
                    (row["id"], name, position, sorted(set(keys))))
        role = cur.fetchone()
        events.publish(cur, "access.changed", community_id=row["id"])
        return serialize_role(role), 201


@route("PATCH", "/api/roles/{role_id}", session="required", body="json")
def update_role(role_id: int) -> dict[str, Any]:
    with db.tx() as cur:
        role, row = _owned_role(cur, role_id, lock=True)
        access = _manager(cur, row)
        _below_rank(access, role["position"])
        changes: dict[str, Any] = {}
        if g.body.has("name"):
            if role["is_default"]:
                raise invalid("name")
            changes["name"] = _role_name(g.body)
            cur.execute("SELECT 1 FROM roles WHERE community_id = %s AND lower(name) = lower(%s) AND id <> %s",
                        (row["id"], changes["name"], role_id))
            if cur.fetchone():
                raise ApiError("conflict", "name")
        if g.body.has("permissions"):
            keys = set(g.body.strings("permissions", allowed=set(PERMISSION_KEYS)))
            _may_grant(access, keys)
            changes["permissions"] = sorted(keys)
        if changes:
            assignments = ", ".join(f"{column} = %s" for column in changes)
            cur.execute(f"UPDATE roles SET {assignments} WHERE id = %s RETURNING *", (*changes.values(), role_id))
            role = cur.fetchone()
            events.publish(cur, "access.changed", community_id=row["id"])
        return serialize_role(role)


@route("DELETE", "/api/roles/{role_id}", session="required")
def delete_role(role_id: int) -> None:
    with db.tx() as cur:
        role, row = _owned_role(cur, role_id, lock=True)
        access = _manager(cur, row)
        _below_rank(access, role["position"])
        if role["is_default"]:
            raise ApiError("conflict", "role_id")
        cur.execute("DELETE FROM channel_overwrites WHERE target_type = 'role' AND target_id = %s", (role_id,))
        cur.execute("DELETE FROM roles WHERE id = %s", (role_id,))
        events.publish(cur, "access.changed", community_id=row["id"])


def _assign(slug: str, user_id: int, role_id: int, assign: bool) -> None:
    with db.tx() as cur:
        row = communities.visible_community(cur, slug, g.member["id"], lock=True)
        access = _manager(cur, row)
        if communities.membership_of(cur, user_id, row["id"]) is None:
            raise ApiError("not_found")
        cur.execute("SELECT * FROM roles WHERE (id, community_id) = (%s, %s)", (role_id, row["id"]))
        role = cur.fetchone()
        if role is None:
            raise ApiError("not_found")
        if user_id == row["owner_id"]:
            raise ApiError("forbidden")
        if role["is_default"]:
            raise invalid("role_id")
        _below_rank(access, role["position"])
        if assign:
            cur.execute("INSERT INTO member_roles (community_id, member_id, role_id) VALUES (%s, %s, %s) "
                        "ON CONFLICT DO NOTHING", (row["id"], user_id, role_id))
        else:
            cur.execute("DELETE FROM member_roles WHERE member_id = %s AND role_id = %s", (user_id, role_id))
        events.publish(cur, "access.changed", community_id=row["id"], member_id=user_id)
        events.publish(cur, "members.changed", community_id=row["id"])


@route("PUT", "/api/servers/{slug}/members/{user_id}/roles/{role_id}", session="required")
def assign_role(slug: str, user_id: int, role_id: int) -> None:
    _assign(slug, user_id, role_id, True)


@route("DELETE", "/api/servers/{slug}/members/{user_id}/roles/{role_id}", session="required")
def remove_role(slug: str, user_id: int, role_id: int) -> None:
    _assign(slug, user_id, role_id, False)


def _channel_community(cur: db.Cursor, channel_id: int, *, lock: bool = False) -> dict[str, Any]:
    cur.execute("SELECT k.slug FROM channels c JOIN communities k ON k.id = c.community_id WHERE c.id = %s", (channel_id,))
    found = cur.fetchone()
    if found is None:
        raise ApiError("not_found")
    return communities.visible_community(cur, found["slug"], g.member["id"], lock=lock)


def serialize_overwrite(row: dict[str, Any]) -> dict[str, Any]:
    return {"channel_id": row["channel_id"], "target_type": row["target_type"], "target_id": row["target_id"],
            "allow": sorted(row["allow"]), "deny": sorted(row["deny"])}


def _overwrite_target(cur: db.Cursor, row: dict[str, Any], access: Access, target_type: str, target_id: int) -> None:
    """404 for a target outside the community, 403 for the owner or a target ranked at or above the caller."""
    if target_type == "role":
        cur.execute("SELECT position FROM roles WHERE (id, community_id) = (%s, %s)", (target_id, row["id"]))
        found = cur.fetchone()
        if found is None:
            raise ApiError("not_found")
        _below_rank(access, found["position"])
        return
    if communities.membership_of(cur, target_id, row["id"]) is None:
        raise ApiError("not_found")
    if target_id == row["owner_id"]:
        raise ApiError("forbidden")
    _below_rank(access, perms.rank_of(cur, row["id"], row["owner_id"], target_id))


def _target_type(value: str) -> str:
    if value not in ("role", "member"):
        raise ApiError("not_found")
    return value


@route("PUT", "/api/channels/{channel_id}/overwrites/{target_type}/{target_id}", session="required", body="json")
def set_overwrite(channel_id: int, target_type: str, target_id: int) -> dict[str, Any]:
    kind = _target_type(target_type)
    with db.tx() as cur:
        row = _channel_community(cur, channel_id, lock=True)
        access = _manager(cur, row)
        _overwrite_target(cur, row, access, kind, target_id)
        allow = set(g.body.strings("allow", [], allowed=set(PERMISSION_KEYS)))
        deny = set(g.body.strings("deny", [], allowed=set(PERMISSION_KEYS)))
        if allow & deny:
            raise invalid("deny")
        _may_grant(access, allow)
        cur.execute(
            "INSERT INTO channel_overwrites (channel_id, target_type, target_id, allow, deny) VALUES (%s, %s, %s, %s, %s) "
            "ON CONFLICT (channel_id, target_type, target_id) DO UPDATE SET allow = EXCLUDED.allow, deny = EXCLUDED.deny "
            "RETURNING *", (channel_id, kind, target_id, sorted(allow), sorted(deny)))
        overwrite = cur.fetchone()
        events.publish(cur, "access.changed", community_id=row["id"])
        return serialize_overwrite(overwrite)


@route("DELETE", "/api/channels/{channel_id}/overwrites/{target_type}/{target_id}", session="required")
def delete_overwrite(channel_id: int, target_type: str, target_id: int) -> None:
    kind = _target_type(target_type)
    with db.tx() as cur:
        row = _channel_community(cur, channel_id, lock=True)
        access = _manager(cur, row)
        cur.execute("SELECT 1 FROM channel_overwrites WHERE channel_id = %s AND target_type = %s AND target_id = %s",
                    (channel_id, kind, target_id))
        if cur.fetchone() is None:
            raise ApiError("not_found")
        _overwrite_target(cur, row, access, kind, target_id)
        cur.execute("DELETE FROM channel_overwrites WHERE channel_id = %s AND target_type = %s AND target_id = %s",
                    (channel_id, kind, target_id))
        events.publish(cur, "access.changed", community_id=row["id"])


@route("GET", "/api/channels/{channel_id}/overwrites", session="required")
def list_overwrites(channel_id: int) -> dict[str, Any]:
    with db.tx() as cur:
        row = _channel_community(cur, channel_id)
        _manager(cur, row)
        cur.execute(
            "SELECT o.* FROM channel_overwrites o LEFT JOIN roles r ON o.target_type = 'role' AND r.id = o.target_id "
            "WHERE o.channel_id = %s ORDER BY (o.target_type = 'member'), r.position, o.target_id", (channel_id,))
        return {"data": [serialize_overwrite(r) for r in cur.fetchall()]}


@route("GET", "/api/channels/{channel_id}/permissions", session="required")
def channel_permissions(channel_id: int) -> dict[str, Any]:
    with db.tx() as cur:
        found = perms.channel_access(cur, g.member["id"], channel_id)
        if found is None:
            raise ApiError("not_found")
        _, access = found
        if not access.is_member:
            raise ApiError("forbidden")
        return {"channel_id": channel_id, "permissions": sorted(access.channel_permissions(channel_id))}

"""Invites: short-lived or limited links that admit new members, valid by the database clock."""

from __future__ import annotations

import secrets
import string
from typing import Any

from flask import g

from . import communities, db
from .errors import ApiError
from .router import route
from .serialize import iso, public_user

CODE_ALPHABET = string.ascii_letters + string.digits
# An invite is valid while not revoked, under its use limit and before expires_at (database clock).
VALID = ("i.revoked_at IS NULL AND (i.max_uses = 0 OR i.uses < i.max_uses) "
         "AND (i.expires_at IS NULL OR clock_timestamp() < i.expires_at)")


def serialize_invite(cur: db.Cursor, row: dict[str, Any]) -> dict[str, Any]:
    cur.execute("SELECT id, username, display_name FROM members WHERE id = %s", (row["inviter_id"],))
    inviter = public_user(cur.fetchone())
    return {"code": row["code"], "community_id": row["community_id"],
            "channel_id": communities.default_channel_id(cur, row["community_id"]), "inviter": inviter,
            "uses": row["uses"], "max_uses": row["max_uses"], "max_age_seconds": row["max_age_seconds"],
            "expires_at": iso(row["expires_at"]), "created_at": iso(row["created_at"])}


def _valid_invite(cur: db.Cursor, code: str, *, lock: bool = False) -> dict[str, Any]:
    cur.execute(f"SELECT i.* FROM invites i WHERE i.code = %s AND {VALID}" + (" FOR UPDATE" if lock else ""), (code,))
    invite = cur.fetchone()
    if invite is None:
        raise ApiError("not_found")
    return invite


@route("POST", "/api/servers/{slug}/invites", session="required", body="json")
def create_invite(slug: str) -> tuple[dict[str, Any], int]:
    with db.tx() as cur:
        row = communities.visible_community(cur, slug, g.member["id"])
        communities.moderator_access(cur, row, "create_invite")
        max_uses = g.body.integer("max_uses", 0, low=0, high=100)
        max_age = g.body.integer("max_age_seconds", 86400, low=0, high=604800)
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))
        cur.execute(
            "INSERT INTO invites (code, community_id, inviter_id, max_uses, max_age_seconds, created_at, expires_at) "
            "SELECT %(code)s, %(community)s, %(inviter)s, %(uses)s, %(age)s, now_s, "
            "CASE WHEN %(age)s > 0 THEN now_s + make_interval(secs => %(age)s) END "
            "FROM (SELECT date_trunc('second', clock_timestamp()) AS now_s) t RETURNING *",
            {"code": code, "community": row["id"], "inviter": g.member["id"], "uses": max_uses, "age": max_age})
        return serialize_invite(cur, cur.fetchone()), 201


@route("GET", "/api/servers/{slug}/invites", session="required")
def list_invites(slug: str) -> dict[str, Any]:
    with db.tx() as cur:
        row = communities.visible_community(cur, slug, g.member["id"])
        if row["owner_id"] != g.member["id"]:
            raise ApiError("forbidden")
        cur.execute(f"SELECT i.* FROM invites i WHERE i.community_id = %s AND {VALID} ORDER BY i.id", (row["id"],))
        return {"data": [serialize_invite(cur, i) for i in cur.fetchall()]}


@route("GET", "/api/invites/{code}")
def preview(code: str) -> dict[str, Any]:
    with db.tx() as cur:
        invite = _valid_invite(cur, code)
        cur.execute(f"{communities.COMMUNITY_SELECT} WHERE k.id = %s", (invite["community_id"],))
        row = cur.fetchone()
        return {"code": code,
                "community": {"id": row["id"], "slug": row["slug"], "name": row["name"], "icon_url": row["icon"],
                              "member_count": row["member_count"], "presence_count": row["presence_count"]},
                "inviter": serialize_invite(cur, invite)["inviter"], "expires_at": iso(invite["expires_at"])}


@route("DELETE", "/api/invites/{code}", session="required")
def revoke(code: str) -> None:
    with db.tx() as cur:
        invite = _valid_invite(cur, code, lock=True)
        cur.execute("SELECT owner_id FROM communities WHERE id = %s", (invite["community_id"],))
        if g.member["id"] not in (invite["inviter_id"], cur.fetchone()["owner_id"]):
            raise ApiError("forbidden")
        cur.execute("UPDATE invites SET revoked_at = clock_timestamp() WHERE id = %s", (invite["id"],))


@route("POST", "/api/invites/{code}/accept", session="required")
def accept(code: str) -> tuple[dict[str, Any], int]:
    with db.tx() as cur:
        first = _valid_invite(cur, code)
        communities.lock_community(cur, first["community_id"])
        invite = _valid_invite(cur, code, lock=True)
        cur.execute(f"{communities.COMMUNITY_SELECT} WHERE k.id = %s", (invite["community_id"],))
        body, status = communities.admit(cur, cur.fetchone(), g.member["id"])
        if status == 201:
            cur.execute("UPDATE invites SET uses = uses + 1 WHERE id = %s", (invite["id"],))
        return body, status

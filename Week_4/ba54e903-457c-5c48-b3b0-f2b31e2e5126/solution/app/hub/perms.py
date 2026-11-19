"""Effective permissions: the one place that decides what a member may do in a channel.

Every read, write, listing, search, mention, notification, inbox, hidden-message and live-delivery
path calls ``Access.channel_permissions``. Nothing is remembered between calls.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from . import db


PERMISSION_KEYS = ("add_reactions", "attach_files", "ban_members", "create_invite", "manage_messages",
                   "manage_roles", "mention_everyone", "send_messages", "view_channel")
DEFAULT_PERMISSIONS = ("add_reactions", "attach_files", "create_invite", "send_messages", "view_channel")
OWNER_RANK = 1 << 30


@dataclass
class Access:
    """One member's standing in one community, loaded at one moment."""

    community_id: int
    owner_id: int | None
    member_id: int | None
    is_member: bool = False
    timed_out: bool = False
    default_role_id: int = 0
    role_ids: list[int] = field(default_factory=list)
    base: set[str] = field(default_factory=set)
    rank: int = 0
    overwrites: dict[int, dict[tuple[str, int], tuple[set[str], set[str]]]] = field(default_factory=dict)

    @property
    def is_owner(self) -> bool:
        return self.member_id is not None and self.member_id == self.owner_id

    def community_permissions(self) -> set[str]:
        return set(PERMISSION_KEYS) if self.is_owner else set(self.base)

    def channel_permissions(self, channel_id: int) -> set[str]:
        if self.is_owner:
            return set(PERMISSION_KEYS)
        perms = set(self.base)
        table = self.overwrites.get(channel_id, {})
        allow, deny = table.get(("role", self.default_role_id), (set(), set()))
        perms = (perms - deny) | allow
        deny_union: set[str] = set()
        allow_union: set[str] = set()
        for role_id in self.role_ids:
            role_allow, role_deny = table.get(("role", role_id), (set(), set()))
            allow_union |= role_allow
            deny_union |= role_deny
        perms = (perms - deny_union) | allow_union
        if self.is_member and self.member_id is not None:
            allow, deny = table.get(("member", self.member_id), (set(), set()))
            perms = (perms - deny) | allow
        if "view_channel" not in perms:
            return set()
        if "send_messages" not in perms:
            perms -= {"mention_everyone", "attach_files"}
        if self.timed_out:
            perms &= {"view_channel"}
        return perms

    def can(self, channel_id: int, key: str) -> bool:
        return key in self.channel_permissions(channel_id)


def load_community_access(cur: db.Cursor, community_id: int, owner_id: int | None,
                          member_ids: list[int] | None = None) -> dict[int, Access]:
    """Access for members of a community (all of them, or the listed ones), loaded at one moment."""
    cur.execute("SELECT id, permissions FROM roles WHERE community_id = %s AND is_default", (community_id,))
    default = cur.fetchone()
    cur.execute(
        "SELECT member_id, communication_disabled_until > clock_timestamp() AS timed_out FROM memberships "
        "WHERE community_id = %s AND (%s::int[] IS NULL OR member_id = ANY(%s))", (community_id, member_ids, member_ids))
    memberships = {row["member_id"]: bool(row["timed_out"]) for row in cur.fetchall()}
    cur.execute(
        "SELECT mr.member_id, r.id, r.permissions, r.position FROM member_roles mr JOIN roles r ON r.id = mr.role_id "
        "WHERE mr.community_id = %s", (community_id,))
    held: dict[int, list[dict[str, Any]]] = {}
    for row in cur.fetchall():
        held.setdefault(row["member_id"], []).append(row)
    cur.execute(
        "SELECT o.channel_id, o.target_type, o.target_id, o.allow, o.deny FROM channel_overwrites o "
        "JOIN channels c ON c.id = o.channel_id WHERE c.community_id = %s", (community_id,))
    overwrite_rows = cur.fetchall()
    result: dict[int, Access] = {}
    for member_id, timed_out in memberships.items():
        roles = held.get(member_id, [])
        access = Access(community_id=community_id, owner_id=owner_id, member_id=member_id, is_member=True,
                        timed_out=timed_out, default_role_id=default["id"], role_ids=[r["id"] for r in roles],
                        base=set(default["permissions"]).union(*(r["permissions"] for r in roles)),
                        rank=max([r["position"] for r in roles], default=0))
        if access.is_owner:
            access.rank = OWNER_RANK
        _attach_overwrites(access, overwrite_rows)
        result[member_id] = access
    return result


def _attach_overwrites(access: Access, rows: list[dict[str, Any]]) -> None:
    for row in rows:
        key = (row["target_type"], row["target_id"])
        relevant = (key == ("role", access.default_role_id) or (key[0] == "role" and key[1] in access.role_ids)
                    or (key == ("member", access.member_id) and access.is_member))
        if relevant:
            access.overwrites.setdefault(row["channel_id"], {})[key] = (set(row["allow"]), set(row["deny"]))


def load_access(cur: db.Cursor, member_id: int | None, community_id: int, owner_id: int | None = None) -> Access:
    """One member's Access in a community (member_id None or a non-member: the default role only)."""
    if owner_id is None:
        cur.execute("SELECT owner_id FROM communities WHERE id = %s", (community_id,))
        owner_id = cur.fetchone()["owner_id"]
    if member_id is not None:
        found = load_community_access(cur, community_id, owner_id, [member_id]).get(member_id)
        if found is not None:
            return found
    cur.execute("SELECT id, permissions FROM roles WHERE community_id = %s AND is_default", (community_id,))
    default = cur.fetchone()
    outsider = Access(community_id=community_id, owner_id=owner_id, member_id=member_id,
                      default_role_id=default["id"], base=set(default["permissions"]))
    cur.execute(
        "SELECT o.channel_id, o.target_type, o.target_id, o.allow, o.deny FROM channel_overwrites o "
        "JOIN channels c ON c.id = o.channel_id WHERE c.community_id = %s", (community_id,))
    _attach_overwrites(outsider, cur.fetchall())
    return outsider


def channel_access(cur: db.Cursor, member_id: int | None, channel_id: int) -> tuple[dict[str, Any], Access] | None:
    """The channel row and the member's Access in its community, or None for an unknown channel."""
    cur.execute(
        "SELECT c.*, k.owner_id FROM channels c JOIN communities k ON k.id = c.community_id WHERE c.id = %s",
        (channel_id,))
    channel = cur.fetchone()
    if channel is None:
        return None
    return channel, load_access(cur, member_id, channel["community_id"], channel["owner_id"])


def rank_of(cur: db.Cursor, community_id: int, owner_id: int, member_id: int) -> int:
    """A member's rank: the owner above everyone, else the highest role position held (0 for none or a non-member)."""
    if member_id == owner_id:
        return OWNER_RANK
    cur.execute(
        "SELECT COALESCE(max(r.position), 0) AS rank FROM member_roles mr JOIN roles r ON r.id = mr.role_id "
        "WHERE mr.member_id = %s AND mr.community_id = %s", (member_id, community_id))
    return cur.fetchone()["rank"]

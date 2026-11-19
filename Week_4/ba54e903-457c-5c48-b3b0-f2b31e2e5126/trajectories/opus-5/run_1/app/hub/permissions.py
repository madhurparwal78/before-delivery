"""Effective permissions and role rank: the one place that decides either.

Every read, write, listing, search, mention, notification, inbox, hidden-message and
live-delivery path asks this module.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Sequence

import asyncpg

PERMISSION_KEYS: frozenset[str] = frozenset(
    {
        "view_channel",
        "send_messages",
        "attach_files",
        "add_reactions",
        "create_invite",
        "mention_everyone",
        "manage_messages",
        "ban_members",
        "manage_roles",
    }
)

OWNER_RANK = 1 << 30

MEMBER_STATE_SQL = """
SELECT
    m.role AS membership_role,
    m.muted,
    m.communication_disabled_until,
    (m.communication_disabled_until IS NOT NULL
     AND m.communication_disabled_until > clock_timestamp()) AS timed_out,
    c.id AS community_id,
    c.owner_id,
    c.verification_level,
    COALESCE((SELECT r.permissions FROM roles r
              WHERE r.community_id = c.id AND r.is_default), '{}') AS default_permissions,
    COALESCE((SELECT array_agg(r.id) FROM member_roles mr
              JOIN roles r ON r.id = mr.role_id
              WHERE mr.member_id = m.member_id AND mr.community_id = c.id), '{}') AS role_ids,
    COALESCE((SELECT max(r.position) FROM member_roles mr
              JOIN roles r ON r.id = mr.role_id
              WHERE mr.member_id = m.member_id AND mr.community_id = c.id), 0) AS rank,
    COALESCE((SELECT array_agg(DISTINCT perm) FROM member_roles mr
              JOIN roles r ON r.id = mr.role_id
              CROSS JOIN LATERAL unnest(r.permissions) AS perm
              WHERE mr.member_id = m.member_id AND mr.community_id = c.id), '{}')
        AS role_permissions
FROM memberships m
JOIN communities c ON c.id = m.community_id
WHERE m.community_id = $1 AND m.member_id = $2
"""


@dataclass(frozen=True)
class MemberState:
    """What one member is, right now, in one community."""

    community_id: int
    member_id: int | None
    is_member: bool
    is_owner: bool
    membership_role: str
    muted: bool
    timed_out: bool
    communication_disabled_until: Any
    rank: int
    role_ids: tuple[int, ...]
    community_permissions: frozenset[str]
    verification_level: str = "none"

    def can(self, key: str) -> bool:
        return self.is_owner or key in self.community_permissions


def _state_from_row(row: Mapping[str, Any], member_id: int) -> MemberState:
    is_owner = row["owner_id"] == member_id
    permissions = set(row["default_permissions"]) | set(row["role_permissions"])
    if is_owner:
        permissions = set(PERMISSION_KEYS)
    return MemberState(
        community_id=row["community_id"],
        member_id=member_id,
        is_member=True,
        is_owner=is_owner,
        membership_role=row["membership_role"],
        muted=row["muted"],
        timed_out=bool(row["timed_out"]) and not is_owner,
        communication_disabled_until=row["communication_disabled_until"],
        rank=OWNER_RANK if is_owner else int(row["rank"]),
        role_ids=tuple(row["role_ids"]),
        community_permissions=frozenset(permissions),
        verification_level=row["verification_level"],
    )


async def load_member_state(
    conn: asyncpg.Connection, community_id: int, member_id: int | None
) -> MemberState | None:
    """The caller's standing in a community, or None when they are not a member."""
    if member_id is None:
        return None
    row = await conn.fetchrow(MEMBER_STATE_SQL, community_id, member_id)
    if row is None:
        return None
    return _state_from_row(row, member_id)


async def outsider_state(
    conn: asyncpg.Connection, community_id: int
) -> MemberState:
    """What a member with only the default role and no member overwrite would see."""
    row = await conn.fetchrow(
        """
        SELECT c.id AS community_id, c.verification_level,
               COALESCE((SELECT r.permissions FROM roles r
                         WHERE r.community_id = c.id AND r.is_default), '{}') AS permissions
        FROM communities c WHERE c.id = $1
        """,
        community_id,
    )
    return MemberState(
        community_id=community_id,
        member_id=None,
        is_member=False,
        is_owner=False,
        membership_role="",
        muted=False,
        timed_out=False,
        communication_disabled_until=None,
        rank=0,
        role_ids=(),
        community_permissions=frozenset(row["permissions"] if row else ()),
        verification_level=row["verification_level"] if row else "none",
    )


@dataclass
class Overwrite:
    target_type: str
    target_id: int
    allow: tuple[str, ...]
    deny: tuple[str, ...]
    role_position: int = -1
    role_is_default: bool = False


def resolve(state: MemberState, overwrites: Sequence[Overwrite]) -> frozenset[str]:
    """The stated order: default role, then the member's roles, then the member."""
    if state.is_owner:
        return frozenset(PERMISSION_KEYS)

    permissions = set(state.community_permissions)

    for overwrite in overwrites:
        if overwrite.target_type == "role" and overwrite.role_is_default:
            permissions -= set(overwrite.deny)
            permissions |= set(overwrite.allow)

    role_allow: set[str] = set()
    role_deny: set[str] = set()
    for overwrite in overwrites:
        if (
            overwrite.target_type == "role"
            and not overwrite.role_is_default
            and overwrite.target_id in state.role_ids
        ):
            role_allow |= set(overwrite.allow)
            role_deny |= set(overwrite.deny)
    permissions -= role_deny
    permissions |= role_allow

    if state.member_id is not None:
        for overwrite in overwrites:
            if overwrite.target_type == "member" and overwrite.target_id == state.member_id:
                permissions -= set(overwrite.deny)
                permissions |= set(overwrite.allow)

    if "view_channel" not in permissions:
        return frozenset()
    if "send_messages" not in permissions:
        permissions -= {"mention_everyone", "attach_files"}
    if state.timed_out:
        permissions &= {"view_channel"}
    return frozenset(permissions)


def _overwrites_from_rows(rows: Iterable[Mapping[str, Any]]) -> list[Overwrite]:
    return [
        Overwrite(
            target_type=row["target_type"],
            target_id=row["target_id"],
            allow=tuple(row["allow"]),
            deny=tuple(row["deny"]),
            role_position=row["role_position"] if row["role_position"] is not None else -1,
            role_is_default=bool(row["role_is_default"]),
        )
        for row in rows
    ]


OVERWRITE_SQL = """
SELECT o.channel_id, o.target_type, o.target_id, o.allow, o.deny,
       r.position AS role_position, COALESCE(r.is_default, false) AS role_is_default
FROM channel_overwrites o
LEFT JOIN roles r ON o.target_type = 'role' AND r.id = o.target_id
WHERE o.channel_id = ANY($1::int[])
ORDER BY o.target_type, COALESCE(r.position, 0), o.target_id
"""


async def channel_permissions(
    conn: asyncpg.Connection, channel_id: int, state: MemberState
) -> frozenset[str]:
    rows = await conn.fetch(OVERWRITE_SQL, [channel_id])
    return resolve(state, _overwrites_from_rows(rows))


async def permissions_by_channel(
    conn: asyncpg.Connection, channel_ids: Sequence[int], state: MemberState
) -> dict[int, frozenset[str]]:
    """Effective permissions for many channels at once, by the same rule."""
    rows = await conn.fetch(OVERWRITE_SQL, list(channel_ids))
    grouped: dict[int, list[Overwrite]] = {channel_id: [] for channel_id in channel_ids}
    for row in rows:
        grouped[row["channel_id"]].append(_overwrites_from_rows([row])[0])
    return {
        channel_id: resolve(state, grouped[channel_id]) for channel_id in channel_ids
    }


def outranks(actor: MemberState, target_rank: int) -> bool:
    """The role-rank rule: a manager acts only strictly below their own rank."""
    if actor.is_owner:
        return True
    return actor.rank > target_rank


async def rank_of(conn: asyncpg.Connection, community_id: int, member_id: int) -> int:
    """A target's rank; a non-member ranks 0, the owner ranks above everyone."""
    row = await conn.fetchrow(
        """
        SELECT c.owner_id,
               COALESCE((SELECT max(r.position) FROM member_roles mr
                         JOIN roles r ON r.id = mr.role_id
                         WHERE mr.member_id = $2 AND mr.community_id = c.id), 0) AS rank
        FROM communities c WHERE c.id = $1
        """,
        community_id,
        member_id,
    )
    if row is None:
        return 0
    if row["owner_id"] == member_id:
        return OWNER_RANK
    return int(row["rank"])

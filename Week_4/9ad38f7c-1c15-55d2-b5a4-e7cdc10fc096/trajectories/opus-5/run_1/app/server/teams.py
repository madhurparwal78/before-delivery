"""Teams: forming, joining, leaving, captaincy, removal and invite codes.

Every change to one team happens while holding that team's advisory lock, so
simultaneous joins, leaves and removals are settled by the database.
"""

from __future__ import annotations

import secrets
from typing import Any

from .accounts import Caller
from .config import TEAM_MEMBER_CAP
from .db import LOCK_CLASS_TEAM, Transaction, key32
from .errors import ApiError
from .live import publish_team
from .scenarios import states
from .scoring import team_score, tickets_expression
from .validation import (
    path_user_id,
    required_text,
    team_name_problem,
)

INVITE_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
INVITE_CODE_LENGTH = 8

MEMBERS_SQL = f"""
    SELECT memberships.user_id, users.display_name, memberships.joined_at,
           {tickets_expression("memberships.user_id")}
    FROM memberships
    JOIN users ON users.id = memberships.user_id
    WHERE memberships.team_id = %s
    ORDER BY memberships.joined_at, memberships.user_id
"""


def lock_team(tx: Transaction, team_id: int) -> None:
    tx.lock(LOCK_CLASS_TEAM, key32("team", team_id))


def require_team(caller: Caller, code: str = "not_in_team", status: int = 409) -> int:
    if caller.team_id is None:
        raise ApiError(status, code)
    return caller.team_id


def captain_team(tx: Transaction, caller: Caller) -> int:
    """Captain authority: the standing and role checks for captain-only routes."""
    team_id = require_team(caller)
    lock_team(tx, team_id)
    current = tx.row(
        """
        SELECT memberships.team_id, teams.captain_id
        FROM memberships
        JOIN teams ON teams.id = memberships.team_id
        WHERE memberships.user_id = %s
        """,
        (caller.user_id,),
    )
    if current is None or current[0] != team_id:
        raise ApiError(409, "not_in_team")
    if current[1] != caller.user_id:
        raise ApiError(403, "not_captain")
    return team_id


def _draw_invite_code(tx: Transaction, previous: str | None = None) -> str:
    """A fresh code, unique across teams and different from the previous one."""
    while True:
        code = "".join(
            secrets.choice(INVITE_CODE_ALPHABET) for _ in range(INVITE_CODE_LENGTH)
        )
        if code == previous:
            continue
        if not tx.value("SELECT 1 FROM teams WHERE invite_code = %s", (code,)):
            return code


def _rotate(tx: Transaction, team_id: int) -> str:
    """Invite code rotation, used by removal and by a new code alike."""
    previous = tx.value("SELECT invite_code FROM teams WHERE id = %s", (team_id,))
    code = _draw_invite_code(tx, previous)
    tx.execute("UPDATE teams SET invite_code = %s WHERE id = %s", (code, team_id))
    return code


def _team_payload(tx: Transaction, team_id: int) -> dict[str, Any]:
    name, invite_code, captain_id = tx.row(
        "SELECT name, invite_code, captain_id FROM teams WHERE id = %s", (team_id,)
    )
    return {
        "id": team_id,
        "name": name,
        "invite_code": invite_code,
        "captain_id": captain_id,
    }


def _succeed_captaincy(tx: Transaction, team_id: int, leaving_captain: bool) -> None:
    """Captaincy passes to the earliest-joined remaining member, or to nobody."""
    if not leaving_captain:
        return
    successor = tx.value(
        """
        SELECT user_id FROM memberships WHERE team_id = %s
        ORDER BY joined_at, user_id LIMIT 1
        """,
        (team_id,),
    )
    tx.execute("UPDATE teams SET captain_id = %s WHERE id = %s", (successor, team_id))


def create_team(
    tx: Transaction, caller: Caller, body: dict[str, Any]
) -> dict[str, Any]:
    if caller.team_id is not None:
        raise ApiError(409, "already_in_team")
    raw_name = required_text(body, "name")
    name = raw_name.strip()
    if tx.value("SELECT 1 FROM teams WHERE lower(name) = lower(%s)", (name,)):
        raise ApiError(409, "name_taken")
    problem = team_name_problem(raw_name)
    if problem:
        raise ApiError(400, "validation", {"name": problem})

    team_id = tx.value(
        """
        INSERT INTO teams (name, invite_code, captain_id)
        VALUES (%s, %s, %s)
        ON CONFLICT (lower(name)) DO NOTHING
        RETURNING id
        """,
        (name, _draw_invite_code(tx), caller.user_id),
    )
    if team_id is None:
        raise ApiError(409, "name_taken")
    _take_place(tx, caller.user_id, team_id)
    publish_team(tx, team_id)
    return {"team": _team_payload(tx, team_id)}


def _take_place(tx: Transaction, user_id: int, team_id: int) -> None:
    """One team at a time: the membership index settles simultaneous joins."""
    taken = tx.value(
        """
        INSERT INTO memberships (user_id, team_id)
        VALUES (%s, %s)
        ON CONFLICT (user_id) DO NOTHING
        RETURNING id
        """,
        (user_id, team_id),
    )
    if taken is None:
        raise ApiError(409, "already_in_team")


def join_team(tx: Transaction, caller: Caller, body: dict[str, Any]) -> dict[str, Any]:
    if caller.team_id is not None:
        raise ApiError(409, "already_in_team")
    code = required_text(body, "invite_code").strip()
    team_id = tx.value("SELECT id FROM teams WHERE invite_code = upper(%s)", (code,))
    if team_id is None:
        raise ApiError(404, "unknown_invite_code")

    lock_team(tx, team_id)
    still_current = tx.value(
        "SELECT 1 FROM teams WHERE id = %s AND invite_code = upper(%s)",
        (team_id, code),
    )
    if not still_current:
        raise ApiError(404, "unknown_invite_code")
    members = tx.value(
        "SELECT count(*) FROM memberships WHERE team_id = %s", (team_id,)
    )
    if members >= TEAM_MEMBER_CAP:
        raise ApiError(409, "team_full")

    _take_place(tx, caller.user_id, team_id)
    if tx.value("SELECT captain_id FROM teams WHERE id = %s", (team_id,)) is None:
        tx.execute(
            "UPDATE teams SET captain_id = %s WHERE id = %s", (caller.user_id, team_id)
        )
    publish_team(tx, team_id)
    return {"team": _team_payload(tx, team_id)}


def leave_team(tx: Transaction, caller: Caller) -> None:
    team_id = require_team(caller)
    lock_team(tx, team_id)
    left = tx.value(
        """
        DELETE FROM memberships WHERE user_id = %s AND team_id = %s
        RETURNING team_id
        """,
        (caller.user_id, team_id),
    )
    if left is None:
        raise ApiError(409, "not_in_team")
    was_captain = (
        tx.value("SELECT captain_id FROM teams WHERE id = %s", (team_id,))
        == caller.user_id
    )
    _succeed_captaincy(tx, team_id, was_captain)
    publish_team(tx, team_id)


def remove_member(tx: Transaction, caller: Caller, raw_user_id: str) -> None:
    team_id = captain_team(tx, caller)
    target_id = path_user_id(raw_user_id)
    member = tx.value(
        "SELECT user_id FROM memberships WHERE team_id = %s AND user_id = %s",
        (team_id, target_id),
    )
    if member is None:
        raise ApiError(404, "not_a_member")
    if target_id == caller.user_id:
        raise ApiError(409, "captain_cannot_remove_self")
    tx.execute(
        "DELETE FROM memberships WHERE team_id = %s AND user_id = %s",
        (team_id, target_id),
    )
    _rotate(tx, team_id)
    publish_team(tx, team_id)


def issue_invite_code(tx: Transaction, caller: Caller) -> dict[str, Any]:
    team_id = captain_team(tx, caller)
    code = _rotate(tx, team_id)
    publish_team(tx, team_id)
    return {"invite_code": code}


def room_payload(tx: Transaction, caller: Caller) -> dict[str, Any]:
    team_id = require_team(caller, code="not_in_team", status=404)
    members = [
        {
            "user_id": user_id,
            "display_name": display_name,
            "joined_at": joined_at,
            "is_captain": False,
            "tickets": int(member_tickets),
        }
        for user_id, display_name, joined_at, member_tickets in tx.rows(
            MEMBERS_SQL, (team_id,)
        )
    ]
    team = _team_payload(tx, team_id)
    for member in members:
        member["is_captain"] = member["user_id"] == team["captain_id"]
    return {
        "team": team,
        "members": members,
        "score": team_score(tx, team_id),
        "scenarios": states(tx, team_id, caller.user_id),
    }

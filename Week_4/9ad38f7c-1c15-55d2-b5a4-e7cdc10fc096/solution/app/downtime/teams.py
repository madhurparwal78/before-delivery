"""Teams: create, join by invite code, leave, captain removal and invite code rotation, and the team room.

Every change to one team holds that team's row lock (`SELECT … FOR UPDATE`) before membership or captaincy
is read, so joins, leaves, removals and new codes on one team take effect one at a time on any instance.
"""

import re
import secrets

import asyncpg
from starlette.responses import JSONResponse, Response

from . import scoring
from .accounts import User
from .db import DB
from .errors import NO_STORE, ApiError, validation
from .inputs import path_id, required
from .live import publish_team

TEAM_CAP = 20
CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
CODE_LENGTH = 8
TEAM_NAME = re.compile(r"[A-Za-z0-9 _-]{3,24}")


def _team(row: asyncpg.Record) -> dict[str, object]:
    return {"id": row["id"], "name": row["name"], "invite_code": row["invite_code"], "captain_id": row["captain_id"]}


def _draw_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


async def membership(conn: asyncpg.Connection, user_id: int, *, hold: bool = False) -> asyncpg.Record | None:
    """The player's current team, read from the database on every request. `hold` share-locks the membership
    and team rows until the transaction ends, so a leave or removal cannot slip in underneath."""
    return await conn.fetchrow(
        "SELECT t.id, t.name, t.invite_code, t.captain_id FROM memberships m JOIN teams t ON t.id = m.team_id "
        f"WHERE m.user_id = $1{' FOR SHARE OF m, t' if hold else ''}", user_id)


async def _lock_callers_team(conn: asyncpg.Connection, user_id: int) -> asyncpg.Record | None:
    """Lock the caller's team row, then read membership and captaincy under that lock."""
    while True:
        locked = await conn.fetchval(
            "SELECT id FROM teams WHERE id = (SELECT team_id FROM memberships WHERE user_id = $1) FOR UPDATE", user_id)
        if locked is None:
            return None
        team = await membership(conn, user_id)
        if team is not None and team["id"] == locked:
            return team


def is_captain(team: asyncpg.Record, user_id: int) -> bool:
    """Captain authority: only the team's current captain may remove members or issue a new invite code."""
    return team["captain_id"] == user_id


def _require_captain(team: asyncpg.Record, user: User) -> None:
    if not is_captain(team, user.id):
        raise ApiError(403, "not_captain")


async def _settle_captain(conn: asyncpg.Connection, team_id: int) -> None:
    """Captain succession: a captain who is no longer a member passes captaincy to the earliest-joined member;
    an emptied team has none; the first player to join an emptied team becomes captain."""
    await conn.execute(
        "UPDATE teams SET captain_id = (SELECT user_id FROM memberships WHERE team_id = $1 "
        "ORDER BY joined_at, id LIMIT 1) "
        "WHERE id = $1 AND (captain_id IS NULL OR NOT EXISTS "
        "(SELECT 1 FROM memberships WHERE team_id = $1 AND user_id = teams.captain_id))", team_id)


async def _rotate_invite_code(conn: asyncpg.Connection, team_id: int, old: str) -> str:
    """Invite code rotation: replace the team's code with a freshly drawn one that differs from the old."""
    while True:
        code = _draw_code()
        if code == old:
            continue
        try:
            async with conn.transaction():
                await conn.execute("UPDATE teams SET invite_code = $1 WHERE id = $2", code, team_id)
            return code
        except asyncpg.UniqueViolationError:
            continue


async def _refuse_if_in_team(conn: asyncpg.Connection, user_id: int) -> None:
    """Standing for create and join, decided under the caller's team row lock; a teamless caller's place is
    settled later by the unique membership per player."""
    if await _lock_callers_team(conn, user_id) is not None:
        raise ApiError(409, "already_in_team")


async def create(user: User, body: dict) -> Response:
    async with DB.transaction() as conn:
        await _refuse_if_in_team(conn, user.id)
        name = required(body, "name")["name"].strip()
        if not TEAM_NAME.fullmatch(name):
            raise validation({"name": "Team names are 3 to 24 letters, digits, spaces, hyphens or underscores"})
        while (row := await conn.fetchrow(
                "INSERT INTO teams (name, invite_code, captain_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING "
                "RETURNING id, name, invite_code, captain_id", name, _draw_code(), user.id)) is None:
            if await conn.fetchval("SELECT EXISTS (SELECT 1 FROM teams WHERE lower(name) = lower($1))", name):
                raise ApiError(409, "name_taken")
        if await conn.fetchval("INSERT INTO memberships (user_id, team_id) VALUES ($1, $2) "
                               "ON CONFLICT (user_id) DO NOTHING RETURNING id", user.id, row["id"]) is None:
            raise ApiError(409, "already_in_team")
    return JSONResponse({"team": _team(row)}, status_code=201, headers=NO_STORE)


async def join(user: User, body: dict) -> Response:
    async with DB.transaction() as conn:
        await _refuse_if_in_team(conn, user.id)
        code = required(body, "invite_code")["invite_code"].strip().upper()
        team = await conn.fetchrow("SELECT id FROM teams WHERE invite_code = $1 FOR UPDATE", code)
        if team is None:
            raise ApiError(404, "unknown_invite_code")
        if await conn.fetchval("SELECT count(*) FROM memberships WHERE team_id = $1", team["id"]) >= TEAM_CAP:
            raise ApiError(409, "team_full")
        # The unique membership per player settles a simultaneous join elsewhere.
        if await conn.fetchval("INSERT INTO memberships (user_id, team_id) VALUES ($1, $2) "
                               "ON CONFLICT (user_id) DO NOTHING RETURNING id", user.id, team["id"]) is None:
            raise ApiError(409, "already_in_team")
        await _settle_captain(conn, team["id"])
        await publish_team(conn, team["id"])
        joined = await conn.fetchrow("SELECT id, name, invite_code, captain_id FROM teams WHERE id = $1", team["id"])
    return JSONResponse({"team": _team(joined)}, headers=NO_STORE)


async def leave(user: User) -> Response:
    async with DB.transaction() as conn:
        team = await _lock_callers_team(conn, user.id)
        if team is None:
            raise ApiError(409, "not_in_team")
        await conn.execute("DELETE FROM memberships WHERE user_id = $1", user.id)
        await _settle_captain(conn, team["id"])
        await publish_team(conn, team["id"])
    return Response(status_code=204, headers=NO_STORE)


async def remove_member(user: User, raw_user_id: str) -> Response:
    async with DB.transaction() as conn:
        team = await _lock_callers_team(conn, user.id)
        if team is None:
            raise ApiError(409, "not_in_team")
        _require_captain(team, user)
        member_id = path_id(raw_user_id)
        if member_id is None or not await conn.fetchval(
                "SELECT EXISTS (SELECT 1 FROM memberships WHERE user_id = $1 AND team_id = $2)", member_id, team["id"]):
            raise ApiError(404, "not_a_member")
        if member_id == user.id:
            raise ApiError(409, "captain_cannot_remove_self")
        await conn.execute("DELETE FROM memberships WHERE user_id = $1", member_id)
        await _rotate_invite_code(conn, team["id"], team["invite_code"])
        await publish_team(conn, team["id"])
    return Response(status_code=204, headers=NO_STORE)


async def new_invite_code(user: User) -> Response:
    async with DB.transaction() as conn:
        team = await _lock_callers_team(conn, user.id)
        if team is None:
            raise ApiError(409, "not_in_team")
        _require_captain(team, user)
        code = await _rotate_invite_code(conn, team["id"], team["invite_code"])
        await publish_team(conn, team["id"])
    return JSONResponse({"invite_code": code}, headers=NO_STORE)


async def room(user: User) -> Response:
    async with DB.connection() as conn:
        team = await membership(conn, user.id)
        if team is None:
            raise ApiError(404, "not_in_team")
        members = await conn.fetch(
            "SELECT m.user_id, u.display_name, m.joined_at, p.tickets FROM memberships m "
            "JOIN users u ON u.id = m.user_id JOIN player_tickets p ON p.user_id = m.user_id "
            "WHERE m.team_id = $1 ORDER BY m.joined_at, m.id", team["id"])
        score = await scoring.team_score(conn, team["id"])
        states = await scoring.scenario_states(conn, user.id, team["id"])
    return JSONResponse({
        "team": _team(team),
        "members": [{"user_id": m["user_id"], "display_name": m["display_name"],
                     "joined_at": scoring.iso(m["joined_at"]), "is_captain": is_captain(team, m["user_id"]),
                     "tickets": m["tickets"]} for m in members],
        "score": score,
        "scenarios": states,
    }, headers=NO_STORE)


async def profile(user: User) -> Response:
    async with DB.connection() as conn:
        team = await membership(conn, user.id)
        tickets = await scoring.tickets(conn, user.id)
        completions = await conn.fetch(
            "SELECT c.scenario_slug FROM completions c JOIN scenarios s ON s.slug = c.scenario_slug "
            "WHERE c.user_id = $1 ORDER BY s.number", user.id)
        claimed = await conn.fetchval("SELECT EXISTS (SELECT 1 FROM webinar_claims WHERE user_id = $1)", user.id)
    return JSONResponse({
        "user": user.published(),
        "team": None if team is None else {"id": team["id"], "name": team["name"], "invite_code": team["invite_code"],
                                           "is_captain": is_captain(team, user.id)},
        "tickets": tickets,
        "completions": [row["scenario_slug"] for row in completions],
        "webinar_claimed": claimed,
    }, headers=NO_STORE)

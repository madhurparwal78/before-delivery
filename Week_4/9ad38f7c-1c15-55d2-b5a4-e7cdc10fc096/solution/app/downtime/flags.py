"""Flag submission with team credit, completions, the wrong-flag lock and the webinar bonus."""

import hashlib

import asyncpg
from starlette.responses import JSONResponse, Response

from . import lockout, scoring, teams
from .accounts import User
from .db import DB, serialise
from .errors import NO_STORE, ApiError
from .inputs import path_slug, required
from .live import publish_score, publish_team
from .seed import WEBINAR_FLAG_SHA256

WRONG_FLAG_LIMIT = 5
WRONG_FLAG_LOCK_SECONDS = 60


def flag_sha256(flag: str) -> str:
    """Flags compare exactly, letter case included, after trimming surrounding whitespace."""
    return hashlib.sha256(flag.strip().encode("utf-8")).hexdigest()


async def _wrong_flag_lock(conn: asyncpg.Connection, user_id: int, slug: str) -> int:
    """The wrong-flag lock: seconds left for this player on this scenario, 0 when submissions are judged."""
    failures = await conn.fetchval(
        "SELECT coalesce(array_agg(created_at ORDER BY id), '{}') FROM flag_attempts "
        "WHERE user_id = $1 AND scenario_slug = $2 AND NOT correct AND id > coalesce("
        "(SELECT max(id) FROM flag_attempts WHERE user_id = $1 AND scenario_slug = $2 AND correct), 0)",
        user_id, slug)
    now = await conn.fetchval("SELECT clock_timestamp()")
    return lockout.seconds_left(failures, now, WRONG_FLAG_LIMIT, WRONG_FLAG_LOCK_SECONDS)


async def _result(conn: asyncpg.Connection, user_id: int, team_id: int, *, correct: bool, already: bool,
                  points: int) -> JSONResponse:
    return JSONResponse({"correct": correct, "already_completed": already, "team_points_awarded": points,
                         "ticket_awarded": correct and not already,
                         "team_score": await scoring.team_score(conn, team_id),
                         "tickets": await scoring.tickets(conn, user_id)}, headers=NO_STORE)


async def submit(user: User, raw_slug: str, body: dict) -> Response:
    async with DB.transaction() as conn:
        team = await teams.membership(conn, user.id, hold=True)
        if team is None:
            raise ApiError(409, "no_team")
        flag = required(body, "flag")["flag"]
        slug = path_slug(raw_slug)
        scenario = slug and await conn.fetchrow("SELECT slug, points, flag_sha256 FROM scenarios WHERE slug = $1",
                                                slug)
        if not scenario:
            raise ApiError(404, "unknown_scenario")
        await serialise(conn, f"flag:{user.id}:{slug}")
        if left := await _wrong_flag_lock(conn, user.id, slug):
            raise ApiError(429, "too_many_attempts", headers={"Retry-After": str(left)})
        if flag_sha256(flag) != scenario["flag_sha256"]:
            await conn.execute("INSERT INTO flag_attempts (user_id, scenario_slug, correct) VALUES ($1, $2, false)",
                               user.id, slug)
            return await _result(conn, user.id, team["id"], correct=False, already=False, points=0)
        if await conn.fetchval("SELECT EXISTS (SELECT 1 FROM completions WHERE user_id = $1 AND scenario_slug = $2)",
                               user.id, slug):
            return await _result(conn, user.id, team["id"], correct=True, already=True, points=0)
        await conn.execute("INSERT INTO completions (user_id, scenario_slug, team_id) VALUES ($1, $2, $3)",
                           user.id, slug, team["id"])
        await conn.execute("INSERT INTO flag_attempts (user_id, scenario_slug, correct) VALUES ($1, $2, true)",
                           user.id, slug)
        # Team credit: only the team's first solve of a scenario stores a team solve and adds its points.
        credited = await conn.fetchval(
            "INSERT INTO team_solves (team_id, scenario_slug, user_id) VALUES ($1, $2, $3) "
            "ON CONFLICT (team_id, scenario_slug) DO NOTHING RETURNING id", team["id"], slug, user.id)
        if credited:
            await publish_score(conn, team["id"], team["name"], slug, scenario["points"],
                                await scoring.team_score(conn, team["id"]))
        await publish_team(conn, team["id"])
        return await _result(conn, user.id, team["id"], correct=True, already=False,
                             points=scenario["points"] if credited else 0)


async def claim_webinar(user: User, body: dict) -> Response:
    flag = required(body, "flag")["flag"]
    async with DB.transaction() as conn:
        if await conn.fetchval("SELECT EXISTS (SELECT 1 FROM webinar_claims WHERE user_id = $1)", user.id):
            raise ApiError(409, "already_claimed")
        if flag_sha256(flag) != WEBINAR_FLAG_SHA256:
            raise ApiError(422, "wrong_flag")
        if await conn.fetchval("INSERT INTO webinar_claims (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING "
                               "RETURNING id", user.id) is None:
            raise ApiError(409, "already_claimed")
        if team := await teams.membership(conn, user.id):
            await publish_team(conn, team["id"])
        held = await scoring.tickets(conn, user.id)
    return JSONResponse({"claimed": True, "tickets": held}, headers=NO_STORE)

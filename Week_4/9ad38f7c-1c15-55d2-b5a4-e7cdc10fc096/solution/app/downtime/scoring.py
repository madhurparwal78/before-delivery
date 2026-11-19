"""Derived values read from stored rows: team scores, tickets, scenario states, the ranking, the activity feed
and the certificate."""

import math
from dataclasses import dataclass
from datetime import UTC, datetime

import asyncpg
from starlette.responses import JSONResponse, Response

from .db import DB
from .errors import NO_STORE
from .inputs import query_flag, query_number
from .seed import SCENARIOS

DEFAULT_LIMIT = 5
LIMIT_CAP = 50
FEED_SIZE = 10
CHALLENGES_TOTAL = 5

# The ranking order: points, then the earlier time of last scoring, then the older team.
RANKED_TEAMS = """
    SELECT t.id AS team_id, t.name AS team_name, s.points, s.soc_solved, s.th_solved, s.tabletop_solved,
           s.challenges_solved,
           row_number() OVER (ORDER BY s.points DESC, s.last_scored_at ASC NULLS LAST, t.created_at ASC) AS rank
    FROM teams t JOIN team_scores s ON s.team_id = t.id
"""


def iso(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


async def team_score(conn: asyncpg.Connection, team_id: int) -> int:
    return await conn.fetchval("SELECT points FROM team_scores WHERE team_id = $1", team_id)


async def tickets(conn: asyncpg.Connection, user_id: int) -> int:
    return await conn.fetchval("SELECT tickets FROM player_tickets WHERE user_id = $1", user_id)


async def scenario_states(conn: asyncpg.Connection, user_id: int | None, team_id: int | None,
                          slug: str | None = None) -> list[dict[str, object]]:
    rows = await conn.fetch(
        "SELECT s.slug, "
        "EXISTS (SELECT 1 FROM team_solves ts WHERE ts.team_id = $2 AND ts.scenario_slug = s.slug) AS team_solved, "
        "EXISTS (SELECT 1 FROM completions c WHERE c.user_id = $1 AND c.scenario_slug = s.slug) AS solved_by_me, "
        "EXISTS (SELECT 1 FROM flag_attempts f WHERE f.user_id = $1 AND f.scenario_slug = s.slug "
        "AND NOT f.correct) AS attempted_by_me "
        "FROM scenarios s WHERE $3::text IS NULL OR s.slug = $3 ORDER BY s.number", user_id, team_id, slug)
    return [{"slug": r["slug"], "team_solved": r["team_solved"], "solved_by_me": r["solved_by_me"],
             "attempted_by_me": r["attempted_by_me"]} for r in rows]


def _entry(row: asyncpg.Record) -> dict[str, object]:
    return {
        "rank": row["rank"],
        "team_id": row["team_id"],
        "team_name": row["team_name"],
        "soc_sim": "Passed" if row["soc_solved"] else "Not passed",
        "th_sim": "Passed" if row["th_solved"] else "Not passed",
        "tabletop": "Completed" if row["tabletop_solved"] else "Not completed",
        "challenges_solved": row["challenges_solved"],
        "challenges_total": CHALLENGES_TOTAL,
        "points": row["points"],
    }


async def leaderboard(params: dict[str, list[str]]) -> Response:
    page = query_number(params, "page", 1)
    limit = min(query_number(params, "limit", DEFAULT_LIMIT), LIMIT_CAP)
    include_feed = query_flag(params, "include_feed")
    async with DB.connection() as conn:
        total = await conn.fetchval("SELECT count(*) FROM teams")
        offset = (page - 1) * limit
        rows = [] if offset >= total else await conn.fetch(
            f"{RANKED_TEAMS} ORDER BY rank LIMIT $1 OFFSET $2", limit, offset)
        feed = None
        if include_feed:
            feed = [{"team_name": r["team_name"], "scenario_title": r["title"], "points": r["points"],
                     "created_at": iso(r["created_at"])} for r in await conn.fetch(
                "SELECT t.name AS team_name, s.title, s.points, ts.created_at FROM team_solves ts "
                "JOIN teams t ON t.id = ts.team_id JOIN scenarios s ON s.slug = ts.scenario_slug "
                "ORDER BY ts.created_at DESC, t.name ASC LIMIT $1", FEED_SIZE)]
        now = await conn.fetchval("SELECT clock_timestamp()")
    return JSONResponse({"entries": [_entry(r) for r in rows], "total": total, "page": page, "limit": limit,
                         "pages": math.ceil(total / limit), "server_time": iso(now), "feed": feed},
                        headers=NO_STORE)


@dataclass(frozen=True, slots=True)
class Certificate:
    display_name: str
    team_name: str
    issued_on: datetime


async def certificate_for(conn: asyncpg.Connection, user_id: int) -> Certificate | None:
    """A current member of a team that solved every scenario; issued at the team solve that completed it."""
    row = await conn.fetchrow(
        "SELECT u.display_name, t.name, s.last_scored_at FROM memberships m JOIN users u ON u.id = m.user_id "
        "JOIN teams t ON t.id = m.team_id JOIN team_scores s ON s.team_id = t.id "
        "WHERE m.user_id = $1 AND s.solved = $2", user_id, len(SCENARIOS))
    return Certificate(row["display_name"], row["name"], row["last_scored_at"]) if row else None

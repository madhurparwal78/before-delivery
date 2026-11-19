"""The leaderboard ranking, its pages and the activity feed."""

from __future__ import annotations

import math
from typing import Any

from .config import FEED_LENGTH
from .db import Transaction
from .seed_data import CHALLENGE_TOTAL
from .times import as_iso

RANKING_SQL = """
    SELECT teams.id, teams.name,
        COALESCE(sum(scenarios.points), 0) AS points,
        count(*) FILTER (WHERE scenarios.kind = 'soc-sim') AS soc_sim,
        count(*) FILTER (WHERE scenarios.kind = 'th-sim') AS th_sim,
        count(*) FILTER (WHERE scenarios.kind = 'tabletop') AS tabletop,
        count(*) FILTER (WHERE scenarios.kind = 'challenge') AS challenges,
        max(team_solves.created_at) AS last_scoring_at
    FROM teams
    LEFT JOIN team_solves ON team_solves.team_id = teams.id
    LEFT JOIN scenarios ON scenarios.slug = team_solves.scenario_slug
    GROUP BY teams.id, teams.name, teams.created_at
    ORDER BY points DESC, last_scoring_at ASC NULLS LAST, teams.created_at ASC,
             teams.id ASC
    LIMIT %s OFFSET %s
"""

FEED_SQL = """
    SELECT teams.name, scenarios.title, scenarios.points, team_solves.created_at
    FROM team_solves
    JOIN teams ON teams.id = team_solves.team_id
    JOIN scenarios ON scenarios.slug = team_solves.scenario_slug
    ORDER BY team_solves.created_at DESC, teams.name ASC
    LIMIT %s
"""


def _entry(rank: int, row: list[Any]) -> dict[str, Any]:
    team_id, name, points, soc_sim, th_sim, tabletop, challenges, _ = row
    return {
        "rank": rank,
        "team_id": team_id,
        "team_name": name,
        "soc_sim": "Passed" if soc_sim else "Not passed",
        "th_sim": "Passed" if th_sim else "Not passed",
        "tabletop": "Completed" if tabletop else "Not completed",
        "challenges_solved": int(challenges),
        "challenges_total": CHALLENGE_TOTAL,
        "points": int(points),
    }


def page(
    tx: Transaction, page_number: int, limit: int, include_feed: bool
) -> dict[str, Any]:
    total = int(tx.value("SELECT count(*) FROM teams") or 0)
    offset = (page_number - 1) * limit
    rows = tx.rows(RANKING_SQL, (limit, offset))
    return {
        "entries": [_entry(offset + index, row) for index, row in enumerate(rows, 1)],
        "total": total,
        "page": page_number,
        "limit": limit,
        "pages": math.ceil(total / limit),
        "server_time": as_iso(tx.now()),
        "feed": feed(tx) if include_feed else None,
    }


def feed(tx: Transaction) -> list[dict[str, Any]]:
    return [
        {
            "team_name": team_name,
            "scenario_title": scenario_title,
            "points": int(points),
            "created_at": as_iso(created_at),
        }
        for team_name, scenario_title, points, created_at in tx.rows(
            FEED_SQL, (FEED_LENGTH,)
        )
    ]

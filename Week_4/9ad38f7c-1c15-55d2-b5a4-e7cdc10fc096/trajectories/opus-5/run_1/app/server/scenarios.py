"""Scenario reads. No endpoint ever returns a flag."""

from __future__ import annotations

from typing import Any

from .db import Transaction
from .errors import ApiError
from .validation import path_slug

SCENARIO_FIELDS = "slug, number, title, kind, points, description"

STATES_SQL = """
    SELECT scenarios.slug,
        EXISTS (
            SELECT 1 FROM team_solves
            WHERE team_solves.team_id = %s
              AND team_solves.scenario_slug = scenarios.slug
        ),
        EXISTS (
            SELECT 1 FROM completions
            WHERE completions.user_id = %s
              AND completions.scenario_slug = scenarios.slug
        ),
        EXISTS (
            SELECT 1 FROM flag_attempts
            WHERE flag_attempts.user_id = %s
              AND flag_attempts.scenario_slug = scenarios.slug
              AND NOT flag_attempts.correct
        )
    FROM scenarios
    ORDER BY scenarios.number
"""


def _scenario_payload(row: list[Any]) -> dict[str, Any]:
    slug, number, title, kind, points, description = row
    return {
        "slug": slug,
        "number": number,
        "title": title,
        "kind": kind,
        "points": points,
        "description": description,
    }


def list_scenarios(tx: Transaction) -> list[dict[str, Any]]:
    rows = tx.rows(f"SELECT {SCENARIO_FIELDS} FROM scenarios ORDER BY number")
    return [_scenario_payload(row) for row in rows]


def load_scenario(tx: Transaction, raw_slug: str) -> dict[str, Any]:
    slug = path_slug(raw_slug)
    row = tx.row(f"SELECT {SCENARIO_FIELDS} FROM scenarios WHERE slug = %s", (slug,))
    if row is None:
        raise ApiError(404, "unknown_scenario")
    return _scenario_payload(row)


def states(
    tx: Transaction, team_id: int | None, user_id: int | None
) -> list[dict[str, Any]]:
    """The eight scenario states for one player, in number order."""
    rows = tx.rows(STATES_SQL, (team_id or 0, user_id or 0, user_id or 0))
    return [
        {
            "slug": slug,
            "team_solved": bool(team_solved),
            "solved_by_me": bool(solved_by_me),
            "attempted_by_me": bool(attempted_by_me),
        }
        for slug, team_solved, solved_by_me, attempted_by_me in rows
    ]


def state_for(
    tx: Transaction, slug: str, team_id: int | None, user_id: int | None
) -> dict[str, bool]:
    found = next(
        state for state in states(tx, team_id, user_id) if state["slug"] == slug
    )
    return {
        "team_solved": found["team_solved"],
        "solved_by_me": found["solved_by_me"],
        "attempted_by_me": found["attempted_by_me"],
    }

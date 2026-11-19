"""Derived values: a team's score and a player's raffle tickets.

None of these is a stored counter; each is computed from stored team solves,
completions and webinar claims wherever it is read.
"""

from __future__ import annotations

from .config import WEBINAR_TICKETS
from .db import Transaction

TEAM_POINTS_SQL = """
    SELECT COALESCE(sum(scenarios.points), 0)
    FROM team_solves
    JOIN scenarios ON scenarios.slug = team_solves.scenario_slug
    WHERE team_solves.team_id = %s
"""


def tickets_expression(user_column: str) -> str:
    """SQL for a player's tickets: one per completion, plus the webinar bonus."""
    return f"""(
        (SELECT count(*) FROM completions WHERE completions.user_id = {user_column})
        + CASE WHEN EXISTS (
            SELECT 1 FROM webinar_claims WHERE webinar_claims.user_id = {user_column}
          ) THEN {WEBINAR_TICKETS} ELSE 0 END
    )"""


def team_score(tx: Transaction, team_id: int | None) -> int:
    if team_id is None:
        return 0
    return int(tx.value(TEAM_POINTS_SQL, (team_id,)) or 0)


def tickets(tx: Transaction, user_id: int) -> int:
    return int(
        tx.value(
            f"SELECT {tickets_expression('%s')}",
            (user_id, user_id),
        )
        or 0
    )

"""Segment efforts and the leaderboard: the one place that ranks."""

from .gpx import half_up
from .visibility import followees_of

FREE_ROWS = 10
VISIBLE_EFFORT = "a.visibility <> 'only_me'"

BOARD_SQL = f"""
WITH best AS (
    SELECT DISTINCT ON (e.athlete_id) e.athlete_id, e.elapsed_time_s, e.activity_id, e.start_time
    FROM segment_efforts e JOIN activities a ON a.id = e.activity_id
    WHERE e.segment_id = $1 AND {VISIBLE_EFFORT}
      AND (NOT $3 OR e.athlete_id = $2 OR e.athlete_id IN ({followees_of('$2')}))
    ORDER BY e.athlete_id, e.elapsed_time_s, e.start_time
)
SELECT row_number() OVER (ORDER BY b.elapsed_time_s, b.start_time, b.activity_id) AS rank,
       b.athlete_id, n.name AS athlete_name, b.elapsed_time_s, b.activity_id, b.start_time
FROM best b JOIN athletes n ON n.id = b.athlete_id
ORDER BY rank
"""


async def ranked_entries(conn, segment_id: int, viewer_id: int, following_only: bool) -> list[dict]:
    """Each athlete's fastest visible effort, fastest first with ties to the earlier start, ranked from 1."""
    rows = await conn.fetch(BOARD_SQL, segment_id, viewer_id, following_only)
    return [dict(row) for row in rows]


async def record_effort(conn, segment_id: int, activity_id: int, athlete_id: int, visibility: str,
                        started_at, ended_at) -> None:
    """Store an effort with the personal-record rank and crown it earns at this moment.

    The rank and crown are decided here, from the efforts already stored, and never recomputed on read.
    """
    await conn.execute("SELECT pg_advisory_xact_lock($1)", segment_id)
    elapsed = half_up((ended_at - started_at).total_seconds())
    faster_own = await conn.fetchval(
        "SELECT count(*) FROM segment_efforts WHERE segment_id = $1 AND athlete_id = $2"
        " AND (elapsed_time_s, start_time) < ($3, $4)", segment_id, athlete_id, elapsed, started_at)
    pr_rank = faster_own + 1 if faster_own < 3 else None
    crown = visibility != "only_me" and not await conn.fetchval(
        "SELECT EXISTS (SELECT 1 FROM segment_efforts e JOIN activities a ON a.id = e.activity_id"
        f" WHERE e.segment_id = $1 AND {VISIBLE_EFFORT} AND (e.elapsed_time_s, e.start_time) <= ($2, $3))",
        segment_id, elapsed, started_at)
    await conn.execute(
        "INSERT INTO segment_efforts (segment_id, activity_id, athlete_id, elapsed_time_s, start_time, pr_rank, is_crown)"
        " VALUES ($1, $2, $3, $4, $5, $6, $7)", segment_id, activity_id, athlete_id, elapsed, started_at, pr_rank, crown)

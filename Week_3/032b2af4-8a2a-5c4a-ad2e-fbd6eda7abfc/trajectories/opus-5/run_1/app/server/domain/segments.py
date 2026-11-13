"""The one home of segment matching, personal records and crowns."""
from .geo import haversine_m
from .leaderboard import rank_efforts
from .parsing import TrackPoint, round_half_up

MATCH_RADIUS_M = 25.0


def find_effort(points: list[TrackPoint], segment: dict) -> tuple | None:
    """The first point within reach of the start, then the first later point within reach of the end."""
    start_index = None
    for index, point in enumerate(points):
        if haversine_m(point.lat, point.lon, segment["start_lat"], segment["start_lon"]) <= MATCH_RADIUS_M:
            start_index = index
            break
    if start_index is None:
        return None
    for index in range(start_index + 1, len(points)):
        point = points[index]
        if haversine_m(point.lat, point.lon, segment["end_lat"], segment["end_lon"]) <= MATCH_RADIUS_M:
            began = points[start_index].time
            return began, round_half_up((point.time - began).total_seconds())
    return None


def _personal_record_rank(cursor, segment_id: int, athlete_id: int, elapsed: int, began) -> int | None:
    cursor.execute(
        "SELECT elapsed_time_s, start_time FROM segment_efforts WHERE segment_id = %s AND athlete_id = %s",
        (segment_id, athlete_id),
    )
    faster = sum(
        1 for row in cursor.fetchall() if (row["elapsed_time_s"], row["start_time"]) < (elapsed, began)
    )
    rank = faster + 1
    return rank if rank <= 3 else None


def _earns_crown(cursor, segment_id: int, athlete_id: int, elapsed: int, began) -> bool:
    cursor.execute(
        """
        SELECT e.athlete_id, e.elapsed_time_s, e.start_time, e.activity_id, ath.name AS athlete_name
        FROM segment_efforts e
        JOIN activities a ON a.id = e.activity_id
        JOIN athletes ath ON ath.id = e.athlete_id
        WHERE e.segment_id = %s AND a.visibility <> 'only_me'
        """,
        (segment_id,),
    )
    candidate = {
        "athlete_id": athlete_id,
        "elapsed_time_s": elapsed,
        "start_time": began,
        "activity_id": None,
        "athlete_name": "",
    }
    board = rank_efforts(cursor.fetchall() + [candidate])
    leader = board[0]
    return leader["athlete_id"] == athlete_id and leader["elapsed_time_s"] == elapsed


def record_effort(cursor, segment: dict, activity: dict, points: list[TrackPoint]) -> None:
    match = find_effort(points, segment)
    if match is None:
        return
    began, elapsed = match
    athlete_id = activity["athlete_id"]
    pr_rank = _personal_record_rank(cursor, segment["id"], athlete_id, elapsed, began)
    is_crown = activity["visibility"] != "only_me" and _earns_crown(
        cursor, segment["id"], athlete_id, elapsed, began
    )
    cursor.execute(
        """
        INSERT INTO segment_efforts
            (segment_id, activity_id, athlete_id, elapsed_time_s, start_time, pr_rank, is_crown)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT ON CONSTRAINT segment_efforts_activity_key DO NOTHING
        """,
        (segment["id"], activity["id"], athlete_id, elapsed, began, pr_rank, is_crown),
    )

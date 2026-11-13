"""Segments, their efforts and their leaderboards."""
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from .. import auth, db
from ..domain.leaderboard import PUBLIC_LEADERBOARD_DEPTH, rank_efforts
from ..domain.parsing import cumulative_distances, round_half_up
from ..domain.segments import record_effort
from ..errors import forbidden, not_found, validation
from .activities import load_activity, load_points
from .common import iso, parse_id, read_json

router = APIRouter()


def segment_json(row: dict) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "start_lat": row["start_lat"],
        "start_lon": row["start_lon"],
        "end_lat": row["end_lat"],
        "end_lon": row["end_lon"],
        "distance_m": row["distance_m"],
        "elevation_diff_m": row["elevation_diff_m"],
    }


@router.post("/segments")
async def create_segment(request: Request, athlete: dict = Depends(auth.require_athlete)):
    body = await read_json(request)
    fields: dict = {}
    name = body.get("name")
    if not isinstance(name, str) or not 3 <= len(name.strip()) <= 60:
        fields["name"] = "must be 3 to 60 characters"
    activity_id = body.get("activity_id")
    if not isinstance(activity_id, int):
        fields["activity_id"] = "must be an activity id"
    start_index, end_index = body.get("start_index"), body.get("end_index")
    if not isinstance(start_index, int) or not isinstance(end_index, int):
        fields["start_index"] = "must be a whole number"
    if fields:
        raise validation(fields)
    with db.cursor() as cursor:
        activity = load_activity(cursor, activity_id, athlete["id"])
        if activity["athlete_id"] != athlete["id"]:
            raise forbidden()
        points = load_points(cursor, activity["id"])
        if not 0 <= start_index < end_index < len(points):
            raise validation(
                {"start_index": "must be 0 or more and before end_index, inside the activity's points"}
            )
        running = cumulative_distances(points)
        begin, finish = points[start_index], points[end_index]
        cursor.execute(
            """
            INSERT INTO segments (name, start_lat, start_lon, end_lat, end_lon,
                                  distance_m, elevation_diff_m, created_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *
            """,
            (
                name.strip(),
                begin.lat,
                begin.lon,
                finish.lat,
                finish.lon,
                round_half_up(running[end_index] - running[start_index]),
                round_half_up(finish.ele - begin.ele),
                athlete["id"],
            ),
        )
        segment = cursor.fetchone()
        cursor.execute("SELECT id, athlete_id, visibility FROM activities ORDER BY start_time, id")
        for existing in cursor.fetchall():
            record_effort(cursor, segment, existing, load_points(cursor, existing["id"]))
        return JSONResponse(segment_json(segment), status_code=201)


@router.get("/segments")
def search_segments(request: Request, athlete: dict = Depends(auth.require_athlete)):
    query = request.query_params.get("q", "")
    with db.cursor() as cursor:
        cursor.execute(
            "SELECT * FROM segments WHERE name ILIKE %s ORDER BY name", (f"%{query}%",)
        )
        return {"segments": [segment_json(row) for row in cursor.fetchall()]}


def _load_segment(cursor, segment_id: int) -> dict:
    cursor.execute("SELECT * FROM segments WHERE id = %s", (segment_id,))
    segment = cursor.fetchone()
    if segment is None:
        raise not_found()
    return segment


@router.get("/segments/{segment_id}")
def read_segment(segment_id: str, athlete: dict = Depends(auth.require_athlete)):
    with db.cursor() as cursor:
        segment = _load_segment(cursor, parse_id(segment_id))
        cursor.execute(
            """
            SELECT count(*) AS efforts, count(DISTINCT e.athlete_id) AS athletes
            FROM segment_efforts e JOIN activities a ON a.id = e.activity_id
            WHERE e.segment_id = %s AND a.visibility <> 'only_me'
            """,
            (segment["id"],),
        )
        counts = cursor.fetchone()
        return segment_json(segment) | {
            "effort_count": counts["efforts"],
            "athlete_count": counts["athletes"],
        }


@router.patch("/segments/{segment_id}")
async def rename_segment(segment_id: str, request: Request, athlete: dict = Depends(auth.require_athlete)):
    body = await read_json(request)
    name = body.get("name")
    if not isinstance(name, str) or not 3 <= len(name.strip()) <= 60:
        raise validation({"name": "must be 3 to 60 characters"})
    with db.cursor() as cursor:
        segment = _load_segment(cursor, parse_id(segment_id))
        if segment["created_by"] != athlete["id"]:
            raise forbidden()
        cursor.execute(
            "UPDATE segments SET name = %s WHERE id = %s RETURNING *", (name.strip(), segment["id"])
        )
        return segment_json(cursor.fetchone())


@router.get("/segments/{segment_id}/leaderboard")
def segment_leaderboard(segment_id: str, request: Request, athlete: dict = Depends(auth.require_athlete)):
    board_filter = request.query_params.get("filter", "overall")
    if board_filter not in ("overall", "following"):
        raise validation({"filter": "must be overall or following"})
    with db.cursor() as cursor:
        segment = _load_segment(cursor, parse_id(segment_id))
        cursor.execute(
            """
            SELECT e.athlete_id, ath.name AS athlete_name, e.elapsed_time_s,
                   e.activity_id, e.start_time
            FROM segment_efforts e
            JOIN activities a ON a.id = e.activity_id
            JOIN athletes ath ON ath.id = e.athlete_id
            WHERE e.segment_id = %s AND a.visibility <> 'only_me'
            """,
            (segment["id"],),
        )
        efforts = cursor.fetchall()
        if board_filter == "following":
            cursor.execute(
                "SELECT followee_id FROM follows WHERE follower_id = %s AND status = 'accepted'",
                (athlete["id"],),
            )
            allowed = {row["followee_id"] for row in cursor.fetchall()} | {athlete["id"]}
            efforts = [effort for effort in efforts if effort["athlete_id"] in allowed]
        entries = rank_efforts(efforts)
    for entry in entries:
        entry["start_time"] = iso(entry["start_time"])
    viewer_entry = next((entry for entry in entries if entry["athlete_id"] == athlete["id"]), None)
    shown = entries if athlete["subscriber"] else entries[:PUBLIC_LEADERBOARD_DEPTH]
    return {"entries": shown, "entry_count": len(entries), "viewer_entry": viewer_entry}

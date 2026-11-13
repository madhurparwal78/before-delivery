"""Segments, matching and leaderboards."""

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from .. import db
from ..activity_view import owner_of_visible
from ..errors import forbidden, not_found, validation
from ..gpx import TrackPoint, running_distances
from ..http import authenticated, iso, parse_id, read_json, text_field
from ..leaderboard import FREE_ROWS, VISIBLE_EFFORT, ranked_entries
from ..security import is_subscriber
from ..recording import insert_segment, match_existing_activities

SEGMENT_COLUMNS = ("id, name, start_lat, start_lon, end_lat, end_lon, distance_m, elevation_diff_m, creator_id")
COUNTS_SQL = f"""
SELECT count(*) AS effort_count, count(DISTINCT e.athlete_id) AS athlete_count
FROM segment_efforts e JOIN activities a ON a.id = e.activity_id
WHERE e.segment_id = $1 AND {VISIBLE_EFFORT}
"""
LIST_LIMIT = 200


def segment_json(row, counts=None) -> dict:
    body = {key: row[key] for key in ("id", "name", "start_lat", "start_lon", "end_lat", "end_lon", "distance_m",
                                      "elevation_diff_m", "creator_id")}
    if "sport_types" in row.keys():
        body["sport_types"] = sorted(row["sport_types"])
    if counts is not None:
        body.update(effort_count=counts["effort_count"], athlete_count=counts["athlete_count"])
    return body


async def _segment_or_404(request: Request):
    row = await db.pool.fetchrow(f"SELECT {SEGMENT_COLUMNS} FROM segments WHERE id = $1",
                                 parse_id(request.path_params["segment_id"]))
    if row is None:
        raise not_found()
    return row


def _index(body: dict, name: str, fields: dict) -> int | None:
    value = body.get(name)
    if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
        return value
    fields[name] = f"{name} must be a whole number of 0 or more"
    return None


@authenticated
async def create_segment(request: Request, me: dict) -> JSONResponse:
    body = await read_json(request)
    fields: dict[str, str] = {}
    name = text_field(body, "name", 3, 60, fields)
    start, end = _index(body, "start_index", fields), _index(body, "end_index", fields)
    activity_id = body.get("activity_id")
    if not isinstance(activity_id, (int, str)) or isinstance(activity_id, bool):
        fields["activity_id"] = "activity_id must name one of your activities"
    if fields:
        raise validation(fields)
    owner = await owner_of_visible(db.pool, parse_id(str(activity_id)), me["id"])
    if owner is None:
        raise not_found()
    if owner != me["id"]:
        raise forbidden()
    activity_id = int(activity_id)
    async with db.pool.acquire() as conn, conn.transaction():
        rows = await conn.fetch("SELECT lat, lon, ele, time FROM activity_points WHERE activity_id = $1 ORDER BY idx",
                                activity_id)
        if not start < end < len(rows):
            raise validation({"end_index": "indexes must satisfy 0 <= start_index < end_index < the number of points"})
        points = [TrackPoint(r["lat"], r["lon"], r["ele"], r["time"]) for r in rows]
        segment = await insert_segment(conn, name, me["id"], points, running_distances(points), start, end)
        await match_existing_activities(conn, segment)
    return JSONResponse(segment_json(segment), status_code=201)


def _like_pattern(text: str) -> str:
    return "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


@authenticated
async def list_segments(request: Request, me: dict) -> JSONResponse:
    query = request.query_params.get("q", "")
    rows = await db.pool.fetch(
        f"SELECT {SEGMENT_COLUMNS}, COALESCE((SELECT array_agg(DISTINCT a.sport_type) FROM segment_efforts e"
        f" JOIN activities a ON a.id = e.activity_id WHERE e.segment_id = segments.id AND {VISIBLE_EFFORT}),"
        f" '{{}}') AS sport_types FROM segments WHERE name ILIKE $1 ESCAPE '\\' ORDER BY name, id LIMIT {LIST_LIMIT}",
        _like_pattern(query))
    return JSONResponse({"segments": [segment_json(r) for r in rows]})


@authenticated
async def read_segment(request: Request, me: dict) -> JSONResponse:
    row = await _segment_or_404(request)
    return JSONResponse(segment_json(row, await db.pool.fetchrow(COUNTS_SQL, row["id"])))


@authenticated
async def rename_segment(request: Request, me: dict) -> JSONResponse:
    row = await _segment_or_404(request)
    if row["creator_id"] != me["id"]:
        raise forbidden()
    fields: dict[str, str] = {}
    name = text_field(await read_json(request), "name", 3, 60, fields)
    if fields:
        raise validation(fields)
    await db.pool.execute("UPDATE segments SET name = $2 WHERE id = $1", row["id"], name)
    return JSONResponse(segment_json({**row, "name": name}, await db.pool.fetchrow(COUNTS_SQL, row["id"])))


@authenticated
async def read_leaderboard(request: Request, me: dict) -> JSONResponse:
    row = await _segment_or_404(request)
    chosen = request.query_params.get("filter", "overall")
    if chosen not in ("overall", "following"):
        raise validation({"filter": "filter must be overall or following"})
    ranked = await ranked_entries(db.pool, row["id"], me["id"], chosen == "following")
    entries = [{"rank": e["rank"], "athlete_id": e["athlete_id"], "athlete_name": e["athlete_name"],
                "elapsed_time_s": e["elapsed_time_s"], "activity_id": e["activity_id"],
                "start_time": iso(e["start_time"])} for e in ranked]
    mine = next((e for e in entries if e["athlete_id"] == me["id"]), None)
    shown = entries if is_subscriber(me["plan"]) else entries[:FREE_ROWS]
    return JSONResponse({"entries": shown, "entry_count": len(entries), "viewer_entry": mine})


routes = [
    Route("/api/segments", create_segment, methods=["POST"]),
    Route("/api/segments", list_segments, methods=["GET"]),
    Route("/api/segments/{segment_id}", read_segment, methods=["GET"]),
    Route("/api/segments/{segment_id}", rename_segment, methods=["PATCH"]),
    Route("/api/segments/{segment_id}/leaderboard", read_leaderboard, methods=["GET"]),
]

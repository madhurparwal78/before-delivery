"""Weekly stats and the year recap, both taken in the athlete's time zone."""

from datetime import timedelta
from zoneinfo import ZoneInfo

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from .. import db
from ..calendar import current_year, local_midnight, week_starts, year_window
from ..errors import not_found, validation
from ..http import authenticated, parse_id
from ..visibility import visible_to

DEFAULT_WEEKS, MAX_WEEKS = 12, 52
YEAR_RANGE = (1970, 2200)


def _weeks_param(request: Request) -> int:
    raw = request.query_params.get("weeks", str(DEFAULT_WEEKS))
    if not raw.isdecimal() or not 1 <= int(raw) <= MAX_WEEKS:
        raise validation({"weeks": f"weeks must be a whole number from 1 to {MAX_WEEKS}"})
    return int(raw)


@authenticated
async def weekly_stats(request: Request, me: dict) -> JSONResponse:
    """Zero-filled weeks for an athlete (or `me`), counting only the activities the viewer may see."""
    raw = request.path_params["athlete_id"]
    athlete_id = me["id"] if raw == "me" else parse_id(raw)
    weeks = _weeks_param(request)
    zone_name = await db.pool.fetchval("SELECT time_zone FROM athletes WHERE id = $1", athlete_id)
    if zone_name is None:
        raise not_found()
    zone = ZoneInfo(zone_name)
    mondays = week_starts(zone_name, weeks)
    first_start = local_midnight(mondays[0], zone)
    year_start = year_window(zone_name, current_year(zone_name))[0]
    rows = await db.pool.fetch(
        "SELECT a.start_time, a.distance_m, a.moving_time_s, a.elevation_gain_m FROM activities a"
        " JOIN athletes o ON o.id = a.athlete_id"
        f" WHERE a.athlete_id = $2 AND a.start_time >= $3 AND {visible_to('$1')}",
        me["id"], athlete_id, min(first_start, year_start))
    buckets = {m: {"week_start": m.isoformat(), "distance_m": 0, "moving_time_s": 0, "elevation_gain_m": 0,
                   "activity_count": 0} for m in mondays}
    year = {"distance_m": 0, "activity_count": 0}
    for r in rows:
        local = r["start_time"].astimezone(zone).date()
        monday = local - timedelta(days=local.weekday())
        if monday in buckets:
            bucket = buckets[monday]
            bucket["distance_m"] += r["distance_m"]
            bucket["moving_time_s"] += r["moving_time_s"]
            bucket["elevation_gain_m"] += r["elevation_gain_m"]
            bucket["activity_count"] += 1
        if r["start_time"] >= year_start:
            year["distance_m"] += r["distance_m"]
            year["activity_count"] += 1
    return JSONResponse({"weeks": list(buckets.values()), "year_to_date": year})


@authenticated
async def recap(request: Request, me: dict) -> JSONResponse:
    raw = request.query_params.get("year")
    if raw is None:
        year = current_year(me["time_zone"])
    elif raw.isdecimal() and YEAR_RANGE[0] <= int(raw) <= YEAR_RANGE[1]:
        year = int(raw)
    else:
        raise validation({"year": "year must be a four-digit year"})
    start, end = year_window(me["time_zone"], year)
    rows = await db.pool.fetch(
        "SELECT a.id, a.sport_type, a.distance_m, a.moving_time_s, a.elevation_gain_m,"
        " (SELECT count(*) FROM kudos k WHERE k.activity_id = a.id) AS kudos"
        " FROM activities a WHERE a.athlete_id = $1 AND a.start_time >= $2 AND a.start_time < $3",
        me["id"], start, end)
    by_sport: dict[str, list[int]] = {}
    for r in rows:
        count_and_distance = by_sport.setdefault(r["sport_type"], [0, 0])
        count_and_distance[0] += 1
        count_and_distance[1] += r["distance_m"]
    longest = max(rows, key=lambda r: (r["distance_m"], -r["id"]), default=None)
    return JSONResponse({
        "year": year, "activity_count": len(rows), "distance_m": sum(r["distance_m"] for r in rows),
        "moving_time_s": sum(r["moving_time_s"] for r in rows),
        "elevation_gain_m": sum(r["elevation_gain_m"] for r in rows),
        "longest_activity_id": None if longest is None else longest["id"],
        "top_sport": max(by_sport, key=lambda s: tuple(by_sport[s]), default=None),
        "kudos_received": sum(r["kudos"] for r in rows)})


routes = [
    Route("/api/athletes/me/recap", recap, methods=["GET"]),
    Route("/api/athletes/{athlete_id}/stats", weekly_stats, methods=["GET"]),
]

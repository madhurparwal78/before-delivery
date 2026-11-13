"""Reading activities: the shared query, the JSON shape, route previews and privacy-zone trimming."""

from . import geo
from .http import iso
from .visibility import visible_to

ACTIVITY_SELECT = """
SELECT a.id, a.athlete_id, o.name AS athlete_name, a.name, a.sport_type, a.visibility, a.start_time,
       a.distance_m, a.moving_time_s, a.elapsed_time_s, a.elevation_gain_m, a.avg_pace_s_per_km, a.avg_speed_kmh,
       a.splits, a.best_efforts, a.point_count,
       (SELECT count(*) FROM kudos k WHERE k.activity_id = a.id) AS kudos_count,
       (SELECT count(*) FROM comments c WHERE c.activity_id = a.id) AS comment_count,
       EXISTS (SELECT 1 FROM kudos k WHERE k.activity_id = a.id AND k.athlete_id = $1) AS kudos_given
FROM activities a JOIN athletes o ON o.id = a.athlete_id
"""
ROUTE_POINTS = 60


async def find_visible(conn, activity_id: int, viewer_id: int):
    """The activity row when the viewer may see it, otherwise None."""
    return await conn.fetchrow(f"{ACTIVITY_SELECT} WHERE a.id = $2 AND {visible_to('$1')}", viewer_id, activity_id)


async def owner_of_visible(conn, activity_id: int, viewer_id: int) -> int | None:
    """The owner's id when the viewer may see the activity, otherwise None."""
    return await conn.fetchval(
        "SELECT a.athlete_id FROM activities a JOIN athletes o ON o.id = a.athlete_id"
        f" WHERE a.id = $2 AND {visible_to('$1')}", viewer_id, activity_id)


async def zones_of(conn, athlete_ids: list[int]) -> dict[int, dict]:
    rows = await conn.fetch("SELECT athlete_id, lat, lon, radius_m FROM privacy_zones WHERE athlete_id = ANY($1)",
                            athlete_ids)
    return {r["athlete_id"]: {"lat": r["lat"], "lon": r["lon"], "radius_m": r["radius_m"]} for r in rows}


def outside_zone(lat: float, lon: float, zone: dict | None) -> bool:
    return zone is None or not geo.inside_zone(lat, lon, zone)


def efforts_json(rows) -> list[dict]:
    return [{"segment_id": r["segment_id"], "segment_name": r["segment_name"], "elapsed_time_s": r["elapsed_time_s"],
             "pr_rank": r["pr_rank"], "is_crown": r["is_crown"]} for r in rows]


async def to_json(conn, rows, viewer_id: int, with_route: bool = False) -> list[dict]:
    """Activity objects for activity rows, with their segment efforts and, for listings, a route preview."""
    ids = [r["id"] for r in rows]
    efforts: dict[int, list] = {i: [] for i in ids}
    for r in await conn.fetch(
            "SELECT e.activity_id, e.segment_id, s.name AS segment_name, e.elapsed_time_s, e.pr_rank, e.is_crown"
            " FROM segment_efforts e JOIN segments s ON s.id = e.segment_id WHERE e.activity_id = ANY($1) ORDER BY e.id",
            ids):
        efforts[r["activity_id"]].append(r)
    routes: dict[int, list] = {i: [] for i in ids}
    if with_route:
        zones = await zones_of(conn, list({r["athlete_id"] for r in rows if r["athlete_id"] != viewer_id}))
        owners = {r["id"]: r["athlete_id"] for r in rows}
        for p in await conn.fetch(
                "SELECT p.activity_id, p.lat, p.lon FROM activity_points p JOIN activities a ON a.id = p.activity_id"
                " WHERE p.activity_id = ANY($1) AND (p.idx % GREATEST(1, a.point_count / $2) = 0"
                " OR p.idx = a.point_count - 1) ORDER BY p.activity_id, p.idx", ids, ROUTE_POINTS):
            zone = None if owners[p["activity_id"]] == viewer_id else zones.get(owners[p["activity_id"]])
            if outside_zone(p["lat"], p["lon"], zone):
                routes[p["activity_id"]].append([p["lat"], p["lon"]])
    out = []
    for r in rows:
        item = {
            "id": r["id"], "athlete_id": r["athlete_id"], "athlete_name": r["athlete_name"], "name": r["name"],
            "sport_type": r["sport_type"], "visibility": r["visibility"], "start_time": iso(r["start_time"]),
            "distance_m": r["distance_m"], "moving_time_s": r["moving_time_s"], "elapsed_time_s": r["elapsed_time_s"],
            "elevation_gain_m": r["elevation_gain_m"], "avg_pace_s_per_km": r["avg_pace_s_per_km"],
            "avg_speed_kmh": r["avg_speed_kmh"], "kudos_count": r["kudos_count"], "comment_count": r["comment_count"],
            "kudos_given": r["kudos_given"], "splits": r["splits"], "best_efforts": r["best_efforts"],
            "segment_efforts": efforts_json(efforts[r["id"]]),
        }
        if with_route:
            item["route"] = routes[r["id"]]
        out.append(item)
    return out

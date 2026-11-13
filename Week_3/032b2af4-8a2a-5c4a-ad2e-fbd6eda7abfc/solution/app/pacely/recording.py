"""Storing a recording: the activity, its track points and the efforts it earns on every segment."""

from . import geo
from .gpx import TrackPoint, half_up
from .leaderboard import record_effort


async def store_activity(conn, athlete_id: int, name: str, sport_type: str, visibility: str,
                         points: list[TrackPoint], figures: dict) -> int | None:
    """Insert the activity and its points; None when the athlete already holds an activity starting at that time."""
    activity_id = await conn.fetchval(
        "INSERT INTO activities (athlete_id, name, sport_type, visibility, start_time, distance_m, moving_time_s,"
        " elapsed_time_s, elevation_gain_m, avg_pace_s_per_km, avg_speed_kmh, point_count, splits, best_efforts)"
        " VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)"
        " ON CONFLICT (athlete_id, start_time) DO NOTHING RETURNING id",
        athlete_id, name, sport_type, visibility, points[0].time, figures["distance_m"], figures["moving_time_s"],
        figures["elapsed_time_s"], figures["elevation_gain_m"], figures["avg_pace_s_per_km"], figures["avg_speed_kmh"],
        len(points), figures["splits"], figures["best_efforts"])
    if activity_id is None:
        return None
    await conn.copy_records_to_table(
        "activity_points", columns=["activity_id", "idx", "lat", "lon", "ele", "time", "distance_m"],
        records=[(activity_id, i, p.lat, p.lon, p.ele, p.time, figures["totals"][i]) for i, p in enumerate(points)])
    await match_segments(conn, activity_id, athlete_id, visibility, points)
    return activity_id


async def match_segments(conn, activity_id: int, athlete_id: int, visibility: str, points: list[TrackPoint]) -> None:
    """Record an effort on every segment the track passes through."""
    lat_min, lat_max, lon_min, lon_max = geo.search_box(
        min(p.lat for p in points), max(p.lat for p in points), min(p.lon for p in points), max(p.lon for p in points))
    segments = await conn.fetch(
        "SELECT id, start_lat, start_lon, end_lat, end_lon FROM segments"
        " WHERE start_lat BETWEEN $1 AND $2 AND start_lon BETWEEN $3 AND $4 ORDER BY id",
        lat_min, lat_max, lon_min, lon_max)
    for segment in segments:
        found = geo.match_effort(points, (segment["start_lat"], segment["start_lon"]),
                                 (segment["end_lat"], segment["end_lon"]))
        if found:
            first, last = found
            await record_effort(conn, segment["id"], activity_id, athlete_id, visibility,
                                points[first].time, points[last].time)


async def insert_segment(conn, name: str, creator_id: int, points: list[TrackPoint], totals: list[float],
                         start_index: int, end_index: int) -> dict:
    """A segment between two points of a track; distance and elevation difference are rounded."""
    start, end = points[start_index], points[end_index]
    row = await conn.fetchrow(
        "INSERT INTO segments (name, start_lat, start_lon, end_lat, end_lon, distance_m, elevation_diff_m, creator_id)"
        " VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *",
        name, start.lat, start.lon, end.lat, end.lon, half_up(totals[end_index] - totals[start_index]),
        half_up(end.ele - start.ele), creator_id)
    return dict(row)


async def match_existing_activities(conn, segment: dict) -> None:
    """Match every stored activity against a new segment, in start-time order."""
    lat_min, lat_max, lon_min, lon_max = geo.search_box(
        segment["start_lat"], segment["start_lat"], segment["start_lon"], segment["start_lon"])
    activities = await conn.fetch(
        "SELECT a.id, a.athlete_id, a.visibility FROM activities a WHERE a.id IN ("
        " SELECT activity_id FROM activity_points WHERE lat BETWEEN $1 AND $2 AND lon BETWEEN $3 AND $4)"
        " ORDER BY a.start_time, a.id", lat_min, lat_max, lon_min, lon_max)
    for activity in activities:
        rows = await conn.fetch("SELECT lat, lon, time FROM activity_points WHERE activity_id = $1 ORDER BY idx",
                                activity["id"])
        track = [TrackPoint(r["lat"], r["lon"], 0.0, r["time"]) for r in rows]
        found = geo.match_effort(track, (segment["start_lat"], segment["start_lon"]),
                                 (segment["end_lat"], segment["end_lon"]))
        if found:
            first, last = found
            await record_effort(conn, segment["id"], activity["id"], activity["athlete_id"], activity["visibility"],
                                track[first].time, track[last].time)

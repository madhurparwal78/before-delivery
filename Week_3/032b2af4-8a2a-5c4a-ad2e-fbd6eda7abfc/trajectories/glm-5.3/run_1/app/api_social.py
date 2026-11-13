"""Follows, feed, activities and streams: the social and recording API."""
import json
from datetime import datetime, timezone

from lib import security, store
from lib.errors import ApiError
from lib.parse import haversine_m, parse_gpx_points, ParsedTrack, round_half_up
from lib.rules import can_view, decode_cursor, feed_query_where, FEED_ORDER
from web import (json_response, require_session, str_field, iso, route)
from lib import segments as segments_lib

SPORTS = ("run", "ride", "walk", "hike")
VISIBILITIES = ("everyone", "followers", "only_me")


def activity_row(activity_id: str):
    return store.one(
        """SELECT a.*, ar.private AS owner_private, ar.name AS athlete_name
           FROM activities a JOIN athletes ar ON ar.id = a.athlete_id
           WHERE a.id = %s""",
        (activity_id,))


def activity_payload(row) -> dict:
    return {
        "id": row["id"], "athlete_id": row["athlete_id"], "athlete_name": row["athlete_name"],
        "name": row["name"], "sport_type": row["sport_type"], "visibility": row["visibility"],
        "start_time": iso(row["start_time"]), "distance_m": row["distance_m"],
        "moving_time_s": row["moving_time_s"], "elapsed_time_s": row["elapsed_time_s"],
        "elevation_gain_m": row["elevation_gain_m"], "avg_pace_s_per_km": row["avg_pace_s_per_km"],
        "avg_speed_kmh": float(row["avg_speed_kmh"]), "kudos_count": row["kudos_count"],
        "comment_count": row["comment_count"], "splits": row["splits"],
        "best_efforts": row["best_efforts"],
        "segment_efforts": segments_lib.segment_efforts_payload(row["id"]),
    }


def viewable_activity(activity_id: str, viewer_id: str, owner_only: bool = False):
    """The visibility rule applied to one activity; hidden activities answer 404 everywhere."""
    row = activity_row(activity_id)
    if not row:
        raise ApiError(404, "not_found")
    if not can_view(viewer_id, row):
        raise ApiError(404, "not_found")
    if owner_only and viewer_id != row["athlete_id"]:
        raise ApiError(403, "forbidden")
    return row


def page_params(query: dict) -> tuple[int, str | None]:
    limit_raw = query.get("limit", ["20"])[0]
    try:
        limit = int(limit_raw)
    except ValueError:
        raise ApiError(400, "validation", {"limit": "invalid"})
    if limit < 1 or limit > 50:
        raise ApiError(400, "validation", {"limit": "invalid"})
    cursor = query.get("cursor", [None])[0]
    return limit, cursor


def apply_cursor(where: str, params: list, cursor: str | None, direction: str = "before") -> tuple[str, list]:
    """Opaque cursor paging that never repeats or skips an activity as new ones arrive."""
    if not cursor:
        return where, params
    start_time, activity_id = decode_cursor(cursor)
    if start_time is None or activity_id is None:
        raise ApiError(400, "validation", {"cursor": "invalid"})
    where += " AND (a.start_time < %s OR (a.start_time = %s AND a.id < %s))"
    ts = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
    params.extend([ts, ts, activity_id])
    return where, params


def feed_rows(viewer_id: str, limit: int, cursor: str | None, athlete_filter: str | None = None):
    where, params = feed_query_where(viewer_id)
    if athlete_filter:
        where += " AND a.athlete_id = %s"
        params.append(athlete_filter)
    where, params = apply_cursor(where, params, cursor)
    rows = store.query(
        f"""SELECT a.*, ar.private AS owner_private, ar.name AS athlete_name
            FROM activities a JOIN athletes ar ON ar.id = a.athlete_id
            WHERE {where} {FEED_ORDER} LIMIT %s""",
        (*params, limit))
    return rows


@route("GET", "/api/feed")
def feed(handler, body, me):
    limit, cursor = page_params(handler.parsed_query)
    rows = feed_rows(me["id"], limit, cursor)
    next_cursor = None
    if len(rows) == limit and rows:
        last = rows[-1]
        next_cursor = f"{iso(last['start_time'])}|{last['id']}"
        remainder = feed_rows(me["id"], limit + 1, next_cursor)
        if len(remainder) <= limit:
            next_cursor = None
    return json_response({
        "activities": [activity_payload(r) for r in rows],
        "next_cursor": next_cursor,
    })


@route("GET", "/api/athletes/{id}/activities")
def athlete_activities(handler, body, me):
    target = store.one("SELECT id, private FROM athletes WHERE id=%s", (handler.path_params["id"],))
    if not target:
        raise ApiError(404, "not_found")
    limit, cursor = page_params(handler.parsed_query)
    where, params = feed_query_where(me["id"])
    where += " AND a.athlete_id = %s"
    params.append(target["id"])
    where, params = apply_cursor(where, params, cursor)
    rows = store.query(
        f"""SELECT a.*, ar.private AS owner_private, ar.name AS athlete_name
            FROM activities a JOIN athletes ar ON ar.id = a.athlete_id
            WHERE {where} {FEED_ORDER} LIMIT %s""",
        (*params, limit))
    next_cursor = f"{iso(rows[-1]['start_time'])}|{rows[-1]['id']}" if len(rows) == limit and rows else None
    return json_response({
        "activities": [activity_payload(r) for r in rows],
        "next_cursor": next_cursor,
    })


@route("POST", "/api/activities")
def create_activity(handler, body, me):
    name = str_field(body, "name", max_len=100)
    sport = str_field(body, "sport_type", choices=SPORTS)
    visibility = body.get("visibility") or me["default_visibility"]
    if visibility not in VISIBILITIES:
        raise ApiError(400, "validation", {"visibility": "invalid"})
    gpx = body.get("gpx")
    if not isinstance(gpx, str) or not gpx.strip():
        raise ApiError(400, "validation", {"gpx": "required"})
    try:
        points = parse_gpx_points(gpx)
    except ValueError:
        points = []
    if len(points) < 2:
        raise ApiError(400, "validation", {"gpx": "invalid"})
    track = ParsedTrack(points)

    idem_key = handler.headers.get("Idempotency-Key")
    existing = None
    if idem_key:
        existing = store.one(
            "SELECT * FROM idempotency_keys WHERE athlete_id=%s AND key=%s", (me["id"], idem_key))
        if existing:
            body_sha = _body_sha(handler)
            if body_sha != existing["body_sha"]:
                raise ApiError(422, "idempotency_key_reused")
            return json_response({"activity": activity_payload(activity_row(existing["activity_id"]))}, 200)

    duplicate = store.one(
        "SELECT id FROM activities WHERE athlete_id=%s AND start_time=%s",
        (me["id"], track.start_time))
    if duplicate:
        raise ApiError(409, "duplicate_activity", message=None, fields=None)
    activity_id = security.new_id("act")
    try:
        with store.conn() as c:
            c.execute(
                """INSERT INTO activities (id, athlete_id, name, sport_type, visibility, start_time,
                        distance_m, moving_time_s, elapsed_time_s, elevation_gain_m,
                        avg_pace_s_per_km, avg_speed_kmh, splits, best_efforts)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb)""",
                (activity_id, me["id"], name, sport, visibility, track.start_time,
                 track.distance_m, track.moving_time_s, track.elapsed_time_s, track.elevation_gain_m,
                 track.pace(sport), track.avg_speed_kmh, json.dumps(track.splits()),
                 json.dumps(track.best_efforts(sport))))
            for seq, p in enumerate(points):
                c.execute(
                    """INSERT INTO activity_points (activity_id, seq, lat, lon, ele, point_time, distance_m)
                       VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                    (activity_id, seq, p.lat, p.lon, p.ele, p.time, round_half_up(track.cumulative_m[seq])))
    except Exception:
        row = store.one("SELECT id FROM activities WHERE athlete_id=%s AND start_time=%s",
                        (me["id"], track.start_time))
        if row:
            raise ApiError(409, "duplicate_activity")
        raise
    if idem_key:
        try:
            store.execute(
                "INSERT INTO idempotency_keys (athlete_id, key, body_sha, activity_id) VALUES (%s,%s,%s,%s)",
                (me["id"], idem_key, _body_sha(handler), activity_id))
        except Exception:
            pass
    segments_lib.match_activity_against_segments(activity_id)
    return json_response({"activity": activity_payload(activity_row(activity_id))}, 201)


def _body_sha(handler) -> str:
    import hashlib
    return hashlib.sha256(handler.raw_body).hexdigest()


@route("GET", "/api/activities/{id}")
def get_activity(handler, body, me):
    row = viewable_activity(handler.path_params["id"], me["id"])
    return json_response({"activity": activity_payload(row)})


@route("PATCH", "/api/activities/{id}")
def patch_activity(handler, body, me):
    row = viewable_activity(handler.path_params["id"], me["id"], owner_only=True)
    fields = {}
    updates = {}
    if "name" in body:
        name = body.get("name")
        if not isinstance(name, str) or not (1 <= len(name.strip()) <= 100):
            fields["name"] = "invalid"
        else:
            updates["name"] = name.strip()
    if "visibility" in body:
        vis = body.get("visibility")
        if vis not in VISIBILITIES:
            fields["visibility"] = "invalid"
        else:
            updates["visibility"] = vis
    if fields:
        raise ApiError(400, "validation", fields)
    if updates:
        sets = ", ".join(f"{k}=%s" for k in updates)
        store.execute(f"UPDATE activities SET {sets} WHERE id=%s", (*updates.values(), row["id"]))
        for field, value in updates.items():
            if row[field] != value:
                store.execute(
                    """INSERT INTO activity_edits (id, activity_id, field, old_value, new_value, changed_at)
                       VALUES (%s,%s,%s,%s,%s, now())""",
                    (security.new_id("edit"), row["id"], field, str(row[field]), str(value)))
    return json_response({"activity": activity_payload(activity_row(row["id"]))})


@route("DELETE", "/api/activities/{id}")
def delete_activity(handler, body, me):
    viewable_activity(handler.path_params["id"], me["id"], owner_only=True)
    store.execute("DELETE FROM activities WHERE id=%s", (handler.path_params["id"],))
    return 204, [], b""


@route("GET", "/api/activities/{id}/streams")
def activity_streams(handler, body, me):
    row = viewable_activity(handler.path_params["id"], me["id"])
    points = store.query(
        "SELECT lat, lon, ele, point_time, distance_m FROM activity_points WHERE activity_id=%s ORDER BY seq",
        (row["id"],))
    zone = store.one("SELECT * FROM privacy_zones WHERE athlete_id=%s", (row["athlete_id"],))
    latlng, altitude, distance, time = [], [], [], []
    t0 = points[0]["point_time"].timestamp() if points else 0
    for p in points:
        include = True
        if zone and me["id"] != row["athlete_id"]:
            if haversine_m(p["lat"], p["lon"], zone["lat"], zone["lon"]) <= zone["radius_m"]:
                include = False
        if include:
            latlng.append([p["lat"], p["lon"]])
            altitude.append(p["ele"])
            distance.append(int(p["distance_m"]))
            time.append(int(p["point_time"].timestamp() - t0))
    return json_response({"latlng": latlng, "altitude": altitude, "distance": distance, "time": time})


@route("GET", "/api/activities/{id}/export.gpx")
def export_activity(handler, body, me):
    row = viewable_activity(handler.path_params["id"], me["id"], owner_only=True)
    points = store.query(
        "SELECT lat, lon, ele, point_time FROM activity_points WHERE activity_id=%s ORDER BY seq",
        (row["id"],))
    from xml.sax.saxutils import escape
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<gpx version="1.1" creator="Pacely" xmlns="http://www.topografix.com/GPX/1/1">',
             f'<trk><name>{escape(row["name"])}</name><trkseg>']
    for p in points:
        t = p["point_time"].astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        lines.append(f'<trkpt lat="{p["lat"]}" lon="{p["lon"]}"><ele>{p["ele"]}</ele><time>{t}</time></trkpt>')
    lines.append('</trkseg></trk></gpx>')
    body_text = "\n".join(lines)
    return 200, [("Content-Type", "application/gpx+xml"),
                 ("Content-Disposition", f'attachment; filename="{row["id"]}.gpx"')], body_text.encode()


@route("GET", "/api/activities/{id}/history")
def activity_history(handler, body, me):
    row = viewable_activity(handler.path_params["id"], me["id"], owner_only=True)
    if me["id"] != row["athlete_id"]:
        raise ApiError(403, "forbidden")
    edits = store.query(
        "SELECT field, old_value, new_value, changed_at FROM activity_edits WHERE activity_id=%s ORDER BY changed_at, id",
        (row["id"],))
    return json_response({"changes": [
        {"field": e["field"], "from": e["old_value"], "to": e["new_value"], "changed_at": iso(e["changed_at"])}
        for e in edits]})


@route("GET", "/api/athletes/{id}")
def athlete_get(handler, body, me):
    row = store.one("SELECT * FROM athletes WHERE id=%s", (handler.path_params["id"],))
    if not row:
        raise ApiError(404, "not_found")
    follower_count = store.one(
        "SELECT count(*) AS n FROM follows WHERE followee_id=%s AND status='accepted'", (row["id"],))["n"]
    following_count = store.one(
        "SELECT count(*) AS n FROM follows WHERE follower_id=%s AND status='accepted'", (row["id"],))["n"]
    follow_status = "self" if row["id"] == me["id"] else (
        (store.one("SELECT status FROM follows WHERE follower_id=%s AND followee_id=%s",
                   (me["id"], row["id"])) or {"status": "none"})["status"] or "none")
    return json_response({"id": row["id"], "name": row["name"], "private": row["private"],
                          "follower_count": follower_count, "following_count": following_count,
                          "follow_status": follow_status})


@route("POST", "/api/athletes/{id}/follow")
def follow(handler, body, me):
    target = store.one("SELECT * FROM athletes WHERE id=%s", (handler.path_params["id"],))
    if not target:
        raise ApiError(404, "not_found")
    if target["id"] == me["id"]:
        raise ApiError(400, "validation", {"athlete": "self"})
    existing = store.one("SELECT * FROM follows WHERE follower_id=%s AND followee_id=%s",
                         (me["id"], target["id"]))
    if existing:
        return json_response({"status": existing["status"]}, 200)
    status = "pending" if target["private"] else "accepted"
    store.execute(
        "INSERT INTO follows (id, follower_id, followee_id, status) VALUES (%s,%s,%s,%s)",
        (security.new_id("fw"), me["id"], target["id"], status))
    return json_response({"status": status}, 201)


@route("DELETE", "/api/athletes/{id}/follow")
def unfollow(handler, body, me):
    target = store.one("SELECT * FROM athletes WHERE id=%s", (handler.path_params["id"],))
    if not target:
        raise ApiError(404, "not_found")
    store.execute("DELETE FROM follows WHERE follower_id=%s AND followee_id=%s", (me["id"], target["id"]))
    return 204, [], b""


@route("GET", "/api/follow-requests")
def follow_requests(handler, body, me):
    rows = store.query(
        """SELECT f.id, f.follower_id, a.name AS follower_name
           FROM follows f JOIN athletes a ON a.id = f.follower_id
           WHERE f.followee_id=%s AND f.status='pending' ORDER BY f.created_at""",
        (me["id"],))
    return json_response({"requests": [{"id": r["id"], "follower_id": r["follower_id"],
                                        "follower_name": r["follower_name"]} for r in rows]})


@route("POST", "/api/follow-requests/{id}/approve")
def approve_request(handler, body, me):
    req = store.one("SELECT * FROM follows WHERE id=%s", (handler.path_params["id"],))
    if not req:
        raise ApiError(404, "not_found")
    if req["followee_id"] != me["id"]:
        raise ApiError(403, "forbidden")
    store.execute("UPDATE follows SET status='accepted' WHERE id=%s", (req["id"],))
    return json_response({"status": "accepted"})


@route("POST", "/api/follow-requests/{id}/reject")
def reject_request(handler, body, me):
    req = store.one("SELECT * FROM follows WHERE id=%s", (handler.path_params["id"],))
    if not req:
        raise ApiError(404, "not_found")
    if req["followee_id"] != me["id"]:
        raise ApiError(403, "forbidden")
    store.execute("DELETE FROM follows WHERE id=%s", (req["id"],))
    return json_response({"status": "rejected"})

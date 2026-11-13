"""Kudos, comments, segments, leaderboards, challenges, stats, recap, plans, privacy."""
from datetime import datetime, timezone

from lib import security, store
from lib.errors import ApiError
from lib.parse import round_half_up
from lib.segments import leaderboard, match_activity_against_segments

from web import json_response, route, iso
import api_social
from lib.rules import can_view

RADII = (200, 400, 800, 1600)


# ---------------------------------------------------------------- kudos
@route("POST", "/api/activities/{id}/kudos")
def give_kudos(handler, body, me):
    row = api_social.activity_row(handler.path_params["id"])
    if not row or not can_view(me["id"], row):
        raise ApiError(404, "not_found")
    if row["athlete_id"] == me["id"]:
        raise ApiError(422, "cannot_kudo_own_activity")
    try:
        with store.conn() as c:
            c.execute(
                """INSERT INTO kudos (id, athlete_id, activity_id) VALUES (%s,%s,%s)""",
                (security.new_id("k"), me["id"], row["id"]))
            c.execute(
                """UPDATE activities SET kudos_count = (
                       SELECT count(*) FROM kudos WHERE activity_id=%s) WHERE id=%s""",
                (row["id"], row["id"]))
        return json_response({"kudos_count": api_social.activity_row(row["id"])["kudos_count"]}, 201)
    except Exception:
        return json_response({"kudos_count": api_social.activity_row(row["id"])["kudos_count"]}, 200)


@route("DELETE", "/api/activities/{id}/kudos")
def remove_kudos(handler, body, me):
    row = api_social.activity_row(handler.path_params["id"])
    if not row or not can_view(me["id"], row):
        raise ApiError(404, "not_found")
    store.execute("DELETE FROM kudos WHERE athlete_id=%s AND activity_id=%s", (me["id"], row["id"]))
    store.execute(
        """UPDATE activities SET kudos_count = (
               SELECT count(*) FROM kudos WHERE activity_id=%s) WHERE id=%s""", (row["id"], row["id"]))
    return 204, [], b""


@route("GET", "/api/activities/{id}/kudos")
def kudos_list(handler, body, me):
    row = api_social.viewable_activity(handler.path_params["id"], me["id"])
    rows = store.query(
        """SELECT k.athlete_id, a.name FROM kudos k JOIN athletes a ON a.id=k.athlete_id
           WHERE k.activity_id=%s ORDER BY k.created_at, k.id""", (row["id"],))
    return json_response({"athletes": [{"id": r["athlete_id"], "name": r["name"]} for r in rows]})


@route("POST", "/api/activities/{id}/comments")
def post_comment(handler, body, me):
    row = api_social.viewable_activity(handler.path_params["id"], me["id"])
    text = body.get("text")
    if not isinstance(text, str):
        raise ApiError(400, "validation", {"text": "invalid"})
    trimmed = text.strip()
    if not (1 <= len(trimmed) <= 500):
        raise ApiError(400, "validation", {"text": "invalid"})
    cid = security.new_id("c")
    created = datetime.now(timezone.utc)
    store.execute(
        "INSERT INTO comments (id, activity_id, athlete_id, text) VALUES (%s,%s,%s,%s)",
        (cid, row["id"], me["id"], trimmed))
    store.execute(
        """UPDATE activities SET comment_count = (
               SELECT count(*) FROM comments WHERE activity_id=%s) WHERE id=%s""", (row["id"], row["id"]))
    return json_response({"id": cid, "athlete_id": me["id"], "athlete_name": me["name"],
                          "text": trimmed, "created_at": iso(created)}, 201)


@route("GET", "/api/activities/{id}/comments")
def comments_list(handler, body, me):
    row = api_social.viewable_activity(handler.path_params["id"], me["id"])
    rows = store.query(
        """SELECT c.id, c.athlete_id, a.name AS athlete_name, c.text, c.created_at
           FROM comments c JOIN athletes a ON a.id=c.athlete_id
           WHERE c.activity_id=%s ORDER BY c.created_at, c.id""", (row["id"],))
    return json_response({"comments": [
        {"id": r["id"], "athlete_id": r["athlete_id"], "athlete_name": r["athlete_name"],
         "text": r["text"], "created_at": iso(r["created_at"])} for r in rows]})


@route("DELETE", "/api/comments/{id}")
def delete_comment(handler, body, me):
    comment = store.one("SELECT * FROM comments WHERE id=%s", (handler.path_params["id"],))
    if not comment:
        raise ApiError(404, "not_found")
    activity = api_social.activity_row(comment["activity_id"])
    if me["id"] != comment["athlete_id"] and me["id"] != activity["athlete_id"]:
        if can_view(me["id"], activity):
            raise ApiError(403, "forbidden")
        raise ApiError(404, "not_found")
    store.execute("DELETE FROM comments WHERE id=%s", (comment["id"],))
    store.execute(
        """UPDATE activities SET comment_count = (
               SELECT count(*) FROM comments WHERE activity_id=%s) WHERE id=%s""",
        (comment["activity_id"], comment["activity_id"]))
    return 204, [], b""


# ---------------------------------------------------------------- privacy
@route("GET", "/api/me/privacy")
def privacy_get(handler, body, me):
    zone = store.one("SELECT * FROM privacy_zones WHERE athlete_id=%s", (me["id"],))
    return json_response({
        "private": me["private"],
        "default_visibility": me["default_visibility"],
        "privacy_zone": ({"lat": zone["lat"], "lon": zone["lon"], "radius_m": zone["radius_m"]}
                         if zone else None),
    })


@route("PUT", "/api/me/privacy")
def privacy_put(handler, body, me):
    fields = {}
    private = body.get("private")
    if not isinstance(private, bool):
        fields["private"] = "invalid"
    vis = body.get("default_visibility")
    if vis not in ("everyone", "followers", "only_me"):
        fields["default_visibility"] = "invalid"
    zone = body.get("privacy_zone")
    if zone is not None:
        if not isinstance(zone, dict):
            fields["privacy_zone"] = "invalid"
        else:
            try:
                lat = float(zone["lat"])
                lon = float(zone["lon"])
                radius = int(zone["radius_m"])
                if radius not in RADII or not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
                    fields["privacy_zone"] = "invalid"
            except (KeyError, TypeError, ValueError):
                fields["privacy_zone"] = "invalid"
    if fields:
        raise ApiError(400, "validation", fields)
    store.execute("UPDATE athletes SET private=%s, default_visibility=%s WHERE id=%s",
                  (private, vis, me["id"]))
    if zone is None:
        store.execute("DELETE FROM privacy_zones WHERE athlete_id=%s", (me["id"],))
    else:
        store.execute(
            """INSERT INTO privacy_zones (athlete_id, lat, lon, radius_m) VALUES (%s,%s,%s,%s)
               ON CONFLICT (athlete_id) DO UPDATE SET lat=EXCLUDED.lat, lon=EXCLUDED.lon,
                                                    radius_m=EXCLUDED.radius_m""",
            (me["id"], lat, lon, radius))
    return privacy_get(handler, body, me)


# ---------------------------------------------------------------- segments
@route("POST", "/api/segments")
def create_segment(handler, body, me):
    activity = store.one(
        "SELECT * FROM activities WHERE id=%s", (body.get("activity_id"),))
    if not activity:
        raise ApiError(404, "not_found")
    if activity["athlete_id"] != me["id"]:
        if can_view(me["id"], api_social.activity_row(activity["id"])):
            raise ApiError(403, "forbidden")
        raise ApiError(404, "not_found")
    points = store.query(
        "SELECT * FROM activity_points WHERE activity_id=%s ORDER BY seq", (activity["id"],))
    name = body.get("name")
    fields = {}
    if not isinstance(name, str) or not (3 <= len(name.strip()) <= 60):
        fields["name"] = "invalid"
    si = body.get("start_index")
    ei = body.get("end_index")
    try:
        si = int(si)
        ei = int(ei)
        if not (0 <= si < ei < len(points)):
            fields["start_index"] = "invalid"
            fields["end_index"] = "invalid"
    except (TypeError, ValueError):
        fields["start_index"] = "invalid"
        fields["end_index"] = "invalid"
    if fields:
        raise ApiError(400, "validation", fields)
    start, end = points[si], points[ei]
    distance_m = round_half_up(end["distance_m"] - start["distance_m"])
    elevation_diff_m = round_half_up(end["ele"] - start["ele"])
    seg_id = security.new_id("seg")
    store.execute(
        """INSERT INTO segments (id, name, start_lat, start_lon, end_lat, end_lon,
                                 distance_m, elevation_diff_m, creator_id)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (seg_id, name.strip(), start["lat"], start["lon"], end["lat"], end["lon"],
         distance_m, elevation_diff_m, me["id"]))
    for other in store.query(
            "SELECT id FROM activities WHERE athlete_id=%s ORDER BY start_time", (me["id"],)):
        match_activity_against_segments(other["id"])
    row = store.one("SELECT * FROM segments WHERE id=%s", (seg_id,))
    return json_response(segment_payload(row), 201)


def segment_payload(row, effort_count=None, athlete_count=None) -> dict:
    return {"id": row["id"], "name": row["name"], "start_lat": row["start_lat"],
            "start_lon": row["start_lon"], "end_lat": row["end_lat"], "end_lon": row["end_lon"],
            "distance_m": row["distance_m"], "elevation_diff_m": row["elevation_diff_m"],
            **({"effort_count": effort_count, "athlete_count": athlete_count}
               if effort_count is not None else {})}


@route("GET", "/api/segments")
def search_segments(handler, body, me):
    q = (handler.parsed_query.get("q", [""])[0] or "").strip()
    rows = store.query("SELECT * FROM segments WHERE name ILIKE %s ORDER BY name",
                       (f"%{q}%",))
    return json_response({"segments": [segment_payload(r) for r in rows]})


@route("GET", "/api/segments/{id}")
def get_segment(handler, body, me):
    row = store.one("SELECT * FROM segments WHERE id=%s", (handler.path_params["id"],))
    if not row:
        raise ApiError(404, "not_found")
    counts = store.one(
        """SELECT count(*) AS efforts, count(DISTINCT e.athlete_id) AS athletes
           FROM segment_efforts e JOIN activities a ON a.id=e.activity_id
           WHERE e.segment_id=%s AND a.visibility != 'only_me'""", (row["id"],))
    return json_response({**segment_payload(row, counts["efforts"], counts["athletes"])})


@route("PATCH", "/api/segments/{id}")
def rename_segment(handler, body, me):
    row = store.one("SELECT * FROM segments WHERE id=%s", (handler.path_params["id"],))
    if not row:
        raise ApiError(404, "not_found")
    if row["creator_id"] != me["id"]:
        raise ApiError(403, "forbidden")
    name = body.get("name")
    if not isinstance(name, str) or not (3 <= len(name.strip()) <= 60):
        raise ApiError(400, "validation", {"name": "invalid"})
    store.execute("UPDATE segments SET name=%s WHERE id=%s", (name.strip(), row["id"]))
    return json_response(segment_payload(store.one("SELECT * FROM segments WHERE id=%s", (row["id"],))))


@route("GET", "/api/segments/{id}/leaderboard")
def segment_leaderboard(handler, body, me):
    seg = store.one("SELECT * FROM segments WHERE id=%s", (handler.path_params["id"],))
    if not seg:
        raise ApiError(404, "not_found")
    filt = (handler.parsed_query.get("filter", ["overall"])[0] or "overall")
    if filt not in ("overall", "following"):
        raise ApiError(400, "validation", {"filter": "invalid"})
    if filt == "following":
        followed = [r["followee_id"] for r in store.query(
            "SELECT followee_id FROM follows WHERE follower_id=%s AND status='accepted'", (me["id"],))]
        allowed = set(followed) | {me["id"]}
    else:
        allowed = None
    result = leaderboard(seg["id"], me["id"])
    entries = result["entries"]
    if allowed is not None:
        entries = [e for e in entries if e["athlete_id"] in allowed]
    ranked = []
    for i, e in enumerate(entries):
        ranked.append({"rank": i + 1, **e})
    viewer_entry = next((e for e in ranked if e["athlete_id"] == me["id"]), None)
    entry_count = len(ranked)
    is_subscriber = me["subscriber"]
    if not is_subscriber:
        visible = ranked[:10]
    else:
        visible = ranked
    return json_response({"entries": visible,
                          "entry_count": entry_count, "viewer_entry": viewer_entry})

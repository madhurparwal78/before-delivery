"""Uploading, reading, changing and exporting activities."""
import hashlib
import json
from datetime import timezone
from xml.sax.saxutils import escape

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from psycopg import errors

from .. import auth, db
from ..domain.geo import haversine_m
from ..domain.parsing import GpxError, TrackPoint, cumulative_distances, parse_gpx, round_half_up, summarize
from ..domain.segments import record_effort
from ..domain.visibility import ACTIVITY_SOURCE, VISIBLE_TO_VIEWER
from ..errors import ApiError, forbidden, not_found
from .common import (
    SPORT_TYPES,
    VISIBILITIES,
    activities_json,
    decode_cursor,
    encode_cursor,
    iso,
    paging_limit,
    parse_id,
    read_json,
    require,
)

router = APIRouter()

ACTIVITY_SELECT = f"""
    SELECT a.*, owner.name AS athlete_name,
           (SELECT count(*) FROM kudos k WHERE k.activity_id = a.id) AS kudos_count,
           (SELECT count(*) FROM comments c WHERE c.activity_id = a.id) AS comment_count
    {ACTIVITY_SOURCE}
"""


def load_activity(cursor, activity_id: int, viewer_id: int) -> dict:
    """The only way an activity is read: hidden activities are simply not found."""
    cursor.execute(
        f"{ACTIVITY_SELECT} WHERE a.id = %(id)s AND {VISIBLE_TO_VIEWER}",
        {"id": activity_id, "viewer_id": viewer_id},
    )
    row = cursor.fetchone()
    if row is None:
        raise not_found()
    return row


def load_owned_activity(cursor, activity_id: int, viewer: dict) -> dict:
    row = load_activity(cursor, activity_id, viewer["id"])
    if row["athlete_id"] != viewer["id"]:
        raise forbidden()
    return row


def load_points(cursor, activity_id: int) -> list[TrackPoint]:
    cursor.execute(
        "SELECT lat, lon, ele, point_time FROM activity_points WHERE activity_id = %s ORDER BY point_index",
        (activity_id,),
    )
    return [TrackPoint(r["lat"], r["lon"], r["ele"], r["point_time"]) for r in cursor.fetchall()]


def _activity_response(cursor, row: dict, status: int) -> JSONResponse:
    return JSONResponse(activities_json(cursor, [row])[0], status_code=status)


def match_segments(cursor, activity: dict, points: list[TrackPoint]) -> None:
    cursor.execute("SELECT * FROM segments")
    for segment in cursor.fetchall():
        record_effort(cursor, segment, activity, points)


def _store_points(cursor, activity_id: int, points: list[TrackPoint]) -> None:
    with cursor.copy(
        "COPY activity_points (activity_id, point_index, lat, lon, ele, point_time) FROM STDIN"
    ) as copy:
        for index, point in enumerate(points):
            copy.write_row((activity_id, index, point.lat, point.lon, point.ele, point.time))


def insert_activity(
    cursor,
    athlete_id: int,
    name: str,
    sport_type: str,
    visibility: str,
    points: list[TrackPoint],
    summary: dict,
    key: str | None = None,
    digest: str | None = None,
) -> int:
    cursor.execute(
        """
        INSERT INTO activities (athlete_id, name, sport_type, visibility, start_time,
            distance_m, moving_time_s, elapsed_time_s, elevation_gain_m,
            avg_pace_s_per_km, avg_speed_kmh, splits, best_efforts,
            idempotency_key, request_digest)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (
            athlete_id,
            name,
            sport_type,
            visibility,
            summary["start_time"],
            summary["distance_m"],
            summary["moving_time_s"],
            summary["elapsed_time_s"],
            summary["elevation_gain_m"],
            summary["avg_pace_s_per_km"],
            summary["avg_speed_kmh"],
            json.dumps(summary["splits"]),
            json.dumps(summary["best_efforts"]),
            key,
            digest if key else None,
        ),
    )
    activity_id = cursor.fetchone()["id"]
    _store_points(cursor, activity_id, points)
    return activity_id


@router.post("/activities")
async def upload_activity(request: Request, athlete: dict = Depends(auth.require_athlete)):
    raw = await request.body()
    body = await read_json(request)
    fields: dict = {}
    name = body.get("name")
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 100:
        fields["name"] = "must be 1 to 100 characters"
    sport_type = body.get("sport_type")
    if sport_type not in SPORT_TYPES:
        fields["sport_type"] = f"must be one of {', '.join(SPORT_TYPES)}"
    visibility = body.get("visibility", athlete["default_visibility"])
    if visibility not in VISIBILITIES:
        fields["visibility"] = f"must be one of {', '.join(VISIBILITIES)}"
    document = body.get("gpx")
    if not isinstance(document, str) or not document.strip():
        fields["gpx"] = "must be the text of a GPX document"
    require(fields)
    try:
        points = parse_gpx(document)
    except GpxError:
        raise ApiError(400, "validation", fields={"gpx": "must hold at least two timed track points"})

    summary = summarize(points, sport_type)
    key = request.headers.get("idempotency-key")
    digest = hashlib.sha256(raw).hexdigest()

    with db.connect() as conn:
        cursor = conn.cursor()
        if key:
            replay = _replay_for_key(cursor, athlete["id"], key, digest)
            if replay is not None:
                return replay
        try:
            with conn.transaction():
                activity_id = insert_activity(
                    cursor, athlete["id"], name.strip(), sport_type, visibility, points, summary, key, digest
                )
        except errors.UniqueViolation as exc:
            constraint = exc.diag.constraint_name or ""
            if constraint == "activities_idempotency_key":
                replay = _replay_for_key(cursor, athlete["id"], key, digest)
                if replay is not None:
                    return replay
                raise ApiError(422, "idempotency_key_reused")
            cursor.execute(
                "SELECT id FROM activities WHERE athlete_id = %s AND start_time = %s",
                (athlete["id"], summary["start_time"]),
            )
            existing = cursor.fetchone()
            raise ApiError(409, "duplicate_activity", activity_id=existing["id"] if existing else None)
        match_segments(
            cursor,
            {"id": activity_id, "athlete_id": athlete["id"], "visibility": visibility},
            points,
        )
        row = load_activity(cursor, activity_id, athlete["id"])
        return _activity_response(cursor, row, 201)


def _replay_for_key(cursor, athlete_id: int, key: str, digest: str):
    cursor.execute(
        "SELECT id, request_digest FROM activities WHERE athlete_id = %s AND idempotency_key = %s",
        (athlete_id, key),
    )
    stored = cursor.fetchone()
    if stored is None:
        return None
    if stored["request_digest"] != digest:
        raise ApiError(422, "idempotency_key_reused")
    return _activity_response(cursor, load_activity(cursor, stored["id"], athlete_id), 200)


@router.get("/activities/{activity_id}")
def read_activity(activity_id: str, athlete: dict = Depends(auth.require_athlete)):
    with db.cursor() as cursor:
        row = load_activity(cursor, parse_id(activity_id), athlete["id"])
        return activities_json(cursor, [row])[0]


@router.patch("/activities/{activity_id}")
async def change_activity(
    activity_id: str, request: Request, athlete: dict = Depends(auth.require_athlete)
):
    body = await read_json(request)
    fields: dict = {}
    updates: dict = {}
    if "name" in body:
        name = body.get("name")
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 100:
            fields["name"] = "must be 1 to 100 characters"
        else:
            updates["name"] = name.strip()
    if "visibility" in body:
        visibility = body.get("visibility")
        if visibility not in VISIBILITIES:
            fields["visibility"] = f"must be one of {', '.join(VISIBILITIES)}"
        else:
            updates["visibility"] = visibility
    require(fields)
    with db.cursor() as cursor:
        row = load_owned_activity(cursor, parse_id(activity_id), athlete)
        for field, value in updates.items():
            if row[field] == value:
                continue
            cursor.execute(
                f"UPDATE activities SET {field} = %s WHERE id = %s", (value, row["id"])
            )
            cursor.execute(
                "INSERT INTO activity_edits (activity_id, field, from_value, to_value) VALUES (%s, %s, %s, %s)",
                (row["id"], field, row[field], value),
            )
        updated = load_activity(cursor, row["id"], athlete["id"])
        return activities_json(cursor, [updated])[0]


@router.delete("/activities/{activity_id}")
def delete_activity(activity_id: str, athlete: dict = Depends(auth.require_athlete)):
    with db.cursor() as cursor:
        row = load_owned_activity(cursor, parse_id(activity_id), athlete)
        cursor.execute("DELETE FROM activities WHERE id = %s", (row["id"],))
    return Response(status_code=204)


@router.get("/activities/{activity_id}/history")
def activity_history(activity_id: str, athlete: dict = Depends(auth.require_athlete)):
    with db.cursor() as cursor:
        row = load_owned_activity(cursor, parse_id(activity_id), athlete)
        cursor.execute(
            "SELECT field, from_value, to_value, changed_at FROM activity_edits WHERE activity_id = %s ORDER BY id",
            (row["id"],),
        )
        return {
            "changes": [
                {
                    "field": edit["field"],
                    "from": edit["from_value"],
                    "to": edit["to_value"],
                    "changed_at": iso(edit["changed_at"]),
                }
                for edit in cursor.fetchall()
            ]
        }


@router.get("/activities/{activity_id}/streams")
def activity_streams(activity_id: str, athlete: dict = Depends(auth.require_athlete)):
    with db.cursor() as cursor:
        row = load_activity(cursor, parse_id(activity_id), athlete["id"])
        points = load_points(cursor, row["id"])
        running = cumulative_distances(points)
        first = points[0].time
        keep = range(len(points))
        if row["athlete_id"] != athlete["id"]:
            cursor.execute("SELECT * FROM privacy_zones WHERE athlete_id = %s", (row["athlete_id"],))
            zone = cursor.fetchone()
            if zone is not None:
                keep = [
                    index
                    for index, point in enumerate(points)
                    if haversine_m(point.lat, point.lon, zone["lat"], zone["lon"]) > zone["radius_m"]
                ]
        return {
            "latlng": [[points[i].lat, points[i].lon] for i in keep],
            "altitude": [points[i].ele for i in keep],
            "distance": [round_half_up(running[i]) for i in keep],
            "time": [round_half_up((points[i].time - first).total_seconds()) for i in keep],
        }


@router.get("/activities/{activity_id}/export.gpx")
def export_activity(activity_id: str, athlete: dict = Depends(auth.require_athlete)):
    with db.cursor() as cursor:
        row = load_owned_activity(cursor, parse_id(activity_id), athlete)
        points = load_points(cursor, row["id"])
    body = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1" creator="Pacely" xmlns="http://www.topografix.com/GPX/1/1">',
        f"  <trk><name>{escape(row['name'])}</name><trkseg>",
    ]
    for point in points:
        body.append(
            f'    <trkpt lat="{point.lat!r}" lon="{point.lon!r}">'
            f"<ele>{point.ele!r}</ele>"
            f"<time>{point.time.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}</time></trkpt>"
        )
    body.append("  </trkseg></trk>")
    body.append("</gpx>")
    return Response("\n".join(body), media_type="application/gpx+xml")


def _page(cursor, where: str, params: dict, request: Request) -> dict:
    limit = paging_limit(request)
    cursor_value = request.query_params.get("cursor")
    clause = ""
    if cursor_value:
        moment, last_id = decode_cursor(cursor_value)
        params |= {"cursor_time": moment, "cursor_id": last_id}
        clause = " AND (a.start_time, a.id) < (%(cursor_time)s, %(cursor_id)s)"
    params["limit"] = limit + 1
    cursor.execute(
        f"{ACTIVITY_SELECT} WHERE {where}{clause} ORDER BY a.start_time DESC, a.id DESC LIMIT %(limit)s",
        params,
    )
    rows = cursor.fetchall()
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        next_cursor = encode_cursor(rows[-1]["start_time"], rows[-1]["id"])
    return {"activities": activities_json(cursor, rows), "next_cursor": next_cursor}


@router.get("/feed")
def feed(request: Request, athlete: dict = Depends(auth.require_athlete)):
    with db.cursor() as cursor:
        return _page(
            cursor,
            f"""(a.athlete_id = %(viewer_id)s OR a.athlete_id IN (
                    SELECT followee_id FROM follows
                    WHERE follower_id = %(viewer_id)s AND status = 'accepted'))
                AND {VISIBLE_TO_VIEWER}""",
            {"viewer_id": athlete["id"]},
            request,
        )


@router.get("/athletes/{athlete_id}/activities")
def athlete_activities(athlete_id: str, request: Request, athlete: dict = Depends(auth.require_athlete)):
    target = parse_id(athlete_id)
    with db.cursor() as cursor:
        cursor.execute("SELECT id FROM athletes WHERE id = %s", (target,))
        if cursor.fetchone() is None:
            raise not_found()
        return _page(
            cursor,
            f"a.athlete_id = %(target)s AND {VISIBLE_TO_VIEWER}",
            {"viewer_id": athlete["id"], "target": target},
            request,
        )

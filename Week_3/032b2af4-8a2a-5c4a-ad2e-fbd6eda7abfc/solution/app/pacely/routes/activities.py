"""Uploading, reading, editing, exporting and deleting activities."""

import asyncio

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from .. import db, gpx
from ..activity_view import find_visible, outside_zone, to_json, zones_of
from ..errors import ApiError, forbidden, not_found, validation
from ..gpx import GpxError, half_up
from ..http import authenticated, iso, parse_id, read_json, text_field
from ..idempotency import fingerprint
from ..recording import store_activity

SPORTS = ("run", "ride", "walk", "hike")
VISIBILITIES = ("everyone", "followers", "only_me")


async def _validated_upload(body: dict, me: dict) -> tuple[str, str, str, list]:
    fields: dict[str, str] = {}
    name = text_field(body, "name", 1, 100, fields)
    sport = body.get("sport_type")
    if sport not in SPORTS:
        fields["sport_type"] = "sport_type must be run, ride, walk or hike"
    visibility = body.get("visibility", me["default_visibility"])
    if visibility not in VISIBILITIES:
        fields["visibility"] = "visibility must be everyone, followers or only_me"
    points = []
    if not isinstance(body.get("gpx"), str):
        fields["gpx"] = "gpx must be the text of a GPX 1.1 document"
    else:
        try:
            points = await asyncio.to_thread(gpx.parse_gpx, body["gpx"])
        except GpxError as error:
            fields["gpx"] = str(error)
    if fields:
        raise validation(fields)
    return name, sport, visibility, points


@authenticated
async def create_activity(request: Request, me: dict) -> JSONResponse:
    body = await read_json(request)
    name, sport, visibility, points = await _validated_upload(body, me)
    figures = await asyncio.to_thread(gpx.measure, points, sport)
    key = request.headers.get("idempotency-key")
    request_fingerprint = fingerprint("POST", request.url.path, body)
    async with db.pool.acquire() as conn:
        async with conn.transaction():
            if key and await conn.fetchval(
                    "INSERT INTO idempotency_keys (athlete_id, key, fingerprint) VALUES ($1, $2, $3)"
                    " ON CONFLICT DO NOTHING RETURNING 1", me["id"], key, request_fingerprint) is None:
                stored = await conn.fetchrow("SELECT fingerprint, activity_id FROM idempotency_keys"
                                             " WHERE athlete_id = $1 AND key = $2", me["id"], key)
                if stored["fingerprint"] != request_fingerprint:
                    raise ApiError(422, "idempotency_key_reused")
                row = await find_visible(conn, stored["activity_id"], me["id"])
                return JSONResponse((await to_json(conn, [row], me["id"]))[0])
            activity_id = await store_activity(conn, me["id"], name, sport, visibility, points, figures)
            if activity_id is None:
                existing = await conn.fetchval("SELECT id FROM activities WHERE athlete_id = $1 AND start_time = $2",
                                               me["id"], points[0].time)
                raise ApiError(409, "duplicate_activity", activity_id=existing)
            if key:
                await conn.execute("UPDATE idempotency_keys SET activity_id = $3 WHERE athlete_id = $1 AND key = $2",
                                   me["id"], key, activity_id)
            row = await find_visible(conn, activity_id, me["id"])
            return JSONResponse((await to_json(conn, [row], me["id"]))[0], status_code=201)


async def _visible_or_404(request: Request, me: dict):
    activity_id = parse_id(request.path_params["activity_id"])
    row = await find_visible(db.pool, activity_id, me["id"])
    if row is None:
        raise not_found()
    return row


async def _owned_or_refused(request: Request, me: dict):
    row = await _visible_or_404(request, me)
    if row["athlete_id"] != me["id"]:
        raise forbidden()
    return row


@authenticated
async def read_activity(request: Request, me: dict) -> JSONResponse:
    row = await _visible_or_404(request, me)
    return JSONResponse((await to_json(db.pool, [row], me["id"]))[0])


@authenticated
async def read_streams(request: Request, me: dict) -> JSONResponse:
    row = await _visible_or_404(request, me)
    points = await db.pool.fetch(
        "SELECT lat, lon, ele, distance_m, time FROM activity_points WHERE activity_id = $1 ORDER BY idx", row["id"])
    if row["athlete_id"] != me["id"]:
        zone = (await zones_of(db.pool, [row["athlete_id"]])).get(row["athlete_id"])
        points = [p for p in points if outside_zone(p["lat"], p["lon"], zone)]
    first = row["start_time"]
    return JSONResponse({
        "latlng": [[p["lat"], p["lon"]] for p in points], "altitude": [p["ele"] for p in points],
        "distance": [half_up(p["distance_m"]) for p in points],
        "time": [half_up((p["time"] - first).total_seconds()) for p in points]})


@authenticated
async def export_activity(request: Request, me: dict) -> Response:
    row = await _owned_or_refused(request, me)
    points = await db.pool.fetch("SELECT lat, lon, ele, time FROM activity_points WHERE activity_id = $1 ORDER BY idx",
                                 row["id"])
    return Response(gpx.export_gpx(row["name"], [dict(p) for p in points]), media_type="application/gpx+xml")


@authenticated
async def update_activity(request: Request, me: dict) -> JSONResponse:
    row = await _owned_or_refused(request, me)
    body = await read_json(request)
    fields: dict[str, str] = {}
    changes = {}
    if "name" in body:
        name = text_field(body, "name", 1, 100, fields)
        if name is not None:
            changes["name"] = name
    if "visibility" in body:
        if body["visibility"] in VISIBILITIES:
            changes["visibility"] = body["visibility"]
        else:
            fields["visibility"] = "visibility must be everyone, followers or only_me"
    if fields:
        raise validation(fields)
    async with db.pool.acquire() as conn, conn.transaction():
        current = await conn.fetchrow("SELECT name, visibility FROM activities WHERE id = $1 FOR UPDATE", row["id"])
        for field in ("name", "visibility"):
            if field in changes and changes[field] != current[field]:
                await conn.execute("INSERT INTO activity_edits (activity_id, field, old_value, new_value)"
                                   " VALUES ($1, $2, $3, $4)", row["id"], field, current[field], changes[field])
                await conn.execute(f"UPDATE activities SET {field} = $2 WHERE id = $1", row["id"], changes[field])
        fresh = await find_visible(conn, row["id"], me["id"])
        return JSONResponse((await to_json(conn, [fresh], me["id"]))[0])


@authenticated
async def delete_activity(request: Request, me: dict) -> Response:
    row = await _owned_or_refused(request, me)
    await db.pool.execute("DELETE FROM activities WHERE id = $1", row["id"])
    return Response(status_code=204)


@authenticated
async def read_history(request: Request, me: dict) -> JSONResponse:
    row = await _owned_or_refused(request, me)
    edits = await db.pool.fetch("SELECT field, old_value, new_value, changed_at FROM activity_edits"
                                " WHERE activity_id = $1 ORDER BY id", row["id"])
    return JSONResponse({"changes": [{"field": e["field"], "from": e["old_value"], "to": e["new_value"],
                                      "changed_at": iso(e["changed_at"])} for e in edits]})


routes = [
    Route("/api/activities", create_activity, methods=["POST"]),
    Route("/api/activities/{activity_id}", read_activity, methods=["GET"]),
    Route("/api/activities/{activity_id}", update_activity, methods=["PATCH"]),
    Route("/api/activities/{activity_id}", delete_activity, methods=["DELETE"]),
    Route("/api/activities/{activity_id}/streams", read_streams, methods=["GET"]),
    Route("/api/activities/{activity_id}/export.gpx", export_activity, methods=["GET"]),
    Route("/api/activities/{activity_id}/history", read_history, methods=["GET"]),
]

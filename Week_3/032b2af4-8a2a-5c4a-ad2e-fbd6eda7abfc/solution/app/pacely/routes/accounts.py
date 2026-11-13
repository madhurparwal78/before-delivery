"""Sign up, log in and out, the athlete's own record, privacy settings and account deletion."""

import re
from functools import cache
from zoneinfo import available_timezones

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from .. import db, security
from ..errors import ApiError, validation
from ..http import authenticated, read_json, text_field

EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]{2,}")
VISIBILITIES = ("everyone", "followers", "only_me")
RADII = (200, 400, 800, 1600)


@cache
def zone_names() -> frozenset[str]:
    return frozenset(available_timezones())


async def health(request: Request) -> JSONResponse:
    await db.pool.fetchval("SELECT 1")
    return JSONResponse({"status": "ok"})


async def signup(request: Request) -> JSONResponse:
    body = await read_json(request)
    fields: dict[str, str] = {}
    email = body.get("email")
    if not isinstance(email, str) or len(email.strip()) > 254 or not EMAIL.fullmatch(email.strip()):
        fields["email"] = "email must be a valid address"
    name = text_field(body, "name", 1, 80, fields)
    password = body.get("password")
    if not isinstance(password, str) or not 8 <= len(password) <= 200:
        fields["password"] = "password must be 8 to 200 characters"
    if fields:
        raise validation(fields)
    password_hash = await security.hash_password(password)
    async with db.pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            "INSERT INTO athletes (email, name, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING"
            " RETURNING id, email, name, private, default_visibility, plan, time_zone",
            email.strip().lower(), name, password_hash)
        if row is None:
            raise ApiError(409, "email_taken")
        token = await security.open_session(conn, row["id"])
    return JSONResponse({"token": token, "athlete": security.athlete_json(dict(row))}, status_code=201)


async def login(request: Request) -> JSONResponse:
    body = await read_json(request)
    email, password = body.get("email"), body.get("password")
    row = None
    if isinstance(email, str) and isinstance(password, str):
        row = await db.pool.fetchrow(
            "SELECT id, email, name, private, default_visibility, plan, time_zone, password_hash"
            " FROM athletes WHERE email = $1", email.strip().lower())
    stored = row["password_hash"] if row else security.DUMMY_HASH
    matches = await security.check_password(password if isinstance(password, str) else "", stored)
    if row is None or not matches:
        raise ApiError(401, "invalid_credentials")
    async with db.pool.acquire() as conn:
        token = await security.open_session(conn, row["id"])
    return JSONResponse({"token": token, "athlete": security.athlete_json(dict(row))})


@authenticated
async def logout(request: Request, me: dict) -> Response:
    await db.pool.execute("DELETE FROM sessions WHERE token_hash = $1", security.token_hash(security.bearer(request)))
    return Response(status_code=204)


@authenticated
async def read_me(request: Request, me: dict) -> JSONResponse:
    return JSONResponse({"athlete": security.athlete_json(me)})


@authenticated
async def update_me(request: Request, me: dict) -> JSONResponse:
    body = await read_json(request)
    fields: dict[str, str] = {}
    name = me["name"]
    if "name" in body:
        name = text_field(body, "name", 1, 80, fields)
    zone = me["time_zone"]
    if "time_zone" in body:
        if isinstance(body["time_zone"], str) and body["time_zone"] in zone_names():
            zone = body["time_zone"]
        else:
            fields["time_zone"] = "time_zone must be an IANA zone name such as Asia/Kolkata"
    if fields:
        raise validation(fields)
    await db.pool.execute("UPDATE athletes SET name = $2, time_zone = $3 WHERE id = $1", me["id"], name, zone)
    return JSONResponse({"athlete": security.athlete_json({**me, "name": name, "time_zone": zone})})


@authenticated
async def delete_me(request: Request, me: dict) -> Response:
    body = await read_json(request, optional=True)
    password = body.get("password")
    stored = await db.pool.fetchval("SELECT password_hash FROM athletes WHERE id = $1", me["id"])
    if not isinstance(password, str) or not await security.check_password(password, stored):
        raise ApiError(403, "wrong_password")
    await db.pool.execute("DELETE FROM athletes WHERE id = $1", me["id"])
    return Response(status_code=204)


async def privacy_of(athlete_id: int) -> dict:
    row = await db.pool.fetchrow(
        "SELECT a.private, a.default_visibility, z.lat, z.lon, z.radius_m FROM athletes a"
        " LEFT JOIN privacy_zones z ON z.athlete_id = a.id WHERE a.id = $1", athlete_id)
    zone = None if row["radius_m"] is None else {"lat": row["lat"], "lon": row["lon"], "radius_m": row["radius_m"]}
    return {"private": row["private"], "default_visibility": row["default_visibility"], "privacy_zone": zone}


@authenticated
async def read_privacy(request: Request, me: dict) -> JSONResponse:
    return JSONResponse(await privacy_of(me["id"]))


def _coordinate(value, low: float, high: float) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and low <= value <= high


@authenticated
async def write_privacy(request: Request, me: dict) -> JSONResponse:
    body = await read_json(request)
    fields: dict[str, str] = {}
    private, visibility, zone = body.get("private"), body.get("default_visibility"), body.get("privacy_zone")
    if not isinstance(private, bool):
        fields["private"] = "private must be true or false"
    if visibility not in VISIBILITIES:
        fields["default_visibility"] = "default_visibility must be everyone, followers or only_me"
    if zone is not None and not (isinstance(zone, dict) and _coordinate(zone.get("lat"), -90, 90)
                                 and _coordinate(zone.get("lon"), -180, 180) and zone.get("radius_m") in RADII):
        fields["privacy_zone"] = "privacy_zone must be null or hold lat, lon and a radius_m of 200, 400, 800 or 1600"
    if fields:
        raise validation(fields)
    async with db.pool.acquire() as conn, conn.transaction():
        await conn.execute("UPDATE athletes SET private = $2, default_visibility = $3 WHERE id = $1",
                           me["id"], private, visibility)
        if zone is None:
            await conn.execute("DELETE FROM privacy_zones WHERE athlete_id = $1", me["id"])
        else:
            await conn.execute(
                "INSERT INTO privacy_zones (athlete_id, lat, lon, radius_m) VALUES ($1, $2, $3, $4)"
                " ON CONFLICT (athlete_id) DO UPDATE SET lat = $2, lon = $3, radius_m = $4",
                me["id"], float(zone["lat"]), float(zone["lon"]), zone["radius_m"])
    return JSONResponse(await privacy_of(me["id"]))


routes = [
    Route("/api/health", health, methods=["GET"]),
    Route("/api/auth/signup", signup, methods=["POST"]),
    Route("/api/auth/login", login, methods=["POST"]),
    Route("/api/auth/logout", logout, methods=["POST"]),
    Route("/api/me", read_me, methods=["GET"]),
    Route("/api/me", update_me, methods=["PATCH"]),
    Route("/api/me", delete_me, methods=["DELETE"]),
    Route("/api/me/privacy", read_privacy, methods=["GET"]),
    Route("/api/me/privacy", write_privacy, methods=["PUT"]),
]

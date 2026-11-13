"""Sessions, account settings and privacy settings."""
import re

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from psycopg import errors

from .. import auth, db
from ..domain.calendar import is_known_zone
from ..errors import ApiError
from .common import VISIBILITIES, athlete_json, read_json, require

router = APIRouter()

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$")
PRIVACY_RADII = (200, 400, 800, 1600)


def _session_response(payload: dict, token: str, status: int) -> JSONResponse:
    response = JSONResponse(payload, status_code=status)
    response.set_cookie(auth.SESSION_COOKIE, token, path="/", samesite="lax", max_age=60 * 60 * 24 * 30)
    return response


@router.post("/auth/signup")
async def signup(request: Request):
    body = await read_json(request)
    fields: dict = {}
    email = body.get("email")
    if not isinstance(email, str) or not EMAIL_PATTERN.match(email.strip()):
        fields["email"] = "must be a valid email address"
    name = body.get("name")
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
        fields["name"] = "must be 1 to 80 characters"
    password = body.get("password")
    if not isinstance(password, str) or len(password) < 8:
        fields["password"] = "must be at least 8 characters"
    require(fields)
    with db.connect() as conn:
        cursor = conn.cursor()
        try:
            with conn.transaction():
                cursor.execute(
                    """
                    INSERT INTO athletes (email, name, password_hash)
                    VALUES (%s, %s, %s) RETURNING *
                    """,
                    (email.strip(), name.strip(), auth.hash_password(password)),
                )
        except errors.UniqueViolation:
            raise ApiError(409, "email_taken")
        athlete = cursor.fetchone()
        token = auth.start_session(cursor, athlete["id"])
    return _session_response({"token": token, "athlete": athlete_json(athlete)}, token, 201)


@router.post("/auth/login")
async def login(request: Request):
    body = await read_json(request)
    email, password = body.get("email"), body.get("password")
    if not isinstance(email, str) or not isinstance(password, str):
        raise ApiError(401, "invalid_credentials")
    with db.connect() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT ath.*, (sub.id IS NOT NULL) AS subscriber
            FROM athletes ath LEFT JOIN subscriptions sub ON sub.athlete_id = ath.id
            WHERE lower(ath.email) = lower(%s)
            """,
            (email.strip(),),
        )
        athlete = cursor.fetchone()
        if athlete is None or not auth.verify_password(password, athlete["password_hash"]):
            raise ApiError(401, "invalid_credentials")
        token = auth.start_session(cursor, athlete["id"])
    return _session_response({"token": token, "athlete": athlete_json(athlete)}, token, 200)


@router.post("/auth/logout")
async def logout(request: Request):
    header = request.headers.get("authorization", "")
    token = header[7:].strip() if header.lower().startswith("bearer ") else request.cookies.get(auth.SESSION_COOKIE)
    auth.require_athlete(request)
    with db.cursor() as cursor:
        cursor.execute("DELETE FROM sessions WHERE token = %s", (token,))
    response = Response(status_code=204)
    response.delete_cookie(auth.SESSION_COOKIE, path="/")
    return response


@router.get("/me")
def read_me(athlete: dict = Depends(auth.require_athlete)):
    return {"athlete": athlete_json(athlete)}


@router.patch("/me")
async def update_me(request: Request, athlete: dict = Depends(auth.require_athlete)):
    body = await read_json(request)
    fields: dict = {}
    updates: dict = {}
    if "name" in body:
        name = body.get("name")
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
            fields["name"] = "must be 1 to 80 characters"
        else:
            updates["name"] = name.strip()
    if "time_zone" in body:
        time_zone = body.get("time_zone")
        if not isinstance(time_zone, str) or not is_known_zone(time_zone):
            fields["time_zone"] = "must be an IANA time zone name"
        else:
            updates["time_zone"] = time_zone
    require(fields)
    with db.cursor() as cursor:
        for field, value in updates.items():
            cursor.execute(f"UPDATE athletes SET {field} = %s WHERE id = %s", (value, athlete["id"]))
        cursor.execute("SELECT * FROM athletes WHERE id = %s", (athlete["id"],))
        stored = cursor.fetchone()
    stored["subscriber"] = athlete["subscriber"]
    return {"athlete": athlete_json(stored)}


@router.delete("/me")
async def delete_me(request: Request, athlete: dict = Depends(auth.require_athlete)):
    body = await read_json(request)
    password = body.get("password")
    if not isinstance(password, str) or not auth.verify_password(password, athlete["password_hash"]):
        raise ApiError(403, "wrong_password")
    with db.cursor() as cursor:
        cursor.execute("DELETE FROM athletes WHERE id = %s", (athlete["id"],))
    response = Response(status_code=204)
    response.delete_cookie(auth.SESSION_COOKIE, path="/")
    return response


def _privacy_json(athlete: dict, zone: dict | None) -> dict:
    return {
        "private": athlete["private"],
        "default_visibility": athlete["default_visibility"],
        "privacy_zone": None
        if zone is None
        else {"lat": zone["lat"], "lon": zone["lon"], "radius_m": zone["radius_m"]},
    }


@router.get("/me/privacy")
def read_privacy(athlete: dict = Depends(auth.require_athlete)):
    with db.cursor() as cursor:
        cursor.execute("SELECT * FROM privacy_zones WHERE athlete_id = %s", (athlete["id"],))
        return _privacy_json(athlete, cursor.fetchone())


@router.put("/me/privacy")
async def write_privacy(request: Request, athlete: dict = Depends(auth.require_athlete)):
    body = await read_json(request)
    fields: dict = {}
    private = body.get("private", athlete["private"])
    if not isinstance(private, bool):
        fields["private"] = "must be true or false"
    default_visibility = body.get("default_visibility", athlete["default_visibility"])
    if default_visibility not in VISIBILITIES:
        fields["default_visibility"] = f"must be one of {', '.join(VISIBILITIES)}"
    zone = body.get("privacy_zone", "absent")
    if zone != "absent" and zone is not None:
        if (
            not isinstance(zone, dict)
            or not isinstance(zone.get("lat"), (int, float))
            or not isinstance(zone.get("lon"), (int, float))
            or zone.get("radius_m") not in PRIVACY_RADII
            or not -90 <= zone.get("lat", 999) <= 90
            or not -180 <= zone.get("lon", 999) <= 180
        ):
            fields["privacy_zone"] = "needs a lat, a lon and a radius_m of 200, 400, 800 or 1600"
    require(fields)
    with db.cursor() as cursor:
        cursor.execute(
            "UPDATE athletes SET private = %s, default_visibility = %s WHERE id = %s RETURNING *",
            (private, default_visibility, athlete["id"]),
        )
        stored = cursor.fetchone()
        if zone != "absent":
            cursor.execute("DELETE FROM privacy_zones WHERE athlete_id = %s", (athlete["id"],))
            if zone is not None:
                cursor.execute(
                    "INSERT INTO privacy_zones (athlete_id, lat, lon, radius_m) VALUES (%s, %s, %s, %s)",
                    (athlete["id"], float(zone["lat"]), float(zone["lon"]), zone["radius_m"]),
                )
        cursor.execute("SELECT * FROM privacy_zones WHERE athlete_id = %s", (athlete["id"],))
        return _privacy_json(stored, cursor.fetchone())

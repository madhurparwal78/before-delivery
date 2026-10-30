"""Health, sign-in, the signed-in person and the display name."""

from __future__ import annotations

from flask import Blueprint, request

from .. import projections
from ..responses import api_response
from ..config import CONFIG
from ..db import execute, read_only, row, transaction
from ..domain.leave import holiday
from ..errors import ApiError
from ..passwords import verify_password
from ..timeutil import today_london
from ..workers import SERVICE_STATE
from .common import (
    PERSON_COLUMNS,
    SESSION_COOKIE,
    close_session,
    credentialed_home_ids,
    endpoint,
    open_session,
    read_body,
)

blueprint = Blueprint("session", __name__)

DISPLAY_NAME_MAX = 60


def me_payload(conn, person: dict) -> dict:
    return projections.me(
        person,
        holiday(conn, person, today_london()),
        credentialed_home_ids(conn, person),
    )


@blueprint.get("/api/health")
def health():
    with read_only() as conn:
        row(conn, "SELECT 1 AS alive")
    return api_response(
        {"status": "ok", "mail": SERVICE_STATE["mail"], "storage": SERVICE_STATE["storage"]}
    )


@blueprint.post("/api/session")
def sign_in():
    body = read_body("email", "password")
    email = body.get("email")
    password = body.get("password")
    person = None
    if isinstance(email, str) and isinstance(password, str):
        with read_only() as conn:
            person = row(
                conn,
                f"SELECT {PERSON_COLUMNS} FROM people WHERE lower(email) = lower(%s)",
                (email.strip(),),
            )
    if not person or not verify_password(password, person["password_hash"]):
        raise ApiError("invalid_credentials")
    with transaction() as conn:
        session_id = open_session(conn, person["id"])
        payload = {"user": me_payload(conn, person)}
    response = api_response(payload)
    response.set_cookie(
        SESSION_COOKIE,
        session_id,
        httponly=True,
        samesite="Lax",
        path="/",
        max_age=CONFIG.session_ttl_seconds,
    )
    return response


@blueprint.delete("/api/session")
@endpoint(write=True)
def sign_out(conn, person):
    close_session(conn, request.cookies.get(SESSION_COOKIE))
    response = api_response(None, 204)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response


@blueprint.get("/api/me")
@endpoint()
def read_me(conn, person):
    return api_response(me_payload(conn, person))


@blueprint.patch("/api/me")
@endpoint(write=True)
def rename_me(conn, person):
    body = read_body("display_name")
    display_name = body.get("display_name")
    if not isinstance(display_name, str) or not 1 <= len(display_name) <= DISPLAY_NAME_MAX:
        body.fail("display_name", "display_name")
    body.check()
    execute(
        conn, "UPDATE people SET display_name = %s WHERE id = %s", (display_name, person["id"])
    )
    person["display_name"] = display_name
    return api_response(me_payload(conn, person))

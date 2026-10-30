"""Shared API plumbing: sessions, role guards, visibility and body reading."""

from __future__ import annotations

import json
import uuid
from functools import wraps

from flask import Response, request

from ..bodies import Body
from ..config import CONFIG
from ..db import execute, read_only, row, rows, transaction
from ..domain import idempotency
from ..errors import ApiError
from ..responses import json_text, stored_response

SESSION_COOKIE = "tallow_session"
PERSON_COLUMNS = (
    "id, email, password_hash, display_name, role, home_id, unit_id, skill, entitlement_hours"
)


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex}"


def open_session(conn, person_id: str) -> str:
    session_id = new_id("ses")
    execute(
        conn,
        """INSERT INTO sessions (id, person_id, expires_at)
           VALUES (%s, %s, now() + make_interval(secs => %s))""",
        (session_id, person_id, CONFIG.session_ttl_seconds),
    )
    return session_id


def close_session(conn, session_id: str) -> None:
    execute(conn, "DELETE FROM sessions WHERE id = %s", (session_id,))


def signed_in_person(conn) -> dict:
    session_id = request.cookies.get(SESSION_COOKIE)
    if not session_id:
        raise ApiError("not_signed_in")
    found = row(
        conn,
        f"""SELECT {PERSON_COLUMNS} FROM people
            WHERE id = (SELECT person_id FROM sessions
                        WHERE id = %s AND expires_at > now())""",
        (session_id,),
    )
    if not found:
        raise ApiError("not_signed_in")
    return found


def endpoint(write: bool = False):
    """Wrap a handler with a connection and the signed-in person.

    Role guards stay inside the handlers, because the brief checks `forbidden`
    only after the not_found checks each handler makes for its own ids.
    """

    def decorate(handler):
        @wraps(handler)
        def wrapper(**kwargs):
            opener = transaction if write else read_only
            with opener() as conn:
                person = signed_in_person(conn)
                return handler(conn, person, **kwargs)

        return wrapper

    return decorate


def require_roles(person: dict, *roles: str) -> None:
    if person["role"] not in roles:
        raise ApiError("forbidden")


def read_body(*published: str) -> Body:
    """Parse a JSON write body and note any key the endpoint does not publish."""
    raw = request.get_data(cache=True)
    if raw:
        media_type = (request.mimetype or "").lower()
        if media_type != "application/json":
            raise ApiError("unsupported_media_type")
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ApiError("unsupported_media_type") from error
        if not isinstance(payload, dict):
            raise ApiError("unsupported_media_type")
    else:
        payload = {}
    return Body(payload, published)


def body_fingerprint_text() -> str:
    raw = request.get_data(cache=True)
    if not raw:
        return "{}"
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return raw.decode("utf-8", "replace")
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def begin_keyed(conn, person: dict, body: Body):
    """Claim the request's Idempotency-Key, handing back a replay when there is one."""
    key = idempotency.read_key(request.headers.get("Idempotency-Key"))
    if key is None:
        body.fail("Idempotency-Key", "idempotency_key")
        return None, None
    stored = idempotency.start(
        conn, person["id"], key, request.method, request.path, body_fingerprint_text()
    )
    if stored is None:
        return key, None
    return key, stored_response(*stored)


def finish_keyed(conn, person: dict, key: str | None, status: int, payload) -> Response:
    body = json_text(payload)
    if key is not None:
        idempotency.finish(conn, person["id"], key, status, body)
    response = Response(body, status=status, mimetype="application/json")
    response.headers["Cache-Control"] = "no-store"
    return response


def credentialed_home_ids(conn, person: dict) -> list[str]:
    if person["role"] != "bank_carer":
        return []
    return [
        record["home_id"]
        for record in rows(
            conn,
            "SELECT home_id FROM bank_credentials WHERE person_id = %s ORDER BY home_id",
            (person["id"],),
        )
    ]


def visible_home_ids(conn, person: dict) -> list[str]:
    """Each home is a tenant: HR sees every home, everyone else sees their own."""
    if person["role"] == "hr_admin":
        return [record["id"] for record in rows(conn, "SELECT id FROM homes ORDER BY id")]
    if person["role"] == "bank_carer":
        return credentialed_home_ids(conn, person)
    return [person["home_id"]] if person["home_id"] else []


def resolve_home(conn, person: dict, home_id: str) -> dict:
    home = row(conn, "SELECT id, name, manager_id FROM homes WHERE id = %s", (home_id,))
    if not home or home_id not in visible_home_ids(conn, person):
        raise ApiError("not_found")
    return home


def resolve_unit(conn, person: dict, unit_id: str) -> dict:
    unit = row(
        conn,
        """SELECT u.id, u.home_id, u.name, h.name AS home_name
           FROM units u JOIN homes h ON h.id = u.home_id WHERE u.id = %s""",
        (unit_id,),
    )
    if not unit or unit["home_id"] not in visible_home_ids(conn, person):
        raise ApiError("not_found")
    return unit


def home_units(conn, home_id: str) -> list[dict]:
    return rows(
        conn, "SELECT id, home_id, name FROM units WHERE home_id = %s ORDER BY name", (home_id,)
    )

"""The JSON API under `/api`."""

import json

from flask import Blueprint, Response, request

from . import (
    auth,
    config,
    db,
    domain,
    errors,
    messages,
    registrations,
    store,
    validation,
)
from .catalog import CATEGORY_NAME, CITY_NAME, GUEST_STATUSES
from .errors import MelaError

bp = Blueprint("api", __name__, url_prefix="/api")

EDIT_BODY = {**validation.EVENT_FIELD_TYPES, "registration_status": str}

EVENT_COLUMNS = {
    "name": "name",
    "description": "description",
    "start_at": "start_at",
    "end_at": "end_at",
    "timezone": "timezone",
    "location_type": "location_type",
    "venue_name": "venue_name",
    "street_address": "street_address",
    "city": "city",
    "virtual_link": "virtual_link",
    "visibility": "visibility",
    "require_approval": "require_approval",
    "capacity": "capacity",
    "waitlist": "waitlist",
    "theme": "theme",
    "categories": "categories",
    "show_guest_list": "show_guest_list",
}


def api_json(payload, status: int = 200, headers: dict | None = None) -> Response:
    response = Response(
        json.dumps(payload, ensure_ascii=False),
        status=status,
        headers=headers,
    )
    response.headers["Content-Type"] = "application/json; charset=utf-8"
    return response


def read_body(field_types: dict) -> dict:
    length = request.content_length
    if length is not None and length > config.MAX_BODY_BYTES:
        raise MelaError(413, "payload_too_large")
    raw = request.get_data(cache=False)
    if len(raw) > config.MAX_BODY_BYTES:
        raise MelaError(413, "payload_too_large")
    return validation.parse_body(raw, field_types)


def idempotency_key() -> str | None:
    key = request.headers.get("Idempotency-Key")
    if key is None:
        return None
    if not domain.is_valid_idempotency_key(key):
        raise MelaError(
            422,
            errors={
                "idempotency_key": (
                    "Idempotency-Key must be 1 to 64 letters, digits,"
                    " hyphens or underscores"
                )
            },
        )
    return key


def _event_or_404(conn, slug: str, viewer_id: int | None) -> dict:
    event = store.load_event(conn, slug, viewer_id)
    if event is None:
        raise errors.not_found()
    return event


def _hosted_event_or_404(conn, slug: str, member: dict) -> dict:
    event = _event_or_404(conn, slug, member["id"])
    if not event["is_host"]:
        raise errors.not_found()
    return event


def _followed_slugs(conn, member_id: int) -> set[str]:
    return {row["slug"] for row in store.followed_calendars(conn, member_id)}


def _mutation_body(conn, event: dict, result: dict, viewer_id: int) -> dict:
    return {
        "status": result["status"],
        "event": store.event_json(store.reload_event(conn, event["id"], viewer_id)),
        "promoted": result["promoted"],
    }


@bp.get("/health")
def health():
    db.start_keeper()
    if db.health_ready():
        return api_json({"status": "ok", "started_at": config.STARTED_AT_ISO})
    return api_json({"status": "unavailable"})


@bp.post("/auth/check")
def auth_check():
    with db.transaction() as conn:
        email = validation.check_email(read_body({"email": str}))
        row = conn.execute(
            "SELECT 1 FROM members WHERE email = %s", (email,)
        ).fetchone()
    return api_json({"exists": row is not None})


@bp.post("/auth/signup")
def auth_signup():
    with db.transaction() as conn:
        payload = read_body({"name": str, "email": str, "password": str})
        name, email, password = validation.check_signup(payload)
        if conn.execute(
            "SELECT 1 FROM members WHERE email = %s", (email,)
        ).fetchone():
            raise MelaError(409, "email_taken")
        member = conn.execute(
            "INSERT INTO members (email, name, password_hash) VALUES (%s, %s, %s)"
            " RETURNING id, name, email",
            (email, name, auth.hash_password(password)),
        ).fetchone()
        token = auth.new_session(conn, member["id"])
    response = api_json({"user": dict(member), "token": token}, 201)
    auth.set_session_cookie(response, token)
    return response


@bp.post("/auth/signin")
def auth_signin():
    with db.transaction() as conn:
        email, password = validation.credentials(
            read_body({"email": str, "password": str})
        )
        row = conn.execute(
            "SELECT id, name, email, password_hash FROM members WHERE email = %s",
            (email,),
        ).fetchone()
        if row is None or not auth.password_matches(row["password_hash"], password):
            raise MelaError(401, "invalid_credentials")
        token = auth.new_session(conn, row["id"])
    user = {"id": row["id"], "name": row["name"], "email": row["email"]}
    response = api_json({"user": user, "token": token})
    auth.set_session_cookie(response, token)
    return response


@bp.post("/auth/signout")
def auth_signout():
    with db.transaction() as conn:
        auth.require_member(conn)
        read_body({})
        auth.end_session(conn, auth.request_token())
    response = Response(status=204)
    auth.clear_session_cookie(response)
    return response


@bp.get("/me")
def me():
    with db.transaction() as conn:
        member = auth.require_member(conn)
    return api_json({"user": dict(member)})


@bp.get("/discover")
def discover():
    place = request.args.get("place") or None
    category = request.args.get("category") or None
    if place is not None and place not in CITY_NAME:
        raise errors.not_found()
    if category is not None and category not in CATEGORY_NAME:
        raise errors.not_found()
    with db.transaction() as conn:
        events = store.upcoming_events(
            conn, CITY_NAME[place] if place else None, category
        )
        payload = {
            "places": store.city_counts(conn),
            "categories": store.category_counts(conn),
            "events": [_event_row_json(row) for row in events],
        }
    return api_json(payload)


def _event_row_json(row: dict) -> dict:
    return {
        "slug": row["slug"],
        "name": row["name"],
        "start_at": domain.iso_utc(row["start_at"]),
        "end_at": domain.iso_utc(row["end_at"]),
        "timezone": row["timezone"],
        "city": row["city"],
        "venue_name": row["venue_name"],
        "theme": row["theme"],
        "categories": list(row["categories"]),
    }


@bp.get("/categories")
def categories():
    with db.transaction() as conn:
        return api_json(store.category_counts(conn))


@bp.get("/calendars")
def calendars():
    with db.transaction() as conn:
        rows = store.calendars(conn)
    return api_json(
        [
            {
                "slug": row["slug"],
                "name": row["name"],
                "description": row["description"],
                "city": row["city"],
                "follower_count": row["follower_count"],
            }
            for row in rows
        ]
    )


@bp.get("/events/<slug>")
def get_event(slug):
    with db.transaction() as conn:
        member = auth.current_member(conn)
        event = _event_or_404(conn, slug, member["id"] if member else None)
    return api_json(store.event_json(event))


@bp.post("/events")
def create_event():
    with db.transaction() as conn:
        member = auth.require_member(conn)
        payload = read_body(validation.EVENT_FIELD_TYPES)
        values = validation.check_event_fields(
            payload, None, _followed_slugs(conn, member["id"])
        )
        stored = {**validation.EVENT_DEFAULTS, **values}
        calendar_id = _calendar_id(conn, stored.pop("calendar"))
        slug = store.new_slug(conn)
        columns = [EVENT_COLUMNS[field] for field in stored]
        placeholders = ", ".join(["%s"] * (len(columns) + 3))
        conn.execute(
            f"INSERT INTO events ({', '.join(columns)}, slug, calendar_id, host_id)"
            f" VALUES ({placeholders})",
            (*stored.values(), slug, calendar_id, member["id"]),
        )
        event = store.load_event(conn, slug, member["id"])
    return api_json(store.event_json(event), 201)


def _calendar_id(conn, slug: str | None) -> int | None:
    if slug is None:
        return None
    row = conn.execute(
        "SELECT id FROM calendars WHERE slug = %s", (slug,)
    ).fetchone()
    return row["id"]


@bp.patch("/events/<slug>")
def edit_event(slug):
    with db.transaction() as conn:
        member = auth.require_member(conn)
        event = _hosted_event_or_404(conn, slug, member)
        payload = read_body(EDIT_BODY)
        registrations.lock_event(conn, event["id"])
        event = store.reload_event(conn, event["id"], member["id"])
        values = validation.check_event_fields(
            payload, event, _followed_slugs(conn, member["id"])
        )
        if "registration_status" in payload:
            values["registration_status"] = validation.check_registration_status(
                event, payload["registration_status"]
            )
        if "capacity" in values:
            refusal = registrations.capacity_floor_refusal(
                conn, event, values["capacity"]
            )
            if refusal is not None:
                raise errors.from_refusal(refusal)
        _write_event(conn, event, values)
        fresh = store.reload_event(conn, event["id"], member["id"])
        if "capacity" in values and values["capacity"] != event["capacity"]:
            registrations.promote_waiting(conn, fresh)
            fresh = store.reload_event(conn, event["id"], member["id"])
    return api_json(store.event_json(fresh))


def _write_event(conn, event: dict, values: dict) -> None:
    """Only the fields a request carries are written."""
    assignments = []
    params: list = []
    for field, value in values.items():
        if field == "calendar":
            assignments.append("calendar_id = %s")
            params.append(_calendar_id(conn, value))
            continue
        column = EVENT_COLUMNS.get(field, field)
        assignments.append(f"{column} = %s")
        params.append(value)
    if not assignments:
        return
    params.append(event["id"])
    conn.execute(
        f"UPDATE events SET {', '.join(assignments)} WHERE id = %s", tuple(params)
    )


@bp.post("/events/<slug>/register")
def register(slug):
    with db.transaction() as conn:
        member = auth.require_member(conn)
        event = _event_or_404(conn, slug, member["id"])
        payload = read_body({"access_code": str})
        registrations.lock_event(conn, event["id"])
        event = store.reload_event(conn, event["id"], member["id"])
        result = registrations.register(
            conn, event, member["id"], payload.get("access_code")
        )
        body = (
            None
            if "code" in result
            else _mutation_body(conn, event, result, member["id"])
        )
    if body is None:
        raise errors.from_refusal(result)
    return api_json(body, result["http"])


@bp.delete("/events/<slug>/register")
def cancel_registration(slug):
    with db.transaction() as conn:
        member = auth.require_member(conn)
        event = _event_or_404(conn, slug, member["id"])
        read_body({})
        registrations.lock_event(conn, event["id"])
        event = store.reload_event(conn, event["id"], member["id"])
        result = registrations.cancel(conn, event, member["id"])
        body = (
            None
            if "code" in result
            else _mutation_body(conn, event, result, member["id"])
        )
    if body is None:
        raise errors.from_refusal(result)
    return api_json(body)


@bp.get("/events/<slug>/guests")
def guests(slug):
    status = request.args.get("status") or None
    with db.transaction() as conn:
        member = auth.require_member(conn)
        event = _hosted_event_or_404(conn, slug, member)
        if status is not None and status not in GUEST_STATUSES:
            raise MelaError(422, errors={"status": "Choose a known status"})
        rows = store.guest_list(conn, event["id"], status)
    return api_json(
        [
            {
                "id": row["id"],
                "name": row["name"],
                "email": row["email"],
                "status": row["status"],
                "requested_at": domain.iso_utc(row["requested_at"]),
                "waitlist_position": row["waitlist_position"],
            }
            for row in rows
        ]
    )


@bp.post("/events/<slug>/guests/<raw_guest_id>")
def decide_guest(slug, raw_guest_id):
    guest_id = domain.guest_id_from_path(raw_guest_id)
    with db.transaction() as conn:
        member = auth.require_member(conn)
        event = _hosted_event_or_404(conn, slug, member)
        if guest_id is None:
            raise errors.not_found()
        registrations.lock_event(conn, event["id"])
        event = store.reload_event(conn, event["id"], member["id"])
        guest = registrations.find_guest(conn, event["id"], guest_id)
        if guest is None:
            raise errors.not_found()
        action = read_body({"action": str}).get("action")
        if action not in domain.HOST_ACTIONS:
            raise MelaError(
                422, errors={"action": "Choose approve, decline or remove"}
            )
        result = registrations.host_decision(conn, event, guest, action)
        if "code" in result:
            raise errors.from_refusal(result)
        body = _mutation_body(conn, event, result, member["id"])
    return api_json(body)


@bp.get("/me/events")
def my_events():
    tab = request.args.get("tab") or "upcoming"
    with db.transaction() as conn:
        member = auth.require_member(conn)
        if tab not in ("upcoming", "past"):
            raise MelaError(422, errors={"tab": "Choose upcoming or past"})
        rows = store.my_events(conn, member["id"], tab)
    return api_json(
        [
            {
                "slug": row["slug"],
                "name": row["name"],
                "start_at": domain.iso_utc(row["start_at"]),
                "end_at": domain.iso_utc(row["end_at"]),
                "pill": row["pill"],
            }
            for row in rows
        ]
    )


@bp.put("/calendars/<slug>/follow")
def follow(slug):
    return _set_follow(slug, True)


@bp.delete("/calendars/<slug>/follow")
def unfollow(slug):
    return _set_follow(slug, False)


def _set_follow(slug: str, following: bool) -> Response:
    with db.transaction() as conn:
        member = auth.require_member(conn)
        calendar = store.load_calendar(conn, slug, member["id"])
        if calendar is None:
            raise errors.not_found()
        read_body({})
        if following:
            conn.execute(
                "INSERT INTO follows (member_id, calendar_id) VALUES (%s, %s)"
                " ON CONFLICT DO NOTHING",
                (member["id"], calendar["id"]),
            )
        else:
            conn.execute(
                "DELETE FROM follows WHERE member_id = %s AND calendar_id = %s",
                (member["id"], calendar["id"]),
            )
        count = conn.execute(
            "SELECT count(*) AS n FROM follows WHERE calendar_id = %s",
            (calendar["id"],),
        ).fetchone()
    return api_json({"following": following, "follower_count": int(count["n"])})


@bp.post("/events/<slug>/contact")
def contact_host(slug):
    return _send_once("contact", slug, {"message": str})


@bp.post("/events/<slug>/report")
def report_event(slug):
    return _send_once("report", slug, {"reason": str, "details": str})


def _send_once(kind: str, slug: str, field_types: dict) -> Response:
    with db.transaction() as conn:
        member = auth.require_member(conn)
        event = _event_or_404(conn, slug, member["id"])
        key = idempotency_key()
        payload = read_body(field_types)
        if key is not None:
            kept = messages.remembered(conn, kind, member["id"], event["id"], key)
            if kept is not None:
                if kept["request_body"] != payload:
                    raise MelaError(422, "idempotency_key_reused")
                return api_json({"id": kept["id"]}, 201)
        if kind == "contact":
            values = {"message": validation.check_message(payload)}
        else:
            reason, details = validation.check_report(payload)
            values = {"reason": reason, "details": details}
        new_id, conflicting = messages.store(
            conn, kind, member["id"], event["id"], key, payload, values
        )
        if conflicting is not None and conflicting != payload:
            raise MelaError(422, "idempotency_key_reused")
    return api_json({"id": new_id}, 201)

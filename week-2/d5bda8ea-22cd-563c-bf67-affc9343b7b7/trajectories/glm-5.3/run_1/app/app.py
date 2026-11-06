"""The Mela Flask application."""

import datetime as dt
import hashlib
import re
import secrets
import urllib.parse

import psycopg
from flask import (Flask, Response, abort, g, jsonify, make_response, redirect,
                   render_template, request, send_from_directory)
from werkzeug.exceptions import HTTPException

import db
import events as ev
from icons import Icons
from helpers import (ApiError, BodyError, CATEGORY_LABELS, MAX_BODY_BYTES,
                     IDEMPOTENCY_KEY_MESSAGE, MONTHS_SHORT,
                     REGISTRATION_STATUSES, REPORT_REASONS,
                     body_hash, bool_field, countdown_text, datetime_field,
                     days_since, encode_next, env_seconds, idempotency_key_valid,
                     initials, int_or_null_field, iso_utc, local_time,
                     long_date, name_list, ordinal, plural,
                     safe_next, short_start, slug_chars, string_array_field,
                     string_field, string_or_null_field, text_field, time_range,
                     utcnow, valid_email, validation_error, read_body)
from db import CATEGORIES

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False
app.jinja_env.globals["icons"] = Icons

SESSION_COOKIE = "mela_session"
ACCESS_CODE_WINDOW = env_seconds("MELA_ACCESS_CODE_WINDOW_SECONDS", 900)
IDEMPOTENCY_RETENTION = env_seconds("MELA_IDEMPOTENCY_RETENTION_SECONDS", 86400)

SERVE_STARTED_AT = utcnow().isoformat()


# --------------------------------------------------------------------------
# Database availability
# --------------------------------------------------------------------------

def db_ready():
    return db.ensure_ready(timeout=0)


def require_handle():
    """A handle for API requests: raises the outage 503 when unavailable."""
    if not db_ready():
        raise ApiError(503, "service_unavailable")
    try:
        return db.pool.handle()
    except Exception:
        raise ApiError(503, "service_unavailable")


# --------------------------------------------------------------------------
# Errors — one shared path
# --------------------------------------------------------------------------

def api_not_found(_error=None):
    return jsonify({"error": "not_found"}), 404


@app.errorhandler(ApiError)
def handle_api_error(error):
    return error.response()


@app.errorhandler(BodyError)
def handle_body_error(error):
    return error.payload


@app.errorhandler(HTTPException)
def handle_http_exception(error):
    if request.path.startswith("/api/"):
        if not db_ready():
            return jsonify({"error": "service_unavailable"}), 503, {"Retry-After": "5"}
        if error.code == 404:
            return api_not_found()
        if error.code == 405:
            return jsonify({"error": "method_not_allowed"}), 405
        if error.code == 413:
            return jsonify({"error": "payload_too_large"}), 413
        return jsonify({"error": error.name.lower().replace(" ", "_")}), error.code
    if error.code == 404:
        return render_template("not_found.html"), 404
    if error.code == 405:
        return render_template("not_found.html"), 404
    return error


@app.errorhandler(Exception)
def handle_unexpected(error):
    if isinstance(error, (psycopg.OperationalError, psycopg.InterfaceError)):
        db._ready.clear()
        if request.path.startswith("/api/"):
            return jsonify({"error": "service_unavailable"}), 503, {"Retry-After": "5"}
        return render_template("outage.html"), 503
    app.logger.exception("unhandled error")
    if request.path.startswith("/api/"):
        return jsonify({"error": "server_error"}), 500
    return render_template("not_found.html"), 500


# --------------------------------------------------------------------------
# Origin, caching and request shaping
# --------------------------------------------------------------------------

@app.before_request
def enforce_origin():
    """Requests that change state are accepted only from the app's origin."""
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return None
    for header in ("Origin", "Referer"):
        value = request.headers.get(header)
        if not value:
            continue
        try:
            parsed = urllib.parse.urlparse(value)
        except ValueError:
            return jsonify({"error": "forbidden"}), 403
        if parsed.netloc != request.host:
            return jsonify({"error": "forbidden"}), 403
    return None


@app.before_request
def refuse_oversized_body():
    """A body over the size limit is refused before any other rule."""
    if not request.path.startswith("/api/"):
        return None
    length = request.content_length
    if length is not None and length > MAX_BODY_BYTES:
        return jsonify({"error": "payload_too_large"}), 413
    if length is None and request.get_data(cache=False) and \
            len(request.get_data()) > MAX_BODY_BYTES:
        return jsonify({"error": "payload_too_large"}), 413
    return None


@app.after_request
def apply_caching(response):
    """No event response may be stored by any cache."""
    path = request.path
    if (path.startswith("/api/events/") or path.startswith("/api/me")
            or path == "/home" or path.startswith("/manage/")):
        response.headers["Cache-Control"] = "private, no-store"
        response.headers["Vary"] = "Cookie, Authorization"
    return response


# --------------------------------------------------------------------------
# Sessions
# --------------------------------------------------------------------------

def issue_session(handle, member_id):
    token = secrets.token_urlsafe(32)
    handle.execute(
        "INSERT INTO sessions (token_hash, member_id, created_at) VALUES (%s, %s, now())",
        (hashlib.sha256(token.encode()).hexdigest(), member_id))
    return token


def current_member(handle):
    """The signed-in member as (id, name, email), or None."""
    token = None
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:].strip()
    cookie = request.cookies.get(SESSION_COOKIE)
    if not token and cookie:
        token = cookie
    if not token:
        return None
    row = handle.one(
        "SELECT s.token_hash, m.id, m.name, m.email FROM sessions s JOIN members m ON m.id = s.member_id WHERE s.token_hash = %s",
        (hashlib.sha256(token.encode()).hexdigest(),))
    if row is None:
        return None
    g.session_token = token
    return row[1], row[2], row[3]


def viewer(handle):
    """(member_id, viewer_status_cache) or (None, None)."""
    member = current_member(handle)
    if member is None:
        return None
    return member


def member_or_401(handle):
    member = current_member(handle)
    if member is None:
        raise ApiError(401, "unauthenticated")
    return member


def signout_now(handle):
    token = getattr(g, "session_token", None)
    if token:
        handle.execute("DELETE FROM sessions WHERE token_hash = %s",
                       (hashlib.sha256(token.encode()).hexdigest(),))


def set_session_cookie(response, token):
    response.set_cookie(SESSION_COOKIE, token, httponly=True, samesite="Lax",
                        path="/", max_age=60 * 60 * 24 * 30)
    return response


def clear_session_cookie(response):
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response


# --------------------------------------------------------------------------
# Accounts and sessions
# --------------------------------------------------------------------------

def hash_password(password):
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000)
    return f"pbkdf2_sha256${salt}${digest.hex()}"


def verify_password(password, stored):
    try:
        _scheme, salt, digest = stored.split("$", 2)
    except ValueError:
        return False
    candidate = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(),
                                    200_000).hex()
    return secrets.compare_digest(candidate, digest)


def member_payload(row):
    return {"id": row[0], "name": row[1], "email": row[2]}


@app.route("/api/auth/check", methods=["POST"])
def auth_check():
    with require_handle() as h:
        data = read_body({"email": string_field()})
        email = data["email"].strip().lower()
        if not valid_email(email):
            raise BodyError(validation_error({"email": "Enter a valid email"}))
        row = h.one("SELECT id FROM members WHERE email = %s", (email,))
        return jsonify({"exists": row is not None})


@app.route("/api/auth/signup", methods=["POST"])
def auth_signup():
    with require_handle() as h:
        data = read_body({
            "name": text_field(max_len=80),
            "email": string_field(),
            "password": string_field(min_len=1),
        })
        errors = {}
        name = data["name"].strip()
        email = data["email"].strip().lower()
        password = data["password"]
        if not valid_email(email):
            errors["email"] = "Enter a valid email"
        if not name:
            errors["name"] = "Enter your name"
        if len(password) < 8:
            errors["password"] = "Password must be at least 8 characters"
        if len(password) > 200:
            errors["password"] = "Password must be at most 200 characters"
        if errors:
            raise BodyError(validation_error(errors))
        existing = h.one("SELECT id FROM members WHERE email = %s", (email,))
        if existing is not None:
            raise ApiError(409, "email_taken")
        row = h.one(
            """INSERT INTO members (email, name, password_hash)
               VALUES (%s, %s, %s) RETURNING id, name, email""",
            (email, name, hash_password(password)))
        token = issue_session(h, row[0])
        response = jsonify({"user": member_payload(row), "token": token})
        return set_session_cookie(response, token), 201


@app.route("/api/auth/signin", methods=["POST"])
def auth_signin():
    with require_handle() as h:
        data = read_body({
            "email": string_field(),
            "password": string_field(),
        })
        email = data["email"].strip().lower()
        password = data["password"]
        row = h.one(
            "SELECT id, name, email, password_hash FROM members WHERE email = %s",
            (email,))
        if row is None or not verify_password(password, row[3]):
            raise ApiError(401, "invalid_credentials")
        token = issue_session(h, row[0])
        response = jsonify({"user": {"id": row[0], "name": row[1], "email": row[2]},
                            "token": token})
        return set_session_cookie(response, token), 200


@app.route("/api/auth/signout", methods=["POST"])
def auth_signout():
    with require_handle() as h:
        member_or_401(h)
        signout_now(h)
        return clear_session_cookie(Response(status=204))


@app.route("/api/me")
def me():
    with require_handle() as h:
        member = member_or_401(h)
        return jsonify({"user": {"id": member[0], "name": member[1],
                                 "email": member[2]}})

# --------------------------------------------------------------------------
# Discovery
# --------------------------------------------------------------------------

def discover_payload(h, member_id):
    """City and category tiles, counting only upcoming public events."""
    places = []
    for slug, name in db.CITIES:
        count = h.one(
            """SELECT count(*) FROM events
               WHERE city = %s AND visibility = 'public' AND end_at > now()""",
            (name,))[0]
        places.append({"slug": slug, "name": name, "event_count": count})
    categories = []
    for slug in CATEGORIES:
        count = h.one(
            """SELECT count(*) FROM events
               WHERE visibility = 'public' AND end_at > now()
                 AND %s = ANY(categories)""", (slug,))[0]
        categories.append({"slug": slug, "name": CATEGORY_LABELS[slug],
                          "event_count": count})
    return {"places": places, "categories": categories}


def discover_events(h, place_slug=None, category_slug=None, limit=None):
    """Upcoming public events, soonest first, filtered by city and category."""
    sql = ev.EVENT_SELECT + " WHERE visibility = 'public' AND end_at > now()"
    params = []
    if place_slug:
        city = db.CITY_NAMES.get(place_slug)
        if city is None:
            return None
        sql += " AND city = %s"
        params.append(city)
    if category_slug:
        if category_slug not in CATEGORIES:
            return None
        sql += " AND %s = ANY(categories)"
        params.append(category_slug)
    sql += " ORDER BY start_at, id"
    if limit:
        sql += " LIMIT %s"
        params.append(limit)
    return h.all(sql, tuple(params))


def event_card(row):
    """A discover list entry: no address fields ever leave this shape."""
    return {
        "slug": ev.row_field(row, "slug"),
        "name": ev.row_field(row, "name"),
        "start_at": iso_utc(ev.row_field(row, "start_at")),
        "end_at": iso_utc(ev.row_field(row, "end_at")),
        "timezone": ev.row_field(row, "timezone"),
        "city": ev.row_field(row, "city"),
        "venue_name": ev.row_field(row, "venue_name"),
        "theme": ev.row_field(row, "theme"),
        "categories": list(ev.row_field(row, "categories") or []),
    }


@app.route("/api/discover")
def api_discover():
    with require_handle() as h:
        payload = discover_payload(h, None)
        place = request.args.get("place") or None
        category = request.args.get("category") or None
        rows = discover_events(h, place, category)
        if rows is None:
            raise ApiError(404, "not_found")
        payload["events"] = [event_card(r) for r in rows]
        return jsonify(payload)


@app.route("/api/categories")
def api_categories():
    with require_handle() as h:
        categories = []
        for slug in CATEGORIES:
            count = h.one(
                """SELECT count(*) FROM events
                   WHERE visibility = 'public' AND end_at > now()
                     AND %s = ANY(categories)""", (slug,))[0]
            categories.append({"slug": slug, "name": CATEGORY_LABELS[slug],
                              "event_count": count})
        return jsonify(categories)


@app.route("/api/calendars")
def api_calendars():
    with require_handle() as h:
        rows = h.all(
            """SELECT c.slug, c.name, c.description, c.city,
                      (SELECT count(*) FROM follows f WHERE f.calendar_slug = c.slug)
               FROM calendars c ORDER BY c.slug""")
        return jsonify([{"slug": r[0], "name": r[1], "description": r[2],
                         "city": r[3], "follower_count": r[4]} for r in rows])


@app.route("/api/calendars/<slug>/follow", methods=["PUT", "DELETE"])
def api_follow(slug):
    with require_handle() as h:
        member = member_or_401(h)
        read_body({})
        calendar = h.one("SELECT slug FROM calendars WHERE slug = %s", (slug,))
        if calendar is None:
            raise ApiError(404, "not_found")
        with h.conn.transaction():
            h.conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))",
                           ("follow:" + slug,))
            if request.method == "PUT":
                h.execute(
                    """INSERT INTO follows (member_id, calendar_slug)
                       VALUES (%s, %s) ON CONFLICT DO NOTHING""",
                    (member[0], slug))
                following = True
            else:
                h.execute(
                    """DELETE FROM follows
                       WHERE member_id = %s AND calendar_slug = %s""",
                    (member[0], slug))
                following = False
            count = h.one(
                "SELECT count(*) FROM follows WHERE calendar_slug = %s", (slug,))[0]
        return jsonify({"following": following, "follower_count": count})


# --------------------------------------------------------------------------
# Events
# --------------------------------------------------------------------------

@app.route("/api/events/<slug>")
def api_get_event(slug):
    with require_handle() as h:
        member = current_member(h)
        event = ev.load_event_or_404(h, slug)
        return jsonify(ev.serialize_event(h, event, member[0] if member else None))


def unique_slug(h):
    while True:
        candidate = slug_chars(8)
        if h.one("SELECT 1 FROM events WHERE slug = %s", (candidate,)) is None:
            return candidate


EVENT_BODY_SPEC = {
    "name": string_field(),
    "description": string_field(),
    "start_at": datetime_field,
    "end_at": datetime_field,
    "timezone": string_field(),
    "location_type": string_field(),
    "venue_name": string_or_null_field,
    "street_address": string_or_null_field,
    "city": string_or_null_field,
    "virtual_link": string_or_null_field,
    "visibility": string_field(),
    "require_approval": bool_field,
    "capacity": int_or_null_field,
    "waitlist": bool_field,
    "theme": string_field(),
    "categories": string_array_field,
    "calendar": string_or_null_field,
    "show_guest_list": bool_field,
}


def validate_and_shape_event(h, data, existing=None, member_id=None):
    """Field rules for create and edit; returns {field: message}."""
    errors = ev.validate_event_fields(data, existing)
    calendar = data.get("calendar", "__missing__")
    if calendar not in ("__missing__", None, ""):
        row = h.one(
            """SELECT 1 FROM follows f
               JOIN calendars c ON c.slug = f.calendar_slug
               WHERE f.calendar_slug = %s AND f.member_id = %s""",
            (calendar, member_id))
        if row is None:
            errors["calendar"] = "Follow the community calendar to add your event to it"
    return errors


def apply_event_defaults(data, create_defaults=None):
    """Defaults for omitted fields on create."""
    defaults = {
        "description": "", "timezone": "Asia/Kolkata", "location_type": "offline",
        "visibility": "public", "require_approval": False, "capacity": None,
        "waitlist": False, "theme": "amber", "categories": [],
        "calendar": None, "show_guest_list": True,
    }
    for key, value in defaults.items():
        data.setdefault(key, value)
    return data


@app.route("/api/events", methods=["POST"])
def api_create_event():
    with require_handle() as h:
        member = member_or_401(h)
        data = read_body(dict(EVENT_BODY_SPEC))
        data = apply_event_defaults(data)
        errors = validate_and_shape_event(h, data, member_id=member[0])
        if "name" not in data:
            errors["name"] = "Name is required"
        if errors:
            raise BodyError(validation_error(errors))
        with h.conn.transaction():
            h.conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))",
                           ("slug:" + data["name"],))
            slug = unique_slug(h)
            h.execute(
                """INSERT INTO events (slug, name, description, start_at, end_at,
                       timezone, location_type, venue_name, street_address, city,
                       virtual_link, visibility, require_approval, capacity, waitlist,
                       registration_status, theme, categories, calendar_slug,
                       show_guest_list, host_id)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'open',%s,%s,%s,%s,%s)""",
                (slug, data["name"].strip(), data["description"].strip(),
                 data["start_at"], data["end_at"], data["timezone"],
                 data["location_type"], data.get("venue_name"),
                 data.get("street_address"), data.get("city"),
                 data.get("virtual_link"), data["visibility"],
                 data["require_approval"], data["capacity"], data["waitlist"],
                 data["theme"], data["categories"], data["calendar"],
                 data["show_guest_list"], member[0]))
        event = ev.load_event(h, slug)
        return jsonify(ev.serialize_event(h, event, member[0])), 201


@app.route("/api/events/<slug>", methods=["PATCH"])
def api_edit_event(slug):
    with require_handle() as h:
        member = member_or_401(h)
        spec = dict(EVENT_BODY_SPEC)
        spec["registration_status"] = string_field()
        data = read_body(spec)
        return edit_event(h, member, slug, data)


def edit_event(h, member, slug, data):
    """PATCH writes only the fields the request carries."""
    event = ev.load_event_or_404(h, slug)
    existing = ev.as_dict(event)
    if existing["host_id"] != member[0]:
        raise ApiError(404, "not_found")

    with h.conn.transaction():
        h.conn.execute("SELECT pg_advisory_xact_lock(%s)", (existing["id"],))

        requested_status = data.get("registration_status")
        if requested_status is not None and \
                requested_status not in ("open", "closed", "code_only"):
            raise BodyError(validation_error(
                {"registration_status": "Expected one of: open, closed, code_only"}))

        merged = {}
        for key in ev.EDITABLE_FIELDS:
            if key in data:
                merged[key] = data[key]
            else:
                merged[key] = existing[_STORAGE_NAME.get(key, key)]

        errors = validate_and_shape_event(h, data, merged, member_id=member[0])

        going, waiting = ev.event_counts(h, existing["id"])
        if "capacity" in data and data["capacity"] is not None and \
                1 <= data["capacity"] <= 10000 and data["capacity"] < going:
            errors["capacity"] = ev.capacity_floor_message(going)

        status_target = ev.registration_status_target(
            existing["registration_status"], requested_status,
            bool(existing["access_code"]))
        if status_target == "invalid":
            errors["registration_status"] = "Cannot move registration to that status"

        if errors:
            raise BodyError(validation_error(errors))

        promoted = []
        new_capacity = data.get("capacity", existing["capacity"])
        if "capacity" in data and (new_capacity is None or
                                   (existing["capacity"] is not None and
                                    new_capacity > existing["capacity"])):
            if new_capacity is None:
                promoted = ev.promote_from_waitlist(h, event, 10 ** 9)
            else:
                places = ev.free_places(new_capacity, going)
                if places:
                    promoted = ev.promote_from_waitlist(h, event, places)

        assignments = []
        params = []
        for key in ev.EDITABLE_FIELDS:
            if key not in data:
                continue
            value = data[key]
            column = _STORAGE_NAME.get(key, key)
            if key in ("name", "description"):
                value = value.strip()
            assignments.append(f"{column} = %s")
            params.append(value)
        if status_target is not None:
            assignments.append("registration_status = %s")
            params.append(status_target)
        if assignments:
            params.append(slug)
            h.execute("UPDATE events SET " + ", ".join(assignments) +
                      " WHERE slug = %s", tuple(params))

    event = ev.load_event(h, slug)
    result = ev.after_change_counts(h, event, member[0], promoted)
    return jsonify(result["event"])


_STORAGE_NAME = {"calendar": "calendar_slug"}


# --------------------------------------------------------------------------
# Registrations and the guest list
# --------------------------------------------------------------------------

@app.route("/api/events/<slug>/register", methods=["POST"])
def api_register(slug):
    with require_handle() as h:
        member = member_or_401(h)
        data = read_body({"access_code": string_field()})
        return register_member(h, member, slug, data)


def register_member(h, member, slug, data):
    event = ev.load_event_or_404(h, slug)
    existing_event = ev.as_dict(event)
    with h.conn.transaction():
        h.conn.execute("SELECT pg_advisory_xact_lock(%s)", (existing_event["id"],))

        reg = h.one(
            "SELECT id, status FROM registrations WHERE event_id = %s AND member_id = %s",
            (existing_event["id"], member[0]))
        if reg is not None and reg[1] in ("pending", "approved", "waitlisted", "declined"):
            counts = ev.event_counts(h, existing_event["id"])
            status, position = ev.viewer_registration(h, existing_event["id"], member[0])
            event_obj = ev.serialize_event(h, event, member[0], viewer_status=status,
                                            viewer_wait=position, counts=counts)
            return jsonify({"status": reg[1], "event": event_obj, "promoted": []})

        if member[0] == existing_event["host_id"]:
            raise ApiError(409, "host_cannot_register")
        now = utcnow()
        if now >= existing_event["end_at"]:
            raise ApiError(403, "event_ended")
        if existing_event["registration_status"] == "closed":
            raise ApiError(403, "registration_closed")

        if existing_event["registration_status"] == "code_only":
            code = data.get("access_code")
            supplied = code.strip() if isinstance(code, str) else ""
            expected = existing_event["access_code"] or ""
            if not supplied:
                raise ApiError(403, "access_code_required")
            refusal = _check_access_code(h, member[0], existing_event["id"],
                                         supplied, expected)
            if refusal is not None:
                raise refusal

        counts = ev.event_counts(h, existing_event["id"])
        waiting = counts[1]
        status = ev.register_decision(event, waiting > 0, counts)

        queued_at = utcnow() if status == "waitlisted" else None
        if reg is None:
            h.execute(
                """INSERT INTO registrations (event_id, member_id, status, queued_at)
                   VALUES (%s, %s, %s, %s)""",
                (existing_event["id"], member[0], status, queued_at))
        else:
            h.execute(
                """UPDATE registrations
                   SET status = %s, requested_at = now(), queued_at = %s
                   WHERE id = %s""", (status, queued_at, reg[0]))
        if existing_event["registration_status"] == "code_only":
            h.execute("DELETE FROM access_code_attempts WHERE member_id = %s AND event_id = %s",
                      (member[0], existing_event["id"]))

    result = ev.after_change_counts(h, event, member[0], [])
    return jsonify(result), 201


def _check_access_code(h, member_id, event_id, supplied, expected):
    """The access-code limit in one place: a missing code never counts, a
    wrong code counts one failure, and five failures inside the window lock
    the member out of the event, even with the right code. The count is kept
    in PostgreSQL and updated atomically, so it holds across instances; it is
    committed on its own connection so it survives this request's refusal."""
    if not supplied:
        raise ApiError(403, "access_code_required")
    count_failure = supplied != expected
    with db.pool.handle() as hh:
        locked, retry_after, _failures = hh.one(
            "SELECT * FROM mela_access_code_attempt(%s, %s, %s, %s)",
            (member_id, event_id, ACCESS_CODE_WINDOW, count_failure))
    if locked:
        raise ApiError(429, "too_many_attempts", retry_after=retry_after)
    if count_failure:
        raise ApiError(403, "invalid_access_code")


@app.route("/api/events/<slug>/register", methods=["DELETE"])
def api_cancel_registration(slug):
    with require_handle() as h:
        member = member_or_401(h)
        read_body({})
        return cancel_registration(h, member, slug)


def cancel_registration(h, member, slug):
    event = ev.load_event_or_404(h, slug)
    existing = ev.as_dict(event)
    with h.conn.transaction():
        h.conn.execute("SELECT pg_advisory_xact_lock(%s)", (existing["id"],))
        reg = h.one(
            "SELECT id, status FROM registrations WHERE event_id = %s AND member_id = %s",
            (existing["id"], member[0]))
        if reg is None:
            raise ApiError(404, "not_registered")
        if reg[1] == "declined":
            raise ApiError(409, "registration_declined", status="declined")
        was_approved = reg[1] == "approved"
        if reg[1] == "cancelled":
            promoted = []
        else:
            h.execute("UPDATE registrations SET status = 'cancelled' WHERE id = %s",
                      (reg[0],))
            promoted = []
            if was_approved:
                going, _ = ev.event_counts(h, existing["id"])
                places = ev.free_places(existing["capacity"], going)
                if places is None:
                    promoted = ev.promote_from_waitlist(h, event, 10 ** 9)
                elif places > 0:
                    promoted = ev.promote_from_waitlist(h, event, places)
    result = ev.after_change_counts(h, event, member[0], promoted)
    return jsonify(result)


@app.route("/api/events/<slug>/guests")
def api_guests(slug):
    with require_handle() as h:
        member = member_or_401(h)
        event = ev.load_event_or_404(h, slug)
        existing = ev.as_dict(event)
        if existing["host_id"] != member[0]:
            raise ApiError(404, "not_found")
        status_filter = request.args.get("status") or None
        if status_filter is not None and status_filter not in REGISTRATION_STATUSES:
            raise BodyError(validation_error({"status": "Unknown status"}))
        sql = """SELECT r.id, m.name, m.email, r.status, r.requested_at
                 FROM registrations r JOIN members m ON m.id = r.member_id
                 WHERE r.event_id = %s"""
        params = [existing["id"]]
        if status_filter:
            sql += " AND r.status = %s"
            params.append(status_filter)
        sql += " ORDER BY r.requested_at, r.id"
        rows = h.all(sql, tuple(params))
        guests = []
        for row in rows:
            position = ev.waitlist_position(h, existing["id"], row[0]) \
                if row[3] == "waitlisted" else None
            guests.append({
                "id": row[0], "name": row[1], "email": row[2], "status": row[3],
                "requested_at": iso_utc(row[4]), "waitlist_position": position})
        return jsonify(guests)


@app.route("/api/events/<slug>/guests/<guest_id>", methods=["POST"])
def api_guest_action(slug, guest_id):
    with require_handle() as h:
        member = member_or_401(h)
        data = read_body({"action": string_field()})
        return guest_action(h, member, slug, guest_id, data.get("action"))


def guest_action(h, member, slug, guest_id, action):
    if action not in ("approve", "decline", "remove"):
        raise BodyError(validation_error({"action": "Unknown action"}))
    event = ev.load_event_or_404(h, slug)
    existing = ev.as_dict(event)
    if existing["host_id"] != member[0]:
        raise ApiError(404, "not_found")
    guest = ev.find_guest(h, existing["id"], guest_id)
    with h.conn.transaction():
        h.conn.execute("SELECT pg_advisory_xact_lock(%s)", (existing["id"],))
        target = ev.guest_action_target(action, guest[2])
        promoted = []
        if target == "approved":
            going, _ = ev.event_counts(h, existing["id"])
            if ev.is_full(existing["capacity"], going):
                raise ApiError(409, "event_full")
            h.execute("UPDATE registrations SET status = 'approved' WHERE id = %s",
                      (guest[0],))
        else:
            h.execute("UPDATE registrations SET status = %s WHERE id = %s",
                      (target, guest[0]))
            if action == "remove":
                going, _ = ev.event_counts(h, existing["id"])
                places = ev.free_places(existing["capacity"], going)
                if places is None:
                    promoted = ev.promote_from_waitlist(h, event, 10 ** 9)
                elif places > 0:
                    promoted = ev.promote_from_waitlist(h, event, places)
    going, waiting = ev.event_counts(h, existing["id"])
    return jsonify({
        "status": target,
        "event": ev.serialize_event(h, event, member[0], viewer_status=None,
                                    viewer_wait=None, counts=(going, waiting)),
        "promoted": [{"id": pid, "name": pname} for pid, pname in promoted],
    })


@app.route("/api/me/events")
def api_my_events():
    with require_handle() as h:
        member = member_or_401(h)
        tab = request.args.get("tab") or "upcoming"
        if tab not in ("upcoming", "past"):
            raise BodyError(validation_error({"tab": "Unknown tab"}))
        return jsonify(my_events(h, member[0], tab))


def my_events(h, member_id, tab):
    """Upcoming first, soonest first; past most recent first."""
    if tab == "upcoming":
        rows = h.all(
            """SELECT e.slug, e.name, e.start_at, e.end_at,
                      CASE WHEN e.host_id = %s THEN 'hosting' ELSE r.status END AS pill
               FROM events e
               LEFT JOIN registrations r ON r.event_id = e.id AND r.member_id = %s
               WHERE e.host_id = %s OR (r.member_id = %s AND r.status != 'cancelled')
               ORDER BY e.start_at, e.id""",
            (member_id, member_id, member_id, member_id))
        rows = [r for r in rows if r[3] > utcnow()]
        pills = {"hosting": "hosting", "approved": "going", "pending": "pending",
                 "waitlisted": "waitlisted", "declined": "declined"}
        return [{"slug": r[0], "name": r[1], "start_at": iso_utc(r[2]),
                 "end_at": iso_utc(r[3]), "pill": pills[r[4]]} for r in rows]
    rows = h.all(
        """SELECT e.slug, e.name, e.start_at, e.end_at,
                  CASE WHEN e.host_id = %s THEN 'hosting' ELSE r.status END AS pill
           FROM events e
           LEFT JOIN registrations r ON r.event_id = e.id AND r.member_id = %s
           WHERE (e.host_id = %s OR (r.member_id = %s AND r.status != 'cancelled'))
             AND e.end_at <= now()
           ORDER BY e.end_at DESC, e.id DESC""",
        (member_id, member_id, member_id, member_id))
    pills = {"hosting": "hosting", "approved": "going", "pending": "pending",
             "waitlisted": "waitlisted", "declined": "declined"}
    return [{"slug": r[0], "name": r[1], "start_at": iso_utc(r[2]),
             "end_at": iso_utc(r[3]), "pill": pills[r[4]]} for r in rows]


# --------------------------------------------------------------------------
# Contact and reports — one message per send
# --------------------------------------------------------------------------

def _idempotent_send(h, member, event, endpoint, body, validate_fields, insert_row):
    """The send-once decision for contact and report.

    A malformed key and a reused key with a different body are refused before
    the field check; a first send that fails the field check stores nothing,
    and N simultaneous identical sends store exactly one row.
    """
    key = request.headers.get("Idempotency-Key")
    if key is not None and not idempotency_key_valid(key):
        raise BodyError(validation_error({"idempotency_key": IDEMPOTENCY_KEY_MESSAGE}))
    if key is None:
        validate_fields()
        return insert_row(h, member, event, None), None
    member_id, event_id = member[0], ev.as_dict(event)["id"]
    digest = body_hash(body)
    cutoff = utcnow() - dt.timedelta(seconds=IDEMPOTENCY_RETENTION)
    with h.conn.transaction():
        h.conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))",
                       (f"send:{member_id}:{event_id}:{endpoint}:{key}",))
        remembered = h.one(
            """SELECT result_id, body_hash FROM idempotency_keys
               WHERE member_id = %s AND event_id = %s AND endpoint = %s
                 AND key_value = %s AND created_at >= %s""",
            (member_id, event_id, endpoint, key, cutoff))
        if remembered is not None:
            if remembered[1] == digest:
                return remembered[0], "replay"
            raise ApiError(422, "idempotency_key_reused")
        validate_fields()
        row_id = insert_row(h, member, event, key)
        h.execute(
            """INSERT INTO idempotency_keys
                   (member_id, event_id, endpoint, key_value, body_hash, result_id)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (member_id, event_id, endpoint, key, digest, row_id))
        return row_id, "stored"


@app.route("/api/events/<slug>/contact", methods=["POST"])
def api_contact(slug):
    with require_handle() as h:
        member = member_or_401(h)
        data = read_body({"message": string_field()})
        event = ev.load_event_or_404(h, slug)

        def validate_fields():
            message = data["message"].strip()
            if not message:
                raise BodyError(validation_error(
                    {"message": "Message must be at least 1 character"}))
            if len(message) > 1000:
                raise BodyError(validation_error(
                    {"message": "Message must be at most 1,000 characters"}))

        def insert_row(h, member, event, key):
            row = h.one(
                """INSERT INTO host_messages (member_id, event_id, message, idempotency_key)
                   VALUES (%s, %s, %s, %s) RETURNING id""",
                (member[0], ev.as_dict(event)["id"], data["message"].strip(), key))
            return row[0]

        row_id, _kind = _idempotent_send(h, member, event, "contact", data,
                                         validate_fields, insert_row)
        return jsonify({"id": row_id}), 201


@app.route("/api/events/<slug>/report", methods=["POST"])
def api_report(slug):
    with require_handle() as h:
        member = member_or_401(h)
        data = read_body({"reason": string_field(), "details": string_field()})
        event = ev.load_event_or_404(h, slug)

        def validate_fields():
            reason = data["reason"].strip()
            details = data.get("details", "").strip()
            if reason not in REPORT_REASONS:
                raise BodyError(validation_error({"reason": "Unknown reason"}))
            if len(details) > 1000:
                raise BodyError(validation_error(
                    {"details": "Details must be at most 1,000 characters"}))

        def insert_row(h, member, event, key):
            row = h.one(
                """INSERT INTO event_reports
                       (member_id, event_id, reason, details, idempotency_key)
                   VALUES (%s, %s, %s, %s, %s) RETURNING id""",
                (member[0], ev.as_dict(event)["id"], data["reason"].strip(),
                 data.get("details", "").strip(), key))
            return row[0]

        row_id, _kind = _idempotent_send(h, member, event, "report", data,
                                         validate_fields, insert_row)
        return jsonify({"id": row_id}), 201


@app.route("/static/<path:filename>")
def static_files(filename):
    if ".." in filename or filename.startswith("/"):
        abort(404)
    return send_from_directory(app.static_folder, filename, max_age=3600)


# --------------------------------------------------------------------------
# Pages
# --------------------------------------------------------------------------

def page_handle():
    """A handle for page requests, or None while the database is unreachable."""
    if not db_ready():
        return None
    try:
        return db.pool.handle()
    except Exception:
        return None


def view_context(h, template_member):
    """The shared context every page template expects."""
    return {"member": template_member,
            "initials": initials(template_member[1]) if template_member else None,
            "icons": Icons,
            "page_state": {"signedIn": template_member is not None}}


@app.route("/")
def page_landing():
    h = page_handle()
    if h is None:
        return render_template("outage.html"), 503
    with h:
        member = current_member(h)
        ctx = view_context(h, member)

        cities, categories = [], []
        for slug, name in db.CITIES:
            count = h.one(
                """SELECT count(*) FROM events
                   WHERE city = %s AND visibility = 'public' AND end_at > now()""",
                (name,))[0]
            cities.append({"slug": slug, "name": name, "count": count})
        for slug in CATEGORIES:
            count = h.one(
                """SELECT count(*) FROM events
                   WHERE visibility = 'public' AND end_at > now()
                     AND %s = ANY(categories)""", (slug,))[0]
            categories.append({"slug": slug, "name": CATEGORY_LABELS[slug],
                               "count": count})

        city_slug = request.args.get("city")
        if city_slug not in db.CITY_NAMES:
            city_slug = "new-delhi"
        coming_rows = discover_events(h, city_slug, None, limit=6) or []
        coming_up = []
        for row in coming_rows:
            coming_up.append({
                "slug": ev.row_field(row, "slug"),
                "name": ev.row_field(row, "name"),
                "theme": ev.row_field(row, "theme"),
                "weekday_time": short_start(ev.row_field(row, "start_at"),
                                            ev.row_field(row, "timezone")),
            })

        highlights = []
        highlight_rows = h.all(
            """SELECT id, slug, name, start_at, end_at, timezone, city, theme
               FROM events
               WHERE visibility = 'public' AND end_at > now()
                 AND end_at::date > start_at::date
               ORDER BY start_at LIMIT 4""")
        for row in highlight_rows:
            start_l = local_time(row[3], row[5])
            end_l = local_time(row[4], row[5])
            if start_l.date() == end_l.date():
                range_text = long_date(row[3], row[5])
            else:
                same_month = start_l.month == end_l.month
                first = f"{MONTHS_SHORT[start_l.month - 1]} {start_l.day}"
                second = (f"{MONTHS_SHORT[end_l.month - 1]} {end_l.day}"
                          if not same_month else str(end_l.day))
                range_text = f"{first}–{second}"
            highlights.append({"slug": row[1], "name": row[2], "theme": row[7],
                               "date_range": range_text, "city": row[6]})

        communities = []
        for row in h.all("SELECT slug, name, description, city, tint FROM calendars ORDER BY slug"):
            communities.append({"slug": row[0], "name": row[1], "description": row[2],
                                "city": row[3], "tint": row[4],
                                "initials": initials(row[1])})

        covers = []
        cover_rows = h.all(
            """SELECT slug, name, theme FROM events
               WHERE visibility = 'public' AND end_at > now()
               ORDER BY start_at LIMIT 12""")
        layout = [
            (8, 16, 108, -8, 0.05), (22, 6, 84, 7, 0.12), (36, 2, 92, -5, 0.20),
            (52, 8, 76, 10, 0.02), (66, 4, 88, -9, 0.16), (80, 14, 100, 5, 0.08),
            (90, 3, 80, -6, 0.24), (10, 74, 96, 9, 0.18), (24, 82, 84, -7, 0.06),
            (40, 88, 104, 6, 0.22), (58, 84, 82, -10, 0.10), (76, 92, 94, 8, 0.14),
        ]
        for index, row in enumerate(cover_rows):
            position = layout[index % len(layout)]
            covers.append({"name": row[1], "theme": row[2], "x": position[0],
                           "y": position[1], "size": position[2],
                           "tilt": position[3], "delay": position[4]})

        ctx.update({"cities": cities, "categories": categories,
                    "city_slug": city_slug, "coming_up": coming_up,
                    "highlights": highlights, "communities": communities,
                    "covers": covers})
        return render_template("landing.html", **ctx)


@app.route("/discover")
def page_discover():
    h = page_handle()
    if h is None:
        return render_template("outage.html"), 503
    with h:
        member = current_member(h)
        ctx = view_context(h, member)
        place = request.args.get("place") or None
        category = request.args.get("category") or None

        cities = []
        for slug, name in db.CITIES:
            count = h.one(
                """SELECT count(*) FROM events
                   WHERE city = %s AND visibility = 'public' AND end_at > now()""",
                (name,))[0]
            cities.append({"slug": slug, "name": name, "count": count})
        categories = []
        for slug in CATEGORIES:
            count = h.one(
                """SELECT count(*) FROM events
                   WHERE visibility = 'public' AND end_at > now()
                     AND %s = ANY(categories)""", (slug,))[0]
            categories.append({"slug": slug, "name": CATEGORY_LABELS[slug],
                               "count": count})

        communities = []
        for row in h.all(
                """SELECT c.slug, c.name, c.description, c.city, c.tint,
                          (SELECT count(*) FROM follows f
                            WHERE f.calendar_slug = c.slug)
                   FROM calendars c ORDER BY c.slug"""):
            following = False
            if member:
                following = h.one(
                    """SELECT 1 FROM follows
                       WHERE member_id = %s AND calendar_slug = %s""",
                    (member[0], row[0])) is not None
            communities.append({"slug": row[0], "name": row[1], "description": row[2],
                                "city": row[3], "tint": row[4], "follower_count": row[5],
                                "following": following, "initials": initials(row[1])})

        rows = discover_events(h, place, category)
        if rows is None:
            return render_template("not_found.html", **ctx), 404
        events = [discover_item(row) for row in rows]

        if place and category:
            filter_label = f"{CATEGORY_LABELS[category]} in {db.CITY_NAMES[place]}"
        elif place:
            filter_label = db.CITY_NAMES[place]
        elif category:
            filter_label = CATEGORY_LABELS[category]
        else:
            filter_label = "All cities"

        ctx.update({"places": cities, "categories": categories,
                    "communities": communities, "events": events,
                    "events_shown": events[:6], "place": place,
                    "category": category, "filter_label": filter_label})
        return render_template("discover.html", **ctx)


def discover_item(row):
    return {
        "slug": ev.row_field(row, "slug"),
        "name": ev.row_field(row, "name"),
        "theme": ev.row_field(row, "theme"),
        "city": ev.row_field(row, "city"),
        "venue_name": ev.row_field(row, "venue_name"),
        "short_start": short_start(ev.row_field(row, "start_at"),
                                   ev.row_field(row, "timezone")),
    }


@app.route("/c/<slug>")
def page_community(slug):
    h = page_handle()
    if h is None:
        return render_template("outage.html"), 503
    with h:
        member = current_member(h)
        ctx = view_context(h, member)
        row = h.one(
            """SELECT slug, name, description, city, tint,
                      (SELECT count(*) FROM follows f WHERE f.calendar_slug = calendars.slug)
               FROM calendars WHERE slug = %s""", (slug,))
        if row is None:
            return render_template("not_found.html", **ctx), 404
        following = False
        if member:
            following = h.one(
                "SELECT 1 FROM follows WHERE member_id = %s AND calendar_slug = %s",
                (member[0], slug)) is not None
        follower_count = row[5]
        events = [discover_item(r) for r in h.all(
            """SELECT * FROM (%s) sub WHERE calendar_slug = %%s
               AND visibility = 'public' AND end_at > now() ORDER BY start_at""" % ev.EVENT_SELECT,
            (slug,))]
        ctx.update({
            "community": {"slug": row[0], "name": row[1], "description": row[2],
                          "city": row[3], "tint": row[4],
                          "initials": initials(row[1])},
            "follower_count": follower_count,
            "follower_count_label": plural(follower_count, "Follower"),
            "following": following,
            "events": events,
        })
        return render_template("community.html", **ctx)


@app.route("/signin")
def page_signin():
    h = page_handle()
    if h is None:
        return render_template("outage.html"), 503
    with h:
        member = current_member(h)
        ctx = view_context(h, member)
        raw_next = request.args.get("next") or ""
        ctx["next"] = raw_next
        ctx["page_state"] = {"next": safe_next(raw_next), "rawNext": raw_next}
        return render_template("signin.html", **ctx)


@app.route("/home")
def page_home():
    h = page_handle()
    if h is None:
        return render_template("outage.html"), 503
    with h:
        member = current_member(h)
        if member is None:
            target = request.full_path if request.query_string else request.path
            return redirect("/signin?next=" + encode_next(target))
        ctx = view_context(h, member)
        tab = request.args.get("tab") or "upcoming"
        if tab not in ("upcoming", "past"):
            tab = "upcoming"
        upcoming, past = [], []
        for row in my_events_rows(h, member[0]):
            pill = row[6] if row[6] == "hosting" else REGISTRATION_PILLS[row[6]]
            item = {
                "slug": row[0], "name": row[1],
                "theme": row[5],
                "when": (short_start(row[2], row[4]) + " · " +
                         time_range(row[2], row[3], row[4])),
                "pill": pill, "pill_label": PILL_LABELS[pill],
            }
            if row[3] > utcnow():
                upcoming.append(item)
            else:
                past.append(item)
        ctx.update({"upcoming": upcoming, "past": past, "tab": tab})
        return render_template("home.html", **ctx)


REGISTRATION_PILLS = {"approved": "going", "pending": "pending",
                      "waitlisted": "waitlist", "declined": "declined"}

PILL_LABELS = {"hosting": "Hosting", "going": "Going", "pending": "Pending",
               "waitlisted": "Waitlist", "declined": "Declined"}


def my_events_rows(h, member_id):
    return h.all(
        """SELECT e.slug, e.name, e.start_at, e.end_at, e.timezone, e.theme,
                  CASE WHEN e.host_id = %s THEN 'hosting' ELSE r.status END
           FROM events e
           LEFT JOIN registrations r ON r.event_id = e.id AND r.member_id = %s
           WHERE e.host_id = %s OR (r.member_id = %s AND r.status != 'cancelled')
           ORDER BY e.start_at, e.id""",
        (member_id, member_id, member_id, member_id))


@app.route("/create")
def page_create():
    h = page_handle()
    if h is None:
        return render_template("outage.html"), 503
    with h:
        member = current_member(h)
        if member is None:
            return redirect("/signin?next=" + encode_next("/create"))
        ctx = view_context(h, member)
        followed = [{"slug": r[0], "name": r[1]} for r in h.all(
            """SELECT c.slug, c.name FROM follows f
               JOIN calendars c ON c.slug = f.calendar_slug
               WHERE f.member_id = %s ORDER BY c.name""", (member[0],))]
        ctx.update({"followed": followed})
        return render_template("create.html", **ctx)


@app.route("/manage/<slug>")
def page_manage(slug):
    h = page_handle()
    if h is None:
        return render_template("outage.html"), 503
    with h:
        member = current_member(h)
        target = request.full_path if request.query_string else request.path
        if member is None:
            return redirect("/signin?next=" + encode_next(target))
        event = ev.load_event(h, slug)
        if event is None or ev.row_field(event, "host_id") != member[0]:
            return render_template("not_found.html", **view_context(h, member)), 404
        ctx = view_context(h, member)
        existing = ev.as_dict(event)
        counts = h.one(
            """SELECT count(*) FILTER (WHERE status = 'pending'),
                      count(*) FILTER (WHERE status = 'approved'),
                      count(*) FILTER (WHERE status = 'waitlisted'),
                      count(*) FILTER (WHERE status = 'declined')
               FROM registrations WHERE event_id = %s""", (existing["id"],))
        followed = [{"slug": r[0], "name": r[1]} for r in h.all(
            """SELECT c.slug, c.name FROM follows f
               JOIN calendars c ON c.slug = f.calendar_slug
               WHERE f.member_id = %s ORDER BY c.name""", (member[0],))]
        start_l = local_time(existing["start_at"], existing["timezone"])
        end_l = local_time(existing["end_at"], existing["timezone"])
        initial = {
            "name": existing["name"],
            "description": existing["description"],
            "theme": existing["theme"],
            "calendar": existing["calendar_slug"] or "",
            "visibility": existing["visibility"],
            "startDate": start_l.strftime("%Y-%m-%d"),
            "startTime": start_l.strftime("%H:%M"),
            "endDate": end_l.strftime("%Y-%m-%d"),
            "endTime": end_l.strftime("%H:%M"),
            "timezone": existing["timezone"],
            "locationType": existing["location_type"],
            "venueName": existing["venue_name"] or "",
            "streetAddress": existing["street_address"] or "",
            "city": existing["city"] or "",
            "virtualLink": existing["virtual_link"] or "",
            "requireApproval": existing["require_approval"],
            "capacity": "" if existing["capacity"] is None else str(existing["capacity"]),
            "waitlist": existing["waitlist"],
        }
        ctx.update({
            "event": {
                "slug": existing["slug"], "name": existing["name"],
                "theme": existing["theme"], "capacity": existing["capacity"],
                "registration_status": existing["registration_status"],
            },
            "counts": {"pending": counts[0], "going": counts[1],
                       "waitlist": counts[2], "declined": counts[3]},
            "followed": followed,
            "initial": initial,
        })
        ctx["page_state"] = {"manageSlug": existing["slug"],
                            "registrationStatus": existing["registration_status"],
                            "timezone": existing["timezone"],
                            "codeOnly": bool(existing["access_code"])}
        return render_template("manage.html", **ctx)


@app.route("/cover/<path:name>")
def cover_image(name):
    """Covers are drawn by the app from the event's theme colours."""
    if not name.endswith(".svg"):
        abort(404)
    slug = name[:-4]
    h = page_handle()
    theme = "amber"
    event_name = ""
    if h is not None:
        with h:
            row = h.one("SELECT name, theme FROM events WHERE slug = %s", (slug,))
            if row:
                theme, event_name = row[1], row[0]
    svg = draw_cover(theme, event_name)
    return Response(svg, mimetype="image/svg+xml",
                    headers={"Cache-Control": "public, max-age=3600"})


THEME_COVERS = {
    "amber": ["#3a2c14", "#f0a832", "#f6d089", "#fff8ec"],
    "harbor": ["#12262e", "#57b8c9", "#a9e3ec", "#eefafd"],
    "moss": ["#232a1c", "#6f7d4e", "#b6c48e", "#f4f7e9"],
    "plum": ["#2a2439", "#8c7bd8", "#c5bbee", "#f4f1fd"],
    "ember": ["#33201c", "#e2765a", "#f2b39c", "#fdefe8"],
    "night": ["#eaf2fb", "#9cc4f5", "#3f5f8f", "#0b1626"],
}


def draw_cover(theme, name):
    colours = THEME_COVERS.get(theme, THEME_COVERS["amber"])
    ink, accent, soft, wash = colours
    words = _cover_lines(name)
    text = "".join(
        f'<text x="60" y="{260 + index * 78}" font-size="64" font-weight="700" '
        f'font-family="Georgia, serif" fill="{ink}">{_escape_xml(word)}</text>'
        for index, word in enumerate(words))
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 450" '
        f'width="600" height="450"><defs>'
        f'<linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{soft}"/><stop offset="1" stop-color="{wash}"/>'
        '</linearGradient>'
        f'<linearGradient id="g2" x1="0" y1="0" x2="1" y2="0">'
        f'<stop offset="0" stop-color="{accent}" stop-opacity="0.55"/>'
        f'<stop offset="1" stop-color="{accent}" stop-opacity="0.1"/>'
        '</linearGradient></defs>'
        f'<rect width="600" height="450" fill="url(#g1)"/>'
        f'<circle cx="500" cy="90" r="130" fill="url(#g2)"/>'
        f'<circle cx="80" cy="400" r="150" fill="{soft}" opacity="0.6"/>'
        f'<rect x="40" y="230" width="120" height="10" rx="5" fill="{accent}"/>'
        f'{text}</svg>')


def _cover_lines(name):
    words = (name or "Mela").split()
    lines, current = [], ""
    for word in words:
        candidate = (current + " " + word).strip()
        if len(candidate) > 16 and current:
            lines.append(current)
            current = word
        else:
            current = candidate
        if len(lines) == 3:
            break
    if current and len(lines) < 3:
        lines.append(current)
    return lines[:3] or ["Mela"]


def _escape_xml(text):
    return (text.replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))




@app.route("/<slug>")
def page_event(slug):
    h = page_handle()
    if h is None:
        return render_template("outage.html"), 503
    with h:
        member = current_member(h)
        ctx = view_context(h, member)
        if not _is_event_slug(slug):
            return render_template("not_found.html", **ctx), 404
        event = ev.load_event(h, slug)
        if event is None:
            return render_template("not_found.html", **ctx), 404
        return render_event_page(h, event, ctx)


SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,59}$")


def _is_event_slug(slug):
    """The event page never serves a source file, run.json or the venv."""
    if "." in slug or "/" in slug or "\\" in slug:
        return False
    return bool(SLUG_RE.match(slug))


def render_event_page(h, event, ctx, status=200):
    member = ctx["member"]
    member_id = member[0] if member else None
    existing = ev.as_dict(event)
    viewer_status, viewer_wait = ev.viewer_registration(h, existing["id"], member_id) \
        if member_id else (None, None)
    counts = ev.event_counts(h, existing["id"])
    state = ev.card_state(event, member_id, viewer_status, counts)
    address_visible = ev.address_visible(event, member_id, viewer_status)

    # The moved-up line shows once, on the guest's first view after promotion.
    moved_up = False
    if viewer_status == "approved" and member_id:
        promoted_at = h.one(
            "SELECT promoted_at FROM registrations WHERE event_id = %s AND member_id = %s",
            (existing["id"], member_id))[0]
        if promoted_at is not None:
            moved_up = True
            h.execute(
                "UPDATE registrations SET promoted_at = NULL WHERE event_id = %s AND member_id = %s",
                (existing["id"], member_id))

    zone = existing["timezone"]
    start_l = local_time(existing["start_at"], zone)

    calendar_name = None
    following = False
    follower_count = 0
    if existing["calendar_slug"]:
        calendar_row = h.one(
            "SELECT name FROM calendars WHERE slug = %s", (existing["calendar_slug"],))
        calendar_name = calendar_row[0] if calendar_row else None
        follower_count = h.one(
            "SELECT count(*) FROM follows WHERE calendar_slug = %s",
            (existing["calendar_slug"],))[0]
        if member_id:
            following = h.one(
                "SELECT 1 FROM follows WHERE member_id = %s AND calendar_slug = %s",
                (member_id, existing["calendar_slug"])) is not None

    host_name = h.one("SELECT name FROM members WHERE id = %s",
                      (existing["host_id"],))[0]

    guest_list = None
    if existing["show_guest_list"]:
        guests = h.all(
            """SELECT m.name FROM registrations r
               JOIN members m ON m.id = r.member_id
               WHERE r.event_id = %s AND r.status = 'approved'
               ORDER BY r.requested_at, r.id LIMIT 7""", (existing["id"],))
        if guests:
            names = [g[0] for g in guests]
            guest_list = {"avatars": [initials(n) for n in names[:6]],
                          "names": _guest_names(names)}

    going, waiting = counts
    capacity = existing["capacity"]
    meter = None
    if capacity is not None and state not in ("declined", "closed", "code", "past"):
        left = capacity - going
        if left == 0:
            if waiting > 0:
                left_line = f"Full · {waiting} waiting"
            elif existing["waitlist"]:
                left_line = "Full · waitlist open"
            else:
                left_line = "Full"
        elif left == 1:
            left_line = "1 place left"
        else:
            left_line = f"{left} places left"
        meter = {
            "taken_line": f"{going} of {capacity} places taken",
            "left_line": left_line,
            "percent": min(100, round(going * 100 / capacity)),
        }

    ctx.update({
        "event": {
            "slug": existing["slug"], "name": existing["name"],
            "description": existing["description"], "theme": existing["theme"],
            "capacity": capacity, "going_count": going,
            "venue_name": existing["venue_name"],
            "street_address": existing["street_address"] if address_visible else None,
            "city": existing["city"], "visibility": existing["visibility"],
            "location_type": existing["location_type"],
            "virtual_link": existing["virtual_link"] if address_visible else None,
            "calendar_slug": existing["calendar_slug"],
            "calendar_name": calendar_name,
            "host_name": host_name, "registration_status": existing["registration_status"],
        },
        "state": state,
        "ordinal": ordinal(viewer_wait) if viewer_wait else None,
        "viewer_wait": viewer_wait,
        "moved_up": moved_up,
        "days_ago": days_since(existing["end_at"]),
        "address_visible": address_visible,
        "show_guest_list": existing["show_guest_list"],
        "guest_list": guest_list,
        "host_initials": initials(host_name),
        "date_tile": {"month": MONTHS_SHORT[start_l.month - 1].upper(),
                      "day": str(start_l.day)},
        "long_date": long_date(existing["start_at"], zone),
        "time_range": time_range(existing["start_at"], existing["end_at"], zone),
        "countdown": countdown_text(existing["start_at"], existing["end_at"]),
        "happening_now": (utcnow() >= existing["start_at"]
                          and utcnow() < existing["end_at"]),
        "start_iso": iso_utc(existing["start_at"]),
        "end_iso": iso_utc(existing["end_at"]),
        "following": following,
        "follower_count": follower_count,
        "meter": meter,
    })
    ctx["page_state"] = {
        "eventSlug": existing["slug"],
        "state": state,
        "signedIn": member_id is not None,
        "viewerStatus": viewer_status,
    }
    response = make_response(render_template("event.html", **ctx), status)
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Vary"] = "Cookie, Authorization"
    return response


def _guest_names(names):
    if len(names) > 6:
        extra = len(names) - 6
        return (f"{name_list(names[:6])} and "
                f"{extra} other{'s' if extra > 1 else ''}")
    return name_list(names)



# --------------------------------------------------------------------------
# Health
# --------------------------------------------------------------------------

@app.route("/api/health")
def health():
    ready = db.ensure_ready(timeout=0)
    if ready:
        return jsonify({"status": "ok", "started_at": SERVE_STARTED_AT})
    return jsonify({"status": "unavailable"})

"""The JSON API under /api."""
from functools import wraps

import psycopg
from flask import Blueprint, g, jsonify, make_response, request

from . import accounts, bodies, communities, config, db, discovery, events, registrations
from .domain import STATUSES
from .errors import ApiError, invalid, not_found

api = Blueprint("api", __name__, url_prefix="/api")

# Spends the same time on an unknown email as on a wrong password.
DECOY_HASH = accounts.hash_password("not-a-member-password")


def member_only(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.member is None:
            raise ApiError(401, "unauthenticated")
        return view(*args, **kwargs)
    return wrapped


def registration_response(status, event, promoted, code=200):
    return jsonify({"status": status, "event": events.to_json(event), "promoted": promoted}), code


@api.get("/health")
def health():
    try:
        with db.connect() as conn:
            conn.execute("SELECT 1")
    except psycopg.Error:
        return {"status": "unavailable"}
    return {"status": "ok", "started_at": config.STARTED_AT}


# Accounts and sessions

def _user(member):
    return {"id": member["id"], "name": member["name"], "email": member["email"]}


def _signed_in(member, code):
    token = accounts.start_session(member["id"])
    response = jsonify({"user": _user(member), "token": token})
    response.status_code = code
    accounts.set_session_cookie(response, token)
    return response


@api.post("/auth/check")
def check_email():
    email = bodies.parse({"email": bodies.TEXT}).get("email", "").strip().lower()
    if not accounts.valid_email(email):
        raise invalid({"email": "Enter a valid email address"})
    found = db.conn().execute("SELECT 1 FROM members WHERE email = %s", (email,)).fetchone()
    return {"exists": found is not None}


@api.post("/auth/signup")
def signup():
    body = bodies.parse({"name": bodies.TEXT, "email": bodies.TEXT, "password": bodies.TEXT})
    name, email, password = body.get("name", "").strip(), body.get("email", "").strip().lower(), body.get("password", "")
    errors = {}
    if not accounts.valid_email(email):
        errors["email"] = "Enter a valid email address"
    if not 8 <= len(password) <= 200:
        errors["password"] = "Use a password of 8 to 200 characters"
    if not 1 <= len(name) <= 80:
        errors["name"] = "Enter a name of 1 to 80 characters"
    conn = db.conn()
    if "email" not in errors and conn.execute("SELECT 1 FROM members WHERE email = %s", (email,)).fetchone():
        raise ApiError(409, "email_taken")
    if errors:
        raise invalid(errors)
    with conn.transaction():
        member = conn.execute(
            "INSERT INTO members (email, name, password_hash) VALUES (%s, %s, %s) ON CONFLICT (email) DO NOTHING"
            " RETURNING id, name, email", (email, name, accounts.hash_password(password))).fetchone()
        if member is None:
            raise ApiError(409, "email_taken")
        return _signed_in(member, 201)


@api.post("/auth/signin")
def signin():
    body = bodies.parse({"email": bodies.TEXT, "password": bodies.TEXT})
    member = db.conn().execute("SELECT id, name, email, password_hash FROM members WHERE email = %s",
                               (body.get("email", "").strip().lower(),)).fetchone()
    matches = accounts.password_matches(body.get("password", ""), member["password_hash"] if member else DECOY_HASH)
    if member is None or not matches:
        raise ApiError(401, "invalid_credentials")
    return _signed_in(member, 200)


@api.post("/auth/signout")
@member_only
def signout():
    bodies.parse(bodies.NONE)
    accounts.end_session(g.token)
    response = make_response("", 204)
    accounts.clear_session_cookie(response)
    return response


@api.get("/me")
@member_only
def me():
    return {"user": _user(g.member)}


@api.get("/me/events")
@member_only
def my_events():
    tab = request.args.get("tab", "upcoming")
    if tab not in ("upcoming", "past"):
        raise invalid({"tab": "Choose upcoming or past"})
    return jsonify([{"slug": e["slug"], "name": e["name"], "start_at": events.iso(e["start_at"]),
                     "end_at": events.iso(e["end_at"]), "pill": e["pill"]}
                    for e in events.member_events(db.conn(), g.member, tab)])


# Discovery

def count_tiles(tiles):
    return [{"slug": tile["slug"], "name": tile["name"], "event_count": tile["event_count"]} for tile in tiles]


@api.get("/discover")
def discover():
    place, category = request.args.get("place") or None, request.args.get("category") or None
    if not discovery.known_filters(place, category):
        raise not_found()
    listing = discovery.upcoming(db.conn())
    places, categories = discovery.counts(listing)
    return {
        "places": count_tiles(places), "categories": count_tiles(categories),
        "events": [{"slug": e["slug"], "name": e["name"], "start_at": events.iso(e["start_at"]),
                    "end_at": events.iso(e["end_at"]), "timezone": e["timezone"], "city": e["city"],
                    "venue_name": e["venue_name"], "theme": e["theme"], "categories": e["categories"]}
                   for e in listing if discovery.matches(e, place, category)],
    }


@api.get("/categories")
def categories():
    return jsonify(count_tiles(discovery.counts(discovery.upcoming(db.conn()))[1]))


@api.get("/calendars")
def calendars():
    return jsonify([{"slug": c["slug"], "name": c["name"], "description": c["description"], "city": c["city"],
                     "follower_count": c["follower_count"]} for c in communities.calendars(db.conn(), None)])


# Events

@api.get("/events/<slug>")
def event(slug):
    return events.to_json(events.require(db.conn(), slug, g.member))


@api.post("/events")
@member_only
def create_event():
    body = bodies.parse(bodies.EVENT_FIELDS)
    conn = db.conn()
    slug = events.create(conn, g.member, body)
    return events.to_json(events.require(conn, slug, g.member)), 201


@api.patch("/events/<slug>")
@member_only
def edit_event(slug):
    conn = db.conn()
    events.require_hosted(conn, slug, g.member)
    return events.to_json(events.edit(conn, g.member, slug, bodies.parse(bodies.EVENT_EDIT_FIELDS)))


@api.post("/events/<slug>/register")
@member_only
def register(slug):
    conn = db.conn()
    events.require(conn, slug, g.member)
    body = bodies.parse({"access_code": bodies.TEXT})
    code, status, event, promoted = registrations.register(conn, g.member, slug, body)
    return registration_response(status, event, promoted, code)


@api.delete("/events/<slug>/register")
@member_only
def cancel(slug):
    conn = db.conn()
    events.require(conn, slug, g.member)
    bodies.parse(bodies.NONE)
    return registration_response(*registrations.cancel(conn, g.member, slug))


@api.get("/events/<slug>/guests")
@member_only
def guests(slug):
    conn = db.conn()
    event = events.require_hosted(conn, slug, g.member)
    status = request.args.get("status") or None
    if status is not None and status not in STATUSES:
        raise invalid({"status": "Choose pending, approved, declined, waitlisted or cancelled"})
    return jsonify([{"id": r["id"], "name": r["name"], "email": r["email"], "status": r["status"],
                     "requested_at": events.iso(r["requested_at"]), "waitlist_position": r["waitlist_position"]}
                    for r in registrations.guests(conn, event, status)])


@api.post("/events/<slug>/guests/<raw_id>")
@member_only
def decide(slug, raw_id):
    conn = db.conn()
    events.require_hosted(conn, slug, g.member)
    return registration_response(*registrations.decide(conn, g.member, slug, registrations.guest_id(raw_id)))


# Following, contact and reports

@api.route("/calendars/<slug>/follow", methods=["PUT", "DELETE"])
@member_only
def follow(slug):
    conn = db.conn()
    if communities.calendar(conn, slug, None) is None:
        raise not_found()
    bodies.parse(bodies.NONE)
    following = request.method == "PUT"
    return {"following": following, "follower_count": communities.follow(conn, g.member, slug, following)}


def _send(slug, table, fields, validate):
    conn = db.conn()
    event = events.require(conn, slug, g.member)
    body = bodies.parse(fields)
    key = communities.idempotency_key(request.headers.get("Idempotency-Key"))
    return {"id": communities.send_once(conn, table, g.member, event, key, body, validate)}, 201


@api.post("/events/<slug>/contact")
@member_only
def contact(slug):
    return _send(slug, "host_messages", {"message": bodies.TEXT}, communities.message_values)


@api.post("/events/<slug>/report")
@member_only
def report(slug):
    return _send(slug, "event_reports", {"reason": bodies.TEXT, "details": bodies.TEXT}, communities.report_values)

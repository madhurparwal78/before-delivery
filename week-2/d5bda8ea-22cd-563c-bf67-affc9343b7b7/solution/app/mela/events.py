"""Events: loading with derived counts, what each viewer may see, the event object, create and edit."""
import secrets
import string
from datetime import datetime, timezone
from zoneinfo import available_timezones

from . import registrations
from .domain import CATEGORY_NAMES, THEMES
from .errors import invalid, not_found

SLUG_ALPHABET = string.ascii_lowercase + string.digits
CAPACITY_RANGE = "Capacity must be a whole number from 1 to 10,000, or empty for unlimited"
ZONES = available_timezones()

EVENT_SELECT = """
SELECT e.*, h.name AS host_name, c.slug AS calendar_slug, c.name AS calendar_name,
       counts.going_count, counts.waitlist_count
FROM events e JOIN members h ON h.id = e.host_id LEFT JOIN calendars c ON c.id = e.calendar_id
CROSS JOIN LATERAL (
    SELECT count(*) FILTER (WHERE status = 'approved') AS going_count,
           count(*) FILTER (WHERE status = 'waitlisted') AS waitlist_count
    FROM registrations WHERE event_id = e.id
) counts
"""


def lock(conn, slug):
    """Serialize every registration change on one event: callers hold this row lock until they commit."""
    conn.execute("SELECT id FROM events WHERE slug = %s FOR UPDATE", (slug,))


def load(conn, slug, member):
    """The event as `member` (or a visitor, None) sees it now; None when there is no such event."""
    event = conn.execute(EVENT_SELECT + " WHERE e.slug = %s", (slug,)).fetchone()
    if event is None:
        return None
    event["places_left"] = None if event["capacity"] is None else event["capacity"] - event["going_count"]
    event["is_host"] = member is not None and member["id"] == event["host_id"]
    event["registration"] = None
    event["queue_position"] = None
    if member is not None:
        event["registration"] = conn.execute(
            "SELECT id, status, moved_up, celebrated_at FROM registrations WHERE event_id = %s AND member_id = %s",
            (event["id"], member["id"])).fetchone()
        if event["registration"] and event["registration"]["status"] == "waitlisted":
            event["queue_position"] = registrations.queue_position(conn, event["id"], event["registration"]["id"])
    event["viewer_status"] = event["registration"]["status"] if event["registration"] else None
    event["sees_address"] = event["is_host"] or event["viewer_status"] == "approved"
    event["ended"] = event["end_at"] <= datetime.now(timezone.utc)
    return event


def require(conn, slug, member):
    event = load(conn, slug, member)
    if event is None:
        raise not_found()
    return event


def require_hosted(conn, slug, member):
    """The event when `member` hosts it; any other member gets the same not-found as an unknown event."""
    event = require(conn, slug, member)
    if not event["is_host"]:
        raise not_found()
    return event


def iso(moment):
    return moment.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def to_json(event):
    event_json = {
        "slug": event["slug"], "name": event["name"], "description": event["description"],
        "start_at": iso(event["start_at"]), "end_at": iso(event["end_at"]), "timezone": event["timezone"],
        "location_type": event["location_type"], "venue_name": event["venue_name"],
        "street_address": event["street_address"], "city": event["city"], "virtual_link": event["virtual_link"],
        "visibility": event["visibility"], "require_approval": event["require_approval"],
        "capacity": event["capacity"], "waitlist": event["waitlist"],
        "registration_status": event["registration_status"], "theme": event["theme"],
        "categories": event["categories"], "calendar": event["calendar_slug"],
        "show_guest_list": event["show_guest_list"], "host": {"id": event["host_id"], "name": event["host_name"]},
        "going_count": event["going_count"], "places_left": event["places_left"],
        "waitlist_count": event["waitlist_count"], "viewer_status": event["viewer_status"],
        "viewer_waitlist_position": event["queue_position"], "is_host": event["is_host"],
    }
    if not event["sees_address"]:
        del event_json["street_address"], event_json["virtual_link"]
    return event_json


def _instant(value):
    try:
        moment = datetime.fromisoformat(value)
    except ValueError:
        return None
    return moment if moment.tzinfo is not None else None


def validate(conn, body, member, stored=None):
    """Field values for create (stored is None) or edit; raises 422 naming every invalid field."""
    errors, values = {}, {}
    current = dict(stored or {})

    def text(key, limit, label):
        if key in body:
            values[key] = body[key].strip()
            if len(values[key]) > limit:
                errors[key] = f"{label} can be at most {limit:,} characters"

    if "name" in body or stored is None:
        values["name"] = body.get("name", "").strip()
        if not 1 <= len(values["name"]) <= 140:
            errors["name"] = "Give the event a name of 1 to 140 characters"
    text("description", 5000, "The description")
    text("venue_name", 200, "The venue name")
    text("street_address", 200, "The street address")
    text("city", 80, "The city")
    text("virtual_link", 500, "The link")
    for key in ("start_at", "end_at"):
        if key in body:
            values[key] = _instant(body[key])
            if values[key] is None:
                errors[key] = "Enter a date and time with its offset"
    if "timezone" in body:
        values["timezone"] = body["timezone"]
        if values["timezone"] not in ZONES:
            errors["timezone"] = "Choose a known time zone"
    choices = {"location_type": ("offline", "virtual"), "visibility": ("public", "private"), "theme": THEMES}
    for key, allowed in choices.items():
        if key in body:
            values[key] = body[key]
            if values[key] not in allowed:
                errors[key] = "Choose one of: " + ", ".join(allowed)
    for key in ("require_approval", "waitlist", "show_guest_list"):
        if key in body:
            values[key] = body[key]
    if "capacity" in body:
        values["capacity"] = body["capacity"]
        if values["capacity"] is not None and not 1 <= values["capacity"] <= 10000:
            errors["capacity"] = CAPACITY_RANGE
    if "categories" in body:
        values["categories"] = body["categories"]
        if (len(values["categories"]) > 2 or len(set(values["categories"])) != len(values["categories"])
                or not set(values["categories"]) <= CATEGORY_NAMES.keys()):
            errors["categories"] = "Choose up to two different categories"
    if body.get("calendar") is not None:
        followed = conn.execute(
            "SELECT c.id FROM calendars c JOIN follows f ON f.calendar_id = c.id AND f.member_id = %s WHERE c.slug = %s",
            (member["id"], body["calendar"])).fetchone()
        if followed is None:
            errors["calendar"] = "Choose your personal calendar or a community you follow"
        else:
            values["calendar_id"] = followed["id"]
    elif "calendar" in body:
        values["calendar_id"] = None

    merged = {**current, **{k: v for k, v in values.items() if k not in errors}}
    if "start_at" not in errors and "end_at" not in errors:
        if merged.get("start_at") is None and stored is None:
            errors["start_at"] = "Enter a date and time with its offset"
        elif merged.get("end_at") is None and stored is None:
            errors["end_at"] = "Enter a date and time with its offset"
        elif merged["end_at"] <= merged["start_at"]:
            errors["end_at"] = "The end must be after the start"
    starts = values.get("start_at")
    if "start_at" not in errors and starts is not None and (stored is None or starts != stored["start_at"]):
        if starts < datetime.now(timezone.utc):
            errors["start_at"] = "The start cannot be in the past"
    if "location_type" not in errors:
        if merged.get("location_type", "offline") == "offline":
            if not merged.get("city") and "city" not in errors:
                errors["city"] = "Enter the city"
        elif not merged.get("virtual_link", "").startswith("https://") and "virtual_link" not in errors:
            errors["virtual_link"] = "Enter a link starting with https://"
    if errors:
        raise invalid(errors)
    return values


DEFAULTS = {"description": "", "timezone": "Asia/Kolkata", "location_type": "offline", "venue_name": "",
            "street_address": "", "city": "", "virtual_link": "", "visibility": "public", "require_approval": False,
            "capacity": None, "waitlist": False, "theme": "amber", "categories": [], "calendar_id": None,
            "show_guest_list": True}
COLUMNS = list(DEFAULTS) + ["name", "start_at", "end_at"]


def create(conn, member, body):
    values = {**DEFAULTS, **validate(conn, body, member)}
    columns = ", ".join(COLUMNS)
    placeholders = ", ".join(["%s"] * len(COLUMNS))
    while True:
        slug = "".join(secrets.choice(SLUG_ALPHABET) for _ in range(8))
        row = conn.execute(
            f"INSERT INTO events (slug, host_id, registration_status, {columns}) VALUES (%s, %s, 'open', {placeholders})"
            " ON CONFLICT (slug) DO NOTHING RETURNING slug",
            (slug, member["id"], *(values[c] for c in COLUMNS))).fetchone()
        if row:
            return row["slug"]


def status_edges(stored):
    """The registration_status values an event may move to: open/closed, or code_only/closed with an access code."""
    return ("code_only", "closed") if stored["access_code"] else ("open", "closed")


def edit(conn, member, slug, body):
    """Apply a partial edit at the event's serialized moment; a capacity raise moves waiting guests up."""
    with conn.transaction():
        lock(conn, slug)
        stored = require_hosted(conn, slug, member)
        values = validate(conn, body, member, stored)
        if "registration_status" in body and body["registration_status"] not in status_edges(stored):
            raise invalid({"registration_status": "Registration can move only between "
                           + " and ".join(status_edges(stored))})
        if "registration_status" in body:
            values["registration_status"] = body["registration_status"]
        going, capacity = stored["going_count"], values.get("capacity", stored["capacity"])
        if capacity is not None and capacity < going:
            raise invalid({"capacity": f"Capacity cannot be lower than the {going} guest{'' if going == 1 else 's'}"
                                       " already going"})
        if values:
            assignments = ", ".join(f"{column} = %s" for column in values)
            conn.execute(f"UPDATE events SET {assignments} WHERE id = %s", (*values.values(), stored["id"]))
        if stored["capacity"] is not None and (capacity is None or capacity > stored["capacity"]):
            registrations.promote(conn, require(conn, slug, member))
        return require(conn, slug, member)


PILLS = {"approved": "going", "pending": "pending", "waitlisted": "waitlist", "declined": "declined"}


def member_events(conn, member, tab):
    """`upcoming`: not ended, hosting or holding any status but cancelled, soonest first; `past`: ended, latest first."""
    upcoming = tab == "upcoming"
    rows = conn.execute(
        "SELECT e.slug, e.name, e.start_at, e.end_at, e.timezone, e.theme, e.host_id = %(member)s AS hosting, r.status"
        " FROM events e LEFT JOIN registrations r ON r.event_id = e.id AND r.member_id = %(member)s"
        " WHERE (e.host_id = %(member)s OR r.status IN ('pending', 'approved', 'waitlisted', 'declined'))"
        " AND (e.end_at > now()) = %(upcoming)s"
        f" ORDER BY e.start_at {'ASC' if upcoming else 'DESC'}, e.id",
        {"member": member["id"], "upcoming": upcoming}).fetchall()
    for row in rows:
        row["pill"] = "hosting" if row["hosting"] else PILLS[row["status"]]
    return rows

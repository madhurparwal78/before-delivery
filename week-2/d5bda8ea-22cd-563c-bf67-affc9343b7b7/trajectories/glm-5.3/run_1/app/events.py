"""Event, registration and guest-list domain rules.

Each domain rule named in the brief is decided in exactly one place here:
the registration status edges, the capacity-and-promotion decision, the
queue order, the address-visibility decision and the guest lookup.
"""

from db import CATEGORIES
from helpers import (ApiError, CAPACITY_RANGE_MESSAGE, THEMES,
                     get_zone, iso_utc, utcnow)


# --------------------------------------------------------------------------
# Loading rows
# --------------------------------------------------------------------------

EVENT_SELECT = """SELECT id, slug, name, description, start_at, end_at, timezone,
       location_type, venue_name, street_address, city, virtual_link,
       visibility, require_approval, capacity, waitlist, registration_status,
       access_code, theme, categories, calendar_slug, show_guest_list, host_id
FROM events"""


def load_event(h, slug):
    """A single event row by slug, or None."""
    return h.one(EVENT_SELECT + " WHERE slug = %s", (slug,))


def load_event_or_404(h, slug):
    row = load_event(h, slug)
    if row is None:
        raise ApiError(404, "not_found")
    return row


def row_field(row, name):
    return row[EVENT_FIELD_INDEX[name]]


EVENT_FIELD_INDEX = {
    "id": 0, "slug": 1, "name": 2, "description": 3, "start_at": 4, "end_at": 5,
    "timezone": 6, "location_type": 7, "venue_name": 8, "street_address": 9,
    "city": 10, "virtual_link": 11, "visibility": 12, "require_approval": 13,
    "capacity": 14, "waitlist": 15, "registration_status": 16,
    "access_code": 17, "theme": 18, "categories": 19, "calendar_slug": 20,
    "show_guest_list": 21, "host_id": 22,
}


def as_dict(row):
    return {name: row[index] for name, index in EVENT_FIELD_INDEX.items()}


# --------------------------------------------------------------------------
# Counts, places and queue order — the derived values
# --------------------------------------------------------------------------

def event_counts(h, event_id):
    """(going_count, waitlist_count) computed from stored rows when read."""
    going, waiting = h.one(
        """SELECT count(*) FILTER (WHERE status = 'approved'),
                  count(*) FILTER (WHERE status = 'waitlisted')
           FROM registrations WHERE event_id = %s""", (event_id,))
    return going, waiting


def places_left(capacity, going):
    return None if capacity is None else capacity - going


def is_full(capacity, going):
    return capacity is not None and going >= capacity


def waitlist_position(h, event_id, registration_id):
    """Queue positions count from 1 in queue order (queued_at, then id)."""
    row = h.one(
        """SELECT count(*) FROM registrations
           WHERE event_id = %s AND status = 'waitlisted'
             AND (queued_at, id) <= (
                 SELECT queued_at, id FROM registrations WHERE id = %s)""",
        (event_id, registration_id))
    return row[0] if row else None


def viewer_registration(h, event_id, member_id):
    """(status, waitlist_position) for the viewer, or (None, None)."""
    row = h.one(
        """SELECT id, status FROM registrations
           WHERE event_id = %s AND member_id = %s""",
        (event_id, member_id))
    if row is None:
        return None, None
    position = waitlist_position(h, event_id, row[0]) if row[1] == "waitlisted" else None
    return row[1], position


# --------------------------------------------------------------------------
# Address visibility — the one decision
# --------------------------------------------------------------------------

def address_visible(event, viewer_id, viewer_status):
    """The street address, virtual link and maps link reach only the host
    and approved guests."""
    if viewer_id is not None and viewer_id == row_field(event, "host_id"):
        return True
    return viewer_status == "approved"


# --------------------------------------------------------------------------
# Event serialization
# --------------------------------------------------------------------------

def serialize_event(h, event, viewer_id, viewer_status=None, viewer_wait=None,
                    counts=None):
    """The event object as the caller sees it, with its derived counts."""
    ev = as_dict(event)
    if counts is None and viewer_status is None and viewer_id is not None:
        viewer_status, viewer_wait = viewer_registration(h, ev["id"], viewer_id)
    if counts is None:
        going, waiting = event_counts(h, ev["id"])
    else:
        going, waiting = counts
    visible = address_visible(event, viewer_id, viewer_status)
    obj = {
        "slug": ev["slug"],
        "name": ev["name"],
        "description": ev["description"],
        "start_at": iso_utc(ev["start_at"]),
        "end_at": iso_utc(ev["end_at"]),
        "timezone": ev["timezone"],
        "location_type": ev["location_type"],
        "venue_name": ev["venue_name"],
        "city": ev["city"],
        "visibility": ev["visibility"],
        "require_approval": ev["require_approval"],
        "capacity": ev["capacity"],
        "waitlist": ev["waitlist"],
        "registration_status": ev["registration_status"],
        "theme": ev["theme"],
        "categories": list(ev["categories"] or []),
        "calendar": ev["calendar_slug"],
        "show_guest_list": ev["show_guest_list"],
        "host": {"id": ev["host_id"], "name": h.one(
            "SELECT name FROM members WHERE id = %s", (ev["host_id"],))[0]},
        "going_count": going,
        "places_left": places_left(ev["capacity"], going),
        "waitlist_count": waiting,
        "viewer_status": viewer_status,
        "viewer_waitlist_position": viewer_wait,
        "is_host": viewer_id is not None and viewer_id == ev["host_id"],
    }
    if visible:
        obj["street_address"] = ev["street_address"]
        if ev["virtual_link"]:
            obj["virtual_link"] = ev["virtual_link"]
    return obj


# --------------------------------------------------------------------------
# The Registration card state — the one decision
# --------------------------------------------------------------------------

def card_state(event, viewer_id, viewer_status, counts, now=None):
    """The first rule that applies wins."""
    ev = as_dict(event)
    if viewer_id is not None and viewer_id == ev["host_id"]:
        return "host"
    if (now or utcnow()) >= ev["end_at"]:
        return "past"
    if viewer_status in ("pending", "approved", "declined", "waitlisted"):
        return viewer_status
    if ev["registration_status"] == "closed":
        return "closed"
    if ev["registration_status"] == "code_only":
        return "code"
    going = counts[0]
    if is_full(ev["capacity"], going):
        return "full_waitlist" if ev["waitlist"] else "full"
    return "approval" if ev["require_approval"] else "open"


# --------------------------------------------------------------------------
# Event field validation
# --------------------------------------------------------------------------

EDITABLE_FIELDS = ("name", "description", "start_at", "end_at", "timezone",
                   "location_type", "venue_name", "street_address", "city",
                   "virtual_link", "visibility", "require_approval",
                   "capacity", "waitlist", "theme", "categories", "calendar",
                   "show_guest_list")


def validate_event_fields(data, existing=None, now=None):
    """Return {field: message} for invalid fields; cross-field rules use the
    stored value for any field the request leaves out."""
    errors = {}
    merged = dict(existing or {})
    for key, value in data.items():
        merged[key] = value
    now = now or utcnow()

    if "name" in data:
        name = data["name"]
        if not name.strip():
            errors["name"] = "Name is required"
        elif len(name.strip()) > 140:
            errors["name"] = "Name must be at most 140 characters"
    if "description" in data:
        if len(data["description"].strip()) > 5000:
            errors["description"] = "Description must be at most 5,000 characters"
    if "start_at" in data:
        start = data["start_at"]
        if start is None:
            errors["start_at"] = "Start is required"
        elif start <= now:
            errors["start_at"] = "Start must be in the future"
    if "end_at" in data:
        if data["end_at"] is None:
            errors["end_at"] = "End is required"
    if merged.get("start_at") and merged.get("end_at") \
            and merged["end_at"] <= merged["start_at"]:
        errors["end_at"] = "End must be after start"
    if "timezone" in data:
        if get_zone(data["timezone"]) is None:
            errors["timezone"] = "Unknown time zone"
    if "location_type" in data and data["location_type"] not in ("offline", "virtual"):
        errors["location_type"] = "Expected one of: offline, virtual"
    if merged.get("location_type") == "offline":
        if not (merged.get("city") or "").strip():
            errors["city"] = "City is required for an offline event"
    if merged.get("location_type") == "virtual":
        link = merged.get("virtual_link") or ""
        if not link.startswith("https://"):
            errors["virtual_link"] = "Virtual link must start with https://"
    if "visibility" in data and data["visibility"] not in ("public", "private"):
        errors["visibility"] = "Expected one of: public, private"
    if "capacity" in data:
        capacity = data["capacity"]
        if capacity is not None and not (1 <= capacity <= 10000):
            errors["capacity"] = CAPACITY_RANGE_MESSAGE
    if "theme" in data and data["theme"] not in THEMES:
        errors["theme"] = "Expected one of: " + ", ".join(THEMES)
    if "categories" in data:
        cats = data["categories"]
        if len(cats) > 2:
            errors["categories"] = "Choose at most two categories"
        elif len(set(cats)) != len(cats):
            errors["categories"] = "Categories must be distinct"
        elif any(c not in CATEGORIES for c in cats):
            errors["categories"] = "Unknown category"
    return errors


def capacity_floor_message(going):
    if going == 1:
        return "Capacity cannot be lower than the 1 guest already going"
    return f"Capacity cannot be lower than the {going} guests already going"


def registration_status_target(current, requested, has_access_code):
    """Registration status edges: open<->closed, or code_only<->closed.

    Sending the current value is a no-op (None). Any other value or edge is
    refused.
    """
    if requested is None or requested == current:
        return None
    if requested == "closed" and current in ("open", "code_only"):
        return "closed"
    if current == "closed":
        reopen = "code_only" if has_access_code else "open"
        if requested == reopen:
            return requested
    return "invalid"


# --------------------------------------------------------------------------
# Registration decisions
# --------------------------------------------------------------------------

def register_decision(event, has_waiting, counts):
    """The status a new register request lands on, or an ApiError refusal.

    Refusals (closed, ended, code, host, full) are raised here; the replay
    rule and the lockout are checked by the caller before this runs.
    """
    ev = as_dict(event)
    going = counts[0]
    if is_full(ev["capacity"], going):
        if ev["waitlist"]:
            return "waitlisted"
        raise ApiError(409, "event_full")
    if ev["require_approval"]:
        return "pending"
    if has_waiting:
        return "waitlisted"
    return "approved"


def promote_from_waitlist(h, event, places):
    """Move the earliest waiting guests to approved, in queue order.

    Returns the promoted registrations as [(registration_id, name), ...].
    The caller holds the event's advisory lock and its own transaction.
    """
    ev = as_dict(event)
    if not ev["waitlist"] or ev["require_approval"] or places <= 0:
        return []
    if (utcnow()) >= ev["end_at"]:
        return []
    rows = h.all(
        """SELECT r.id, m.name FROM registrations r
           JOIN members m ON m.id = r.member_id
           WHERE r.event_id = %s AND r.status = 'waitlisted'
           ORDER BY r.queued_at NULLS LAST, r.id
           LIMIT %s""",
        (ev["id"], places))
    if not rows:
        return []
    h.execute(
        "UPDATE registrations SET status = 'approved', promoted_at = now() WHERE id = ANY(%s)",
        ([r[0] for r in rows],))
    return [(r[0], r[1]) for r in rows]


def free_places(capacity, going):
    if capacity is None:
        return None  # unlimited
    return max(0, capacity - going)


def after_change_counts(h, event, member_id, promoted):
    """Counts read inside the change's own transaction, after the change."""
    ev = as_dict(event)
    going, waiting = event_counts(h, ev["id"])
    status, position = viewer_registration(h, ev["id"], member_id)
    return {
        "status": status,
        "event": serialize_event(h, event, member_id, viewer_status=status,
                                 viewer_wait=position, counts=(going, waiting)),
        "promoted": [{"id": pid, "name": pname} for pid, pname in promoted],
    }


def guest_action_target(action, current):
    """The one place that decides the registration status edges.

    Returns the new status, or raises the refusal. None means 'unchanged'.
    """
    if action == "approve":
        if current == "approved":
            raise ApiError(409, "invalid_transition")
        if current in ("pending", "waitlisted"):
            return "approved"
        raise ApiError(409, "invalid_transition")
    if action == "decline":
        if current in ("pending", "waitlisted"):
            return "declined"
        raise ApiError(409, "invalid_transition")
    if action == "remove":
        if current == "approved":
            return "declined"
        raise ApiError(409, "invalid_transition")
    raise ApiError(422, "unknown_action")


def canonical_guest_id(raw):
    """A guest id is valid only as canonical decimal of a positive integer."""
    if not isinstance(raw, str) or not raw or len(raw) > 19:
        return None
    if not raw.isdigit() or raw[0] == "0":
        return None
    value = int(raw)
    if value <= 0 or value > 9223372036854775807:
        return None
    return value


def find_guest(h, event_id, raw_id):
    """The guest lookup: only registrations of this event are known."""
    guest_id = canonical_guest_id(raw_id)
    if guest_id is None:
        raise ApiError(404, "not_found")
    row = h.one(
        """SELECT r.id, r.member_id, r.status, m.name
           FROM registrations r JOIN members m ON m.id = r.member_id
           WHERE r.id = %s AND r.event_id = %s""",
        (guest_id, event_id))
    if row is None:
        raise ApiError(404, "not_found")
    return row

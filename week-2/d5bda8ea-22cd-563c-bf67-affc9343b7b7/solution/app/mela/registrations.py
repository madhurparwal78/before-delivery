"""Registrations: the status edges, the capacity-and-promotion decision, the queue and the access-code limit.

Every change here runs inside one transaction that first takes the event's row lock (events.lock), so one
event's registrations change one request at a time and each response reads its counts after its own change.
"""
import hmac
import re

from . import bodies, config, events
from .errors import ApiError, invalid, not_found

# Host decisions: (action, current status) -> new status. Anything else is an invalid transition.
HOST_EDGES = {
    ("approve", "pending"): "approved",
    ("approve", "waitlisted"): "approved",
    ("decline", "pending"): "declined",
    ("decline", "waitlisted"): "declined",
    ("remove", "approved"): "declined",
}
LOCKOUT_FAILURES = 5
GUEST_ID = re.compile(r"[1-9][0-9]{0,18}")
MAX_ID = 9223372036854775807


def queue(conn, event_id):
    """Waiting guests in queue order: when they last entered the waitlist, registration id breaking ties."""
    return conn.execute(
        "SELECT r.id, m.name FROM registrations r JOIN members m ON m.id = r.member_id"
        " WHERE r.event_id = %s AND r.status = 'waitlisted' ORDER BY r.queued_at, r.id", (event_id,)).fetchall()


def queue_position(conn, event_id, registration_id):
    return 1 + [row["id"] for row in queue(conn, event_id)].index(registration_id)


def is_full(event):
    return event["places_left"] == 0


def entry_status(event):
    """The status a new registration gets, or None when the event is full and keeps no waitlist."""
    if is_full(event):
        return "waitlisted" if event["waitlist"] else None
    if event["require_approval"]:
        return "pending"
    return "approved" if event["waitlist_count"] == 0 else "waitlisted"


def _set_status(conn, registration_id, status, moved_up=False):
    conn.execute(
        "UPDATE registrations SET status = %s, moved_up = %s,"
        " queued_at = CASE WHEN %s = 'waitlisted' THEN clock_timestamp() ELSE queued_at END,"
        " celebrated_at = CASE WHEN %s = 'approved' THEN NULL ELSE celebrated_at END WHERE id = %s",
        (status, moved_up, status, status, registration_id))


def promote(conn, event):
    """Move the earliest waiting guests into the places now free; only on a no-approval event with a waitlist."""
    if not event["waitlist"] or event["require_approval"] or event["ended"]:
        return []
    waiting = queue(conn, event["id"])
    if event["capacity"] is not None:
        waiting = waiting[:event["places_left"]]
    for guest in waiting:
        _set_status(conn, guest["id"], "approved", moved_up=True)
    return [{"id": guest["id"], "name": guest["name"]} for guest in waiting]


def _lockout(conn, event, member):
    """Refuse with 429 while this member is locked out of this event's access code."""
    lock = conn.execute(
        "SELECT ceil(extract(epoch FROM locked_until - clock_timestamp()))::int AS seconds FROM access_code_failures"
        " WHERE event_id = %s AND member_id = %s AND locked_until > clock_timestamp()", (event["id"], member["id"])).fetchone()
    if lock:
        raise ApiError(429, "too_many_attempts", headers={"Retry-After": str(lock["seconds"])}, retry_after=lock["seconds"])


def _record_failure(conn, event, member):
    window = config.ACCESS_CODE_WINDOW_SECONDS
    conn.execute(
        "INSERT INTO access_code_failures AS f (event_id, member_id, failures, first_failed_at)"
        " VALUES (%(event)s, %(member)s, 1, clock_timestamp())"
        " ON CONFLICT (event_id, member_id) DO UPDATE SET"
        "  failures = CASE WHEN f.first_failed_at <= clock_timestamp() - make_interval(secs => %(window)s) THEN 1"
        "                  ELSE f.failures + 1 END,"
        "  first_failed_at = CASE WHEN f.first_failed_at <= clock_timestamp() - make_interval(secs => %(window)s) THEN clock_timestamp()"
        "                         ELSE f.first_failed_at END,"
        "  locked_until = CASE WHEN f.first_failed_at > clock_timestamp() - make_interval(secs => %(window)s)"
        "                       AND f.failures + 1 >= %(limit)s THEN clock_timestamp() + make_interval(secs => %(window)s) END",
        {"event": event["id"], "member": member["id"], "window": window, "limit": LOCKOUT_FAILURES})


def _code_refusal(conn, event, member, body):
    """The 403 code for a code-only event's missing or wrong access code, recording a wrong one; None when it matches."""
    code = body.get("access_code", "").strip()
    if not code:
        return "access_code_required"
    if hmac.compare_digest(code.encode(), event["access_code"].encode()):
        return None
    _record_failure(conn, event, member)
    return "invalid_access_code"


def register(conn, member, slug, body):
    """POST register: (http status, registration status, event, promoted)."""
    with conn.transaction():
        events.lock(conn, slug)
        event = events.require(conn, slug, member)
        registration = event["registration"]
        if registration and registration["status"] != "cancelled":
            return 200, registration["status"], event, []
        _lockout(conn, event, member)
        refusal = None
        if event["registration_status"] == "closed":
            refusal = "registration_closed"
        elif event["ended"]:
            refusal = "event_ended"
        elif event["registration_status"] == "code_only":
            refusal = _code_refusal(conn, event, member, body)
        if refusal is None:
            if event["is_host"]:
                raise ApiError(409, "host_cannot_register")
            status = entry_status(event)
            if status is None:
                raise ApiError(409, "event_full")
            row = conn.execute(
                "INSERT INTO registrations (event_id, member_id, status) VALUES (%s, %s, %s)"
                " ON CONFLICT (event_id, member_id) DO UPDATE SET requested_at = now() RETURNING id",
                (event["id"], member["id"], status)).fetchone()
            _set_status(conn, row["id"], status)
            conn.execute("DELETE FROM access_code_failures WHERE event_id = %s AND member_id = %s",
                         (event["id"], member["id"]))
            return 201, status, events.require(conn, slug, member), []
    raise ApiError(403, refusal)


def cancel(conn, member, slug):
    """DELETE register: (registration status, event, promoted)."""
    with conn.transaction():
        events.lock(conn, slug)
        event = events.require(conn, slug, member)
        registration = event["registration"]
        if registration is None:
            raise ApiError(404, "not_registered")
        if registration["status"] == "declined":
            raise ApiError(409, "registration_declined", status="declined")
        if registration["status"] == "cancelled":
            return "cancelled", event, []
        _set_status(conn, registration["id"], "cancelled")
        promoted = promote(conn, events.require(conn, slug, member)) if registration["status"] == "approved" else []
        return "cancelled", events.require(conn, slug, member), promoted


def guest_id(raw):
    """A guest id from the path: a canonical positive whole number that fits a bigint, else not found."""
    if GUEST_ID.fullmatch(raw) is None or int(raw) > MAX_ID:
        raise not_found()
    return int(raw)


def decide(conn, host, slug, registration_id):
    """A host's approve, decline or remove on a registration of this event: (status, event, promoted)."""
    with conn.transaction():
        events.lock(conn, slug)
        event = events.require_hosted(conn, slug, host)
        registration = conn.execute("SELECT id, status FROM registrations WHERE id = %s AND event_id = %s",
                                    (registration_id, event["id"])).fetchone()
        if registration is None:
            raise not_found()
        action = bodies.parse({"action": bodies.TEXT}).get("action")
        if action not in ("approve", "decline", "remove"):
            raise invalid({"action": "Choose approve, decline or remove"})
        status = HOST_EDGES.get((action, registration["status"]))
        if status is None:
            raise ApiError(409, "invalid_transition")
        if status == "approved" and is_full(event):
            raise ApiError(409, "event_full")
        _set_status(conn, registration["id"], status)
        promoted = promote(conn, events.require(conn, slug, host)) if action == "remove" else []
        return status, events.require(conn, slug, host), promoted


def guests(conn, event, status=None):
    positions = {row["id"]: index for index, row in enumerate(queue(conn, event["id"]), 1)}
    rows = conn.execute(
        "SELECT r.id, m.name, m.email, r.status, r.requested_at FROM registrations r JOIN members m ON m.id = r.member_id"
        " WHERE r.event_id = %s AND (%s::text IS NULL OR r.status = %s) ORDER BY r.requested_at, r.id",
        (event["id"], status, status)).fetchall()
    for row in rows:
        row["waitlist_position"] = positions.get(row["id"])
    return rows


def claim_celebration(conn, event):
    """True exactly once per confirmed place: the first time the guest sees it."""
    registration = event["registration"]
    if event["viewer_status"] != "approved" or registration["celebrated_at"] is not None:
        return False
    return conn.execute("UPDATE registrations SET celebrated_at = now() WHERE id = %s AND celebrated_at IS NULL"
                        " RETURNING id", (registration["id"],)).fetchone() is not None

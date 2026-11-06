"""Reads and writes over the Mela tables, with every count derived on read."""

import secrets

from . import domain
from .catalog import CATEGORIES, CITIES

SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"
SLUG_LENGTH = 8

EVENT_SELECT = """
    SELECT e.*, m.name AS host_name,
           c.slug AS calendar_slug, c.name AS calendar_name, c.tint AS calendar_tint,
           (SELECT count(*) FROM registrations r
             WHERE r.event_id = e.id AND r.status = 'approved') AS going_count,
           (SELECT count(*) FROM registrations r
             WHERE r.event_id = e.id AND r.status = 'waitlisted') AS waitlist_count
      FROM events e
      JOIN members m ON m.id = e.host_id
      LEFT JOIN calendars c ON c.id = e.calendar_id
"""

EVENT_LIST_SELECT = """
    SELECT e.slug, e.name, e.start_at, e.end_at, e.timezone, e.city,
           e.venue_name, e.theme, e.categories
      FROM events e
     WHERE e.visibility = 'public' AND e.end_at > now()
"""


def _viewer_fields(conn, event: dict, viewer_id: int | None) -> dict:
    event["going_count"] = int(event["going_count"])
    event["waitlist_count"] = int(event["waitlist_count"])
    event["places_left"] = (
        None if event["capacity"] is None else event["capacity"] - event["going_count"]
    )
    event["is_host"] = viewer_id is not None and viewer_id == event["host_id"]
    event["has_access_code"] = event["access_code"] is not None
    event["viewer_status"] = None
    event["viewer_waitlist_position"] = None
    event["viewer_registration_id"] = None
    event["viewer_moved_up"] = False
    if viewer_id is None:
        return event
    row = conn.execute(
        """
        SELECT id, status, waitlisted_at, promoted_from_waitlist FROM registrations
         WHERE event_id = %s AND member_id = %s
        """,
        (event["id"], viewer_id),
    ).fetchone()
    if row is None or row["status"] == "cancelled":
        return event
    event["viewer_status"] = row["status"]
    event["viewer_registration_id"] = row["id"]
    event["viewer_moved_up"] = row["promoted_from_waitlist"]
    if row["status"] == "waitlisted":
        event["viewer_waitlist_position"] = waitlist_position(
            conn, event["id"], row["waitlisted_at"], row["id"]
        )
    return event


def waitlist_position(conn, event_id: int, waitlisted_at, registration_id: int) -> int:
    """Queue order is the time a guest last entered the waitlist, then the id."""
    row = conn.execute(
        """
        SELECT count(*) AS ahead FROM registrations
         WHERE event_id = %s AND status = 'waitlisted'
           AND (waitlisted_at, id) <= (%s, %s)
        """,
        (event_id, waitlisted_at, registration_id),
    ).fetchone()
    return int(row["ahead"])


def load_event(conn, slug: str, viewer_id: int | None) -> dict | None:
    row = conn.execute(EVENT_SELECT + " WHERE e.slug = %s", (slug,)).fetchone()
    if row is None:
        return None
    return _viewer_fields(conn, row, viewer_id)


def reload_event(conn, event_id: int, viewer_id: int | None) -> dict:
    row = conn.execute(EVENT_SELECT + " WHERE e.id = %s", (event_id,)).fetchone()
    return _viewer_fields(conn, row, viewer_id)


def event_json(event: dict) -> dict:
    body = {
        "slug": event["slug"],
        "name": event["name"],
        "description": event["description"],
        "start_at": domain.iso_utc(event["start_at"]),
        "end_at": domain.iso_utc(event["end_at"]),
        "timezone": event["timezone"],
        "location_type": event["location_type"],
        "venue_name": event["venue_name"],
        "city": event["city"],
        "visibility": event["visibility"],
        "require_approval": event["require_approval"],
        "capacity": event["capacity"],
        "waitlist": event["waitlist"],
        "registration_status": event["registration_status"],
        "theme": event["theme"],
        "categories": list(event["categories"]),
        "calendar": event["calendar_slug"],
        "show_guest_list": event["show_guest_list"],
        "host": {"id": event["host_id"], "name": event["host_name"]},
        "going_count": event["going_count"],
        "places_left": event["places_left"],
        "waitlist_count": event["waitlist_count"],
        "viewer_status": event["viewer_status"],
        "viewer_waitlist_position": event["viewer_waitlist_position"],
        "is_host": event["is_host"],
    }
    if domain.can_see_address(event):
        body["street_address"] = event["street_address"]
        body["virtual_link"] = event["virtual_link"]
    return body


def new_slug(conn) -> str:
    while True:
        slug = "".join(secrets.choice(SLUG_ALPHABET) for _ in range(SLUG_LENGTH))
        taken = conn.execute(
            "SELECT 1 FROM events WHERE slug = %s", (slug,)
        ).fetchone()
        if taken is None:
            return slug


def upcoming_events(
    conn, city: str | None = None, category: str | None = None, limit: int | None = None
) -> list[dict]:
    sql = EVENT_LIST_SELECT
    params: list = []
    if city is not None:
        sql += " AND e.city = %s"
        params.append(city)
    if category is not None:
        sql += " AND %s = ANY (e.categories)"
        params.append(category)
    sql += " ORDER BY e.start_at, e.id"
    if limit is not None:
        sql += " LIMIT %s"
        params.append(limit)
    return conn.execute(sql, tuple(params)).fetchall()


def city_counts(conn) -> list[dict]:
    rows = conn.execute(
        """
        SELECT city, count(*) AS n FROM events
         WHERE visibility = 'public' AND end_at > now()
         GROUP BY city
        """
    ).fetchall()
    found = {row["city"]: int(row["n"]) for row in rows}
    return [
        {"slug": slug, "name": name, "event_count": found.get(name, 0)}
        for slug, name in CITIES
    ]


def category_counts(conn) -> list[dict]:
    rows = conn.execute(
        """
        SELECT category, count(*) AS n
          FROM events e, unnest(e.categories) AS category
         WHERE e.visibility = 'public' AND e.end_at > now()
         GROUP BY category
        """
    ).fetchall()
    found = {row["category"]: int(row["n"]) for row in rows}
    return [
        {"slug": slug, "name": name, "event_count": found.get(slug, 0)}
        for slug, name in CATEGORIES
    ]


def calendars(conn, viewer_id: int | None = None) -> list[dict]:
    rows = conn.execute(
        """
        SELECT c.slug, c.name, c.description, c.city, c.tint,
               (SELECT count(*) FROM follows f WHERE f.calendar_id = c.id)
                   AS follower_count,
               EXISTS (SELECT 1 FROM follows f
                        WHERE f.calendar_id = c.id AND f.member_id = %s) AS following
          FROM calendars c
         ORDER BY c.id
        """,
        (viewer_id,),
    ).fetchall()
    for row in rows:
        row["follower_count"] = int(row["follower_count"])
    return rows


def load_calendar(conn, slug: str, viewer_id: int | None) -> dict | None:
    row = conn.execute(
        """
        SELECT c.id, c.slug, c.name, c.description, c.city, c.tint,
               (SELECT count(*) FROM follows f WHERE f.calendar_id = c.id)
                   AS follower_count,
               EXISTS (SELECT 1 FROM follows f
                        WHERE f.calendar_id = c.id AND f.member_id = %s) AS following
          FROM calendars c
         WHERE c.slug = %s
        """,
        (viewer_id, slug),
    ).fetchone()
    if row is not None:
        row["follower_count"] = int(row["follower_count"])
    return row


def calendar_events(conn, calendar_id: int) -> list[dict]:
    return conn.execute(
        EVENT_LIST_SELECT + " AND e.calendar_id = %s ORDER BY e.start_at, e.id",
        (calendar_id,),
    ).fetchall()


def followed_calendars(conn, member_id: int) -> list[dict]:
    return conn.execute(
        """
        SELECT c.slug, c.name FROM calendars c
          JOIN follows f ON f.calendar_id = c.id AND f.member_id = %s
         ORDER BY c.name
        """,
        (member_id,),
    ).fetchall()


MY_EVENTS_SELECT = """
    SELECT e.slug, e.name, e.start_at, e.end_at, e.timezone, e.theme,
           e.host_id, r.status
      FROM events e
      LEFT JOIN registrations r
        ON r.event_id = e.id AND r.member_id = %(member)s
     WHERE (e.host_id = %(member)s
            OR r.status IN ('pending', 'approved', 'waitlisted', 'declined'))
"""

PILLS = {
    "approved": "going",
    "pending": "pending",
    "waitlisted": "waitlist",
    "declined": "declined",
}


def my_events(conn, member_id: int, tab: str) -> list[dict]:
    if tab == "past":
        sql = MY_EVENTS_SELECT + " AND e.end_at <= now() ORDER BY e.start_at DESC, e.id"
    else:
        sql = MY_EVENTS_SELECT + " AND e.end_at > now() ORDER BY e.start_at, e.id"
    rows = conn.execute(sql, {"member": member_id}).fetchall()
    for row in rows:
        row["pill"] = (
            "hosting" if row["host_id"] == member_id else PILLS[row["status"]]
        )
    return rows


def guest_list(conn, event_id: int, status: str | None = None) -> list[dict]:
    sql = """
        SELECT r.id, m.name, m.email, r.status, r.requested_at, r.waitlisted_at
          FROM registrations r
          JOIN members m ON m.id = r.member_id
         WHERE r.event_id = %s
    """
    params: list = [event_id]
    if status is not None:
        sql += " AND r.status = %s"
        params.append(status)
    sql += " ORDER BY r.requested_at, r.id"
    rows = conn.execute(sql, tuple(params)).fetchall()
    for row in rows:
        row["waitlist_position"] = (
            waitlist_position(conn, event_id, row["waitlisted_at"], row["id"])
            if row["status"] == "waitlisted"
            else None
        )
        row.pop("waitlisted_at")
    return rows


def guest_counts(conn, event_id: int) -> dict:
    rows = conn.execute(
        "SELECT status, count(*) AS n FROM registrations WHERE event_id = %s"
        " GROUP BY status",
        (event_id,),
    ).fetchall()
    counts = {status: 0 for status in ("pending", "approved", "waitlisted", "declined")}
    for row in rows:
        if row["status"] in counts:
            counts[row["status"]] = int(row["n"])
    return counts


def guest_faces(conn, event_id: int, limit: int = 6) -> list[dict]:
    return conn.execute(
        """
        SELECT m.name FROM registrations r
          JOIN members m ON m.id = r.member_id
         WHERE r.event_id = %s AND r.status = 'approved'
         ORDER BY r.requested_at, r.id
         LIMIT %s
        """,
        (event_id, limit),
    ).fetchall()

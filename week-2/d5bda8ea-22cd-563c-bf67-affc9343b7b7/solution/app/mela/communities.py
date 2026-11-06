"""Community calendars, follows, and the host messages and reports members send about an event."""
import re

from psycopg.types.json import Jsonb

from . import config
from .domain import REPORT_REASONS
from .errors import ApiError, invalid, not_found

CALENDAR_SELECT = """
SELECT c.id, c.slug, c.name, c.description, c.city, c.tint,
       (SELECT count(*) FROM follows f WHERE f.calendar_id = c.id) AS follower_count
FROM calendars c
"""
IDEMPOTENCY_KEY = re.compile(r"[A-Za-z0-9_-]{1,64}")


def calendars(conn, member):
    rows = conn.execute(CALENDAR_SELECT + " ORDER BY c.id").fetchall()
    followed = set()
    if member:
        followed = {row["calendar_id"] for row in conn.execute(
            "SELECT calendar_id FROM follows WHERE member_id = %s", (member["id"],))}
    for row in rows:
        row["following"] = row["id"] in followed
    return rows


def calendar(conn, slug, member):
    """One community calendar with its follower count, or None."""
    return next((row for row in calendars(conn, member) if row["slug"] == slug), None)


def follow(conn, member, slug, following):
    """PUT or DELETE follow; returns the follower count after this request's own change."""
    with conn.transaction():
        found = conn.execute("SELECT id FROM calendars WHERE slug = %s", (slug,)).fetchone()
        if found is None:
            raise not_found()
        if following:
            conn.execute("INSERT INTO follows (member_id, calendar_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                         (member["id"], found["id"]))
        else:
            conn.execute("DELETE FROM follows WHERE member_id = %s AND calendar_id = %s", (member["id"], found["id"]))
        return conn.execute(CALENDAR_SELECT + " WHERE c.id = %s", (found["id"],)).fetchone()["follower_count"]


def idempotency_key(header):
    if header is not None and IDEMPOTENCY_KEY.fullmatch(header) is None:
        raise invalid({"idempotency_key": "Idempotency-Key must be 1 to 64 letters, digits, hyphens or underscores"})
    return header


SENDS = {
    "host_messages": ("message",),
    "event_reports": ("reason", "details"),
}


def _remembered(conn, table, member, event, key):
    return conn.execute(
        f"SELECT id, idempotency_body FROM {table} WHERE member_id = %s AND event_id = %s AND idempotency_key = %s",
        (member["id"], event["id"], key)).fetchone()


def _replay(row, body):
    if row["idempotency_body"] != body:
        raise ApiError(422, "idempotency_key_reused")
    return row["id"]


def send_once(conn, table, member, event, key, body, validate):
    """Store one host message or report per Idempotency-Key; a repeat with the same body returns the first id."""
    with conn.transaction():
        if key is not None:
            conn.execute(
                f"UPDATE {table} SET idempotency_key = NULL WHERE member_id = %s AND event_id = %s"
                " AND idempotency_key = %s AND created_at <= now() - make_interval(secs => %s)",
                (member["id"], event["id"], key, config.IDEMPOTENCY_RETENTION_SECONDS))
            row = _remembered(conn, table, member, event, key)
            if row:
                return _replay(row, body)
        values = validate(body)
        columns = SENDS[table]
        inserted = conn.execute(
            f"INSERT INTO {table} (member_id, event_id, {', '.join(columns)}, idempotency_key, idempotency_body)"
            f" VALUES (%s, %s, {', '.join(['%s'] * len(columns))}, %s, %s)"
            " ON CONFLICT (member_id, event_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING"
            " RETURNING id",
            (member["id"], event["id"], *(values[c] for c in columns), key, Jsonb(body) if key else None)).fetchone()
        if inserted:
            return inserted["id"]
        return _replay(_remembered(conn, table, member, event, key), body)


def message_values(body):
    message = body.get("message", "").strip()
    if not 1 <= len(message) <= 1000:
        raise invalid({"message": "Write a message of 1 to 1,000 characters"})
    return {"message": message}


def report_values(body):
    errors = {}
    if body.get("reason") not in dict(REPORT_REASONS):
        errors["reason"] = "Choose spam, misleading, inappropriate or other"
    details = body.get("details", "").strip()
    if len(details) > 1000:
        errors["details"] = "Details can be at most 1,000 characters"
    if errors:
        raise invalid(errors)
    return {"reason": body["reason"], "details": details}

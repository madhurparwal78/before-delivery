"""Transitions: the whole pipeline in one transaction per change."""
from __future__ import annotations

import datetime as dt
import json

import psycopg

from . import emails, rules
from .inquiries import FieldRefusal, iso_or_none, outbox_insert, utc_now
from .labels import DECLINE_REASONS, STATUS_LABELS, Stockholm, status_line


class TransitionRefusal(Exception):
    def __init__(self, status: int, field: str | None, message: str):
        super().__init__(message)
        self.status = status
        self.field = field
        self.message = message


def _refuse(spec: tuple) -> TransitionRefusal:
    status, field, message = spec
    return TransitionRefusal(status, field, message)


def apply_transition(conn, inquiry: dict, actor: dict, action, version, call_at, decline_reason) -> dict:
    """Apply one transition with every check, or raise TransitionRefusal."""
    now = utc_now()

    if not isinstance(version, int) or isinstance(version, bool):
        raise _refuse((412, "version", "This inquiry changed since you opened it. Reload to see the latest."))
    if version != inquiry["version"]:
        raise _refuse((412, "version", "This inquiry changed since you opened it. Reload to see the latest."))

    if not isinstance(action, str) or action not in rules.TRANSITIONS_BY_ACTION:
        raise _refuse((409, "action", "This action is not allowed from the current status."))

    spec = rules.transition_from(action, inquiry["status"])
    if spec is None:
        raise _refuse((409, "action", "This action is not allowed from the current status."))

    if "lead" in spec["roles"] and actor["role"] not in spec["roles"]:
        raise _refuse((403, "action", "Only a studio lead can do this."))

    needs_call = action in ("book_call", "reschedule_call")
    new_status = spec["to"]
    new_call_at = inquiry["call_at"]
    new_decline_reason = None

    if needs_call:
        if not isinstance(call_at, str):
            raise _refuse((422, "call_at", "Choose a call time in the future."))
        parsed = rules.parse_call_at(call_at, now)
        if parsed is None or parsed <= now:
            raise _refuse((422, "call_at", "Choose a call time in the future."))
        failure = rules.check_call_time(parsed, now)
        if failure is not None:
            messages = {
                "call_missing": (422, "call_at", "Choose a call time in the future."),
                "call_too_far": (422, "call_at", "Choose a call time within the next 90 days."),
                "call_hours": (422, "call_at", "Calls are booked on weekdays between 09:00 and 17:00 Stockholm time."),
                "call_closed": (422, "call_at", "The studio is closed that day."),
                "call_quarter": (422, "call_at", "Choose a time on a quarter hour."),
            }
            raise _refuse(messages[failure])
        new_call_at = parsed

    if action == "decline":
        if not isinstance(decline_reason, str) or decline_reason not in DECLINE_REASONS:
            raise _refuse((422, "decline_reason", "Choose a reason."))
        new_decline_reason = decline_reason

    if action == "mark_won":
        stored_call = inquiry["call_at"]
        if stored_call is None or stored_call >= now:
            raise _refuse((409, "action", "Mark won after the intro call has taken place."))

    if action == "reopen":
        decline_entry = conn.execute(
            """
            SELECT created_at FROM status_events
            WHERE inquiry_id = %(i)s AND action = 'decline'
            ORDER BY id DESC LIMIT 1
            """,
            {"i": inquiry["id"]},
        ).fetchone()
        if decline_entry is None:
            raise _refuse((409, "action", "This action is not allowed from the current status."))
        elapsed = (now - decline_entry["created_at"].astimezone(dt.timezone.utc)).total_seconds()
        if elapsed >= _reopen_window():
            raise _refuse((409, "action", "This inquiry can no longer be reopened."))
        new_call_at = None
        new_decline_reason = None

    calendar_text = None
    calendar_method = None

    with conn.transaction():
        if needs_call:
            _check_overlap(conn, inquiry, new_call_at)
        _write_transition(
            conn, inquiry, actor, action, new_status, new_call_at,
            new_decline_reason, now,
        )
        if needs_call:
            calendar_text, calendar_method = _invitation(
                conn, inquiry, new_call_at, now, cancel=False
            )
        elif action == "decline" and inquiry["status"] == "call_booked":
            calendar_text, calendar_method = _invitation(
                conn, inquiry, inquiry["call_at"], now, cancel=True
            )
        updated = _load_inquiry(conn, inquiry["id"])
        email = emails.transition_email(
            updated, new_status, calendar_text, calendar_method
        )
        outbox_insert(conn, inquiry["id"], email)
    return updated


def _reopen_window() -> int:
    from .config import CONFIG
    return CONFIG.reopen_window_seconds


CALENDAR_LOCK_KEY = 615004233


def _check_overlap(conn, inquiry: dict, call_at: dt.datetime) -> None:
    # One calendar: serialise every booking check so two requests for
    # overlapping slots cannot both pass the check.
    conn.execute("SELECT pg_advisory_xact_lock(%(k)s)", {"k": CALENDAR_LOCK_KEY})
    start, end = rules.call_bounds(call_at)
    row = conn.execute(
        """
        SELECT id FROM inquiries
        WHERE status = 'call_booked'
          AND id <> %(i)s
          AND call_at IS NOT NULL
          AND call_at < %(end)s
          AND (call_at + interval '45 minutes') > %(start)s
        LIMIT 1
        FOR UPDATE
        """,
        {"i": inquiry["id"], "start": start, "end": end},
    ).fetchone()
    if row is not None:
        raise TransitionRefusal(409, "call_at", "That time overlaps another booked call.")


def _write_transition(conn, inquiry: dict, actor: dict, action: str, new_status: str,
                      call_at, decline_reason, now: dt.datetime) -> None:
    row = conn.execute(
        """
        UPDATE inquiries
           SET status = %(status)s,
               call_at = %(call_at)s,
               decline_reason = %(reason)s,
               version = version + 1,
               updated_at = %(now)s
         WHERE id = %(i)s AND version = %(expected)s
         RETURNING version
        """,
        {
            "status": new_status,
            "call_at": call_at,
            "reason": decline_reason,
            "now": now,
            "i": inquiry["id"],
            "expected": inquiry["version"],
        },
    ).fetchone()
    if row is None:
        raise TransitionRefusal(412, "version",
                               "This inquiry changed since you opened it. Reload to see the latest.")
    conn.execute(
        """
        INSERT INTO status_events
            (inquiry_id, action, from_status, to_status, call_at, decline_reason, actor_id, created_at)
        VALUES (%(i)s, %(action)s, %(from)s, %(to)s, %(call_at)s, %(reason)s, %(actor)s, %(now)s)
        """,
        {
            "i": inquiry["id"],
            "expected": inquiry["version"],
            "action": action,
            "from": inquiry["status"],
            "to": new_status,
            "call_at": call_at,
            "reason": decline_reason,
            "actor": actor["id"],
            "now": now,
        },
    )


def _invitation(conn, inquiry: dict, call_at: dt.datetime, now: dt.datetime,
                cancel: bool) -> tuple[str, str]:
    seq_row = conn.execute(
        """
        SELECT COUNT(*) AS n FROM status_events
        WHERE inquiry_id = %(i)s
          AND (
                action IN ('book_call', 'reschedule_call')
             OR (action = 'decline' AND from_status = 'call_booked')
          )
        """,
        {"i": inquiry["id"]},
    ).fetchone()
    sequence = seq_row["n"]
    method = "CANCEL" if cancel else "REQUEST"
    text = emails.intro_call_invitation(inquiry, sequence, call_at, now, cancel=cancel)
    return text, method


def _load_inquiry(conn, inquiry_id: int) -> dict:
    return conn.execute("SELECT * FROM inquiries WHERE id = %(i)s", {"i": inquiry_id}).fetchone()

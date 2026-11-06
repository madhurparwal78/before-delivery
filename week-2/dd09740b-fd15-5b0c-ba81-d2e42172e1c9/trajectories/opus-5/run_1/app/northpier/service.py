"""The desk's operations: sending an inquiry, the pipeline, notes and the queue."""

from __future__ import annotations

import math
import secrets
from datetime import datetime, timedelta
from typing import Any


from . import errors, mailer, records, validation
from .calendar_rules import CALL_DURATION, now_utc
from .config import CONFIG
from .db import (
    LOCK_CALENDAR,
    LOCK_FLOOD,
    LOCK_INQUIRY_KEY,
    LOCK_TRANSITION_KEY,
    Connection,
    advisory_lock,
    json_param,
    text_lock_key,
)
from .domain import (
    LEAD,
    LEAD_ONLY_ACTIONS,
    STATUS_CALL_BOOKED,
    STATUS_NEW,
    transition_for,
)

REFERENCE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
FLOOD_LIMIT = 5
INQUIRY_COLUMNS = (
    "id, reference, name, email, company, services, budget, timeline, message, "
    "status, call_at, decline_reason, version, created_at, updated_at"
)
QUEUE_COLUMNS = (
    "id, reference, name, email, company, services, budget, timeline, "
    "status, call_at, decline_reason, version, created_at, updated_at"
)
SEQUENCE_ACTIONS_SQL = (
    "(action IN ('book_call', 'reschedule_call') "
    "OR (action = 'decline' AND from_status = 'call_booked'))"
)


def mint_reference() -> str:
    return "NP-" + "".join(secrets.choice(REFERENCE_ALPHABET) for _ in range(6))


def mint_status_token() -> str:
    return secrets.token_urlsafe(24)


def mint_idempotency_key() -> str:
    return secrets.token_urlsafe(24)


# ---------------------------------------------------------------------------
# Cases
# ---------------------------------------------------------------------------


def list_cases(conn: Connection) -> list[dict[str, Any]]:
    return conn.execute("SELECT * FROM cases ORDER BY position").fetchall()


def more_cases(cases: list[dict[str, Any]], slug: str, count: int = 2) -> list[dict[str, Any]]:
    """The next cases in position order, wrapping around."""
    index = next(i for i, case in enumerate(cases) if case["slug"] == slug)
    return [cases[(index + step) % len(cases)] for step in range(1, count + 1)]


# ---------------------------------------------------------------------------
# Sending an inquiry
# ---------------------------------------------------------------------------


def _claim_inquiry_key(
    conn: Connection, key: str, body: dict[str, Any]
) -> dict[str, Any] | None:
    """Replay body when the key was already used for an equal body, else None."""
    advisory_lock(conn, LOCK_INQUIRY_KEY, text_lock_key(key))
    row = conn.execute(
        "SELECT request_body, response_body, created_at FROM idempotency_keys WHERE key = %s",
        (key,),
    ).fetchone()
    if row is None:
        return None
    age = (now_utc() - row["created_at"]).total_seconds()
    if age >= CONFIG.idempotency_ttl_seconds:
        conn.execute("DELETE FROM idempotency_keys WHERE key = %s", (key,))
        return None
    if row["request_body"] != body:
        raise errors.inquiry_key_conflict()
    return row["response_body"]


def _check_flood(conn: Connection, email: str) -> None:
    advisory_lock(conn, LOCK_FLOOD, text_lock_key(email))
    window_start = now_utc() - timedelta(seconds=CONFIG.flood_window_seconds)
    rows = conn.execute(
        """
        SELECT created_at FROM inquiries
         WHERE email = %s AND created_at > %s
         ORDER BY created_at
        """,
        (email, window_start),
    ).fetchall()
    if len(rows) < FLOOD_LIMIT:
        return
    oldest = rows[len(rows) - FLOOD_LIMIT]["created_at"]
    expires_at = oldest + timedelta(seconds=CONFIG.flood_window_seconds)
    seconds = max(1, math.ceil((expires_at - now_utc()).total_seconds()))
    raise errors.inquiry_flood(seconds)


def _insert_inquiry(conn: Connection, valid: validation.ValidInquiry) -> dict[str, Any]:
    created_at = now_utc()
    while True:
        row = conn.execute(
            f"""
            INSERT INTO inquiries (reference, status_token, name, email, company, services,
                                   budget, timeline, message, status, version,
                                   created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, 1, %s, %s)
            ON CONFLICT DO NOTHING
            RETURNING {INQUIRY_COLUMNS}, status_token
            """,
            (
                mint_reference(),
                mint_status_token(),
                valid.name,
                valid.email,
                valid.company,
                json_param(valid.services),
                valid.budget,
                valid.timeline,
                valid.message,
                STATUS_NEW,
                created_at,
                created_at,
            ),
        ).fetchone()
        if row is not None:
            return row


def create_inquiry(
    conn: Connection, body: dict[str, Any], key: str | None
) -> tuple[int, dict[str, Any]]:
    """Store a valid inquiry with its confirmation email, or answer a replay."""
    with conn.transaction():
        if key is not None:
            replay = _claim_inquiry_key(conn, key, body)
            if replay is not None:
                return 200, replay
        valid = validation.check_inquiry(body)
        _check_flood(conn, valid.email)
        row = _insert_inquiry(conn, valid)
        conn.execute(
            """
            INSERT INTO status_events (inquiry_id, action, from_status, to_status, created_at)
            VALUES (%s, NULL, NULL, %s, %s)
            """,
            (row["id"], STATUS_NEW, row["created_at"]),
        )
        status_url = CONFIG.status_url(row["status_token"])
        subject, text = mailer.confirmation_email(
            reference=row["reference"], name=row["name"], status_url=status_url
        )
        mailer.queue_email(
            conn,
            inquiry_id=row["id"],
            to_address=row["email"],
            subject=subject,
            body=text,
        )
        response = {
            "reference": row["reference"],
            "status": row["status"],
            "status_token": row["status_token"],
            "status_url": status_url,
        }
        if key is not None:
            conn.execute(
                """
                INSERT INTO idempotency_keys (key, request_body, response_body, inquiry_id,
                                              created_at)
                VALUES (%s, %s::jsonb, %s::jsonb, %s, %s)
                """,
                (key, json_param(body), json_param(response), row["id"], now_utc()),
            )
    mailer.notify_sender()
    return 201, response


# ---------------------------------------------------------------------------
# Reading an inquiry
# ---------------------------------------------------------------------------


def find_by_status_token(conn: Connection, token: str) -> dict[str, Any] | None:
    return conn.execute(
        f"SELECT {INQUIRY_COLUMNS} FROM inquiries WHERE status_token = %s", (token,)
    ).fetchone()


def find_by_id(conn: Connection, inquiry_id: int) -> dict[str, Any] | None:
    return conn.execute(
        f"SELECT {INQUIRY_COLUMNS} FROM inquiries WHERE id = %s", (inquiry_id,)
    ).fetchone()


def parse_inquiry_id(raw: str) -> int | None:
    if not raw.isdigit():
        return None
    value = int(raw)
    return value if 0 < value < 2**63 else None


def history_of(conn: Connection, inquiry_id: int) -> list[dict[str, Any]]:
    return conn.execute(
        """
        SELECT e.action, e.from_status, e.to_status, e.call_at, e.decline_reason,
               u.name AS actor_name, e.created_at
          FROM status_events e
          LEFT JOIN studio_users u ON u.id = e.actor_id
         WHERE e.inquiry_id = %s
         ORDER BY e.id
        """,
        (inquiry_id,),
    ).fetchall()


def notes_of(conn: Connection, inquiry_id: int) -> list[dict[str, Any]]:
    return conn.execute(
        """
        SELECT n.id, n.body, u.name AS author_name, n.created_at
          FROM notes n
          JOIN studio_users u ON u.id = n.author_id
         WHERE n.inquiry_id = %s
         ORDER BY n.id DESC
        """,
        (inquiry_id,),
    ).fetchall()


def public_status(conn: Connection, token: str) -> dict[str, Any] | None:
    row = find_by_status_token(conn, token)
    if row is None:
        return None
    return records.public_inquiry(row, history_of(conn, row["id"]))


# ---------------------------------------------------------------------------
# Notes
# ---------------------------------------------------------------------------


def add_note(
    conn: Connection, inquiry_id: int, author: dict[str, Any], body: dict[str, Any]
) -> dict[str, Any]:
    text = validation.check_note_body(body.get("body"))
    with conn.transaction():
        row = conn.execute(
            """
            INSERT INTO notes (inquiry_id, author_id, body, created_at)
            VALUES (%s, %s, %s, %s)
            RETURNING id, body, created_at
            """,
            (inquiry_id, author["id"], text, now_utc()),
        ).fetchone()
    return records.note_shape({**row, "author_name": author["name"]})


# ---------------------------------------------------------------------------
# The pipeline
# ---------------------------------------------------------------------------


def _claim_transition_key(
    conn: Connection, user_id: int, inquiry_id: int, key: str, body: dict[str, Any]
) -> dict[str, Any] | None:
    advisory_lock(conn, LOCK_TRANSITION_KEY, text_lock_key(f"{user_id}:{inquiry_id}:{key}"))
    row = conn.execute(
        """
        SELECT request_body, response_body, created_at FROM transition_keys
         WHERE user_id = %s AND inquiry_id = %s AND key = %s
        """,
        (user_id, inquiry_id, key),
    ).fetchone()
    if row is None:
        return None
    age = (now_utc() - row["created_at"]).total_seconds()
    if age >= CONFIG.idempotency_ttl_seconds:
        conn.execute(
            "DELETE FROM transition_keys WHERE user_id = %s AND inquiry_id = %s AND key = %s",
            (user_id, inquiry_id, key),
        )
        return None
    if row["request_body"] != body:
        raise errors.transition_key_conflict()
    return row["response_body"]


def _check_no_overlap(conn: Connection, inquiry_id: int, call_at: datetime) -> None:
    clash = conn.execute(
        """
        SELECT 1 FROM inquiries
         WHERE status = 'call_booked'
           AND id <> %s
           AND call_at < %s
           AND call_at > %s
         LIMIT 1
        """,
        (inquiry_id, call_at + CALL_DURATION, call_at - CALL_DURATION),
    ).fetchone()
    if clash is not None:
        raise errors.call_overlap()


def _latest_decline_at(conn: Connection, inquiry_id: int) -> datetime | None:
    row = conn.execute(
        """
        SELECT created_at FROM status_events
         WHERE inquiry_id = %s AND action = 'decline'
         ORDER BY id DESC LIMIT 1
        """,
        (inquiry_id,),
    ).fetchone()
    return row["created_at"] if row else None


def _invitation_sequence(conn: Connection, inquiry_id: int) -> int:
    row = conn.execute(
        f"SELECT count(*) AS n FROM status_events WHERE inquiry_id = %s AND {SEQUENCE_ACTIONS_SQL}",
        (inquiry_id,),
    ).fetchone()
    return int(row["n"])


def check_lead_only(action: Any, role: str) -> None:
    """Step 6 of the refusal order, judged before the inquiry's status is read."""
    if isinstance(action, str) and action in LEAD_ONLY_ACTIONS and role != LEAD:
        raise errors.lead_only()


def apply_transition(
    conn: Connection,
    inquiry_id: int,
    actor: dict[str, Any],
    body: dict[str, Any],
    key: str | None,
) -> tuple[int, dict[str, Any]]:
    action = body.get("action")
    needs_calendar = action in ("book_call", "reschedule_call")
    now = now_utc()

    with conn.transaction():
        if key is not None:
            replay = _claim_transition_key(conn, actor["id"], inquiry_id, key, body)
            if replay is not None:
                return 200, replay
        if needs_calendar:
            advisory_lock(conn, LOCK_CALENDAR, 0)
        row = conn.execute(
            f"SELECT {INQUIRY_COLUMNS} FROM inquiries WHERE id = %s FOR UPDATE", (inquiry_id,)
        ).fetchone()
        if row is None:
            raise errors.not_found()

        validation.check_version(body.get("version"), row["version"])

        transition = transition_for(action, row["status"]) if isinstance(action, str) else None
        if transition is None:
            raise errors.action_not_allowed()

        if transition.action == "mark_won" and not (
            row["call_at"] is not None and row["call_at"] < now
        ):
            raise errors.call_not_held()
        if transition.action == "reopen":
            declined_at = _latest_decline_at(conn, inquiry_id)
            if declined_at is None or (
                now - declined_at
            ).total_seconds() >= CONFIG.reopen_window_seconds:
                raise errors.reopen_window_closed()

        # A decline keeps the stored call time; only a reopen clears it.
        call_at: datetime | None = row["call_at"]
        decline_reason: str | None = row["decline_reason"]
        if transition.needs_call_at:
            call_at = validation.check_call_at(body.get("call_at"), now)
            _check_no_overlap(conn, inquiry_id, call_at)
        elif transition.needs_decline_reason:
            decline_reason = validation.check_decline_reason(body.get("decline_reason"))
        elif transition.action == "reopen":
            call_at = None
            decline_reason = None

        sequence = _invitation_sequence(conn, inquiry_id)
        from_status = row["status"]

        updated = conn.execute(
            f"""
            UPDATE inquiries
               SET status = %s, call_at = %s, decline_reason = %s,
                   version = version + 1, updated_at = %s
             WHERE id = %s
            RETURNING {INQUIRY_COLUMNS}, status_token
            """,
            (transition.to_status, call_at, decline_reason, now, inquiry_id),
        ).fetchone()
        conn.execute(
            """
            INSERT INTO status_events (inquiry_id, action, from_status, to_status, call_at,
                                       decline_reason, actor_id, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                inquiry_id,
                transition.action,
                from_status,
                transition.to_status,
                call_at,
                decline_reason,
                actor["id"],
                now,
            ),
        )

        status_url = CONFIG.status_url(updated["status_token"])
        subject, text = mailer.update_email(
            reference=updated["reference"],
            status=updated["status"],
            call_at=updated["call_at"],
            decline_reason=updated["decline_reason"],
            status_url=status_url,
        )
        calendar: str | None = None
        if transition.needs_call_at:
            calendar = mailer.build_invitation(
                method="REQUEST",
                reference=updated["reference"],
                email=updated["email"],
                sequence=sequence,
                call_at=call_at,
                stamp=now,
            )
        elif transition.action == "decline" and from_status == STATUS_CALL_BOOKED:
            calendar = mailer.build_invitation(
                method="CANCEL",
                reference=updated["reference"],
                email=updated["email"],
                sequence=sequence,
                call_at=updated["call_at"],
                stamp=now,
            )
        mailer.queue_email(
            conn,
            inquiry_id=inquiry_id,
            to_address=updated["email"],
            subject=subject,
            body=text,
            calendar=calendar,
        )

        response = records.transition_result(
            updated, history_of(conn, inquiry_id), actor["role"]
        )
        if key is not None:
            conn.execute(
                """
                INSERT INTO transition_keys (user_id, inquiry_id, key, request_body,
                                             response_body, created_at)
                VALUES (%s, %s, %s, %s::jsonb, %s::jsonb, %s)
                """,
                (actor["id"], inquiry_id, key, json_param(body), json_param(response), now),
            )
    mailer.notify_sender()
    return 200, response


# ---------------------------------------------------------------------------
# The queue (Business rules 21)
# ---------------------------------------------------------------------------

_ORDERS = {
    "new": "created_at ASC, id ASC",
    "in_review": "created_at ASC, id ASC",
    "call_booked": "call_at ASC, id ASC",
    "won": "updated_at DESC, id DESC",
    "declined": "updated_at DESC, id DESC",
    "all": "created_at DESC, id DESC",
}

_SEARCH_SQL = """
    (position(lower(%(q)s) in lower(name)) > 0
     OR position(lower(%(q)s) in lower(coalesce(company, ''))) > 0
     OR position(lower(%(q)s) in lower(reference)) > 0
     OR position(lower(%(q)s) in lower(split_part(email, '@', 1))) > 0)
"""


def queue(conn: Connection, tab: str, query: str) -> dict[str, Any]:
    params: dict[str, Any] = {}
    where = "TRUE"
    if query:
        where = _SEARCH_SQL
        params["q"] = query

    count_rows = conn.execute(
        f"SELECT status, count(*) AS n FROM inquiries WHERE {where} GROUP BY status", params
    ).fetchall()
    counts = {status: 0 for status in _ORDERS if status != "all"}
    for row in count_rows:
        counts[row["status"]] = int(row["n"])
    counts["all"] = sum(value for key, value in counts.items() if key != "all")

    status_clause = "TRUE" if tab == "all" else "status = %(tab)s"
    if tab != "all":
        params["tab"] = tab
    rows = conn.execute(
        f"""
        SELECT {QUEUE_COLUMNS} FROM inquiries
         WHERE {where} AND {status_clause}
         ORDER BY {_ORDERS[tab]}
        """,
        params,
    ).fetchall()
    return {
        "inquiries": [records.studio_inquiry(row, with_message=False) for row in rows],
        "counts": counts,
    }


def studio_detail(
    conn: Connection, row: dict[str, Any], role: str
) -> dict[str, Any]:
    return records.studio_detail(
        row, history_of(conn, row["id"]), notes_of(conn, row["id"]), role
    )



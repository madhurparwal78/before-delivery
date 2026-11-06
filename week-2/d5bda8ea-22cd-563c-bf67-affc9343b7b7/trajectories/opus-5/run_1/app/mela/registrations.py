"""Registration changes, serialized per event so places are never oversold.

Every caller holds the event row with `lock_event` first, which is what makes
the capacity, the queue order and the access-code count safe across instances.
A refusal is returned rather than raised so the surrounding transaction still
commits the access-code failure it counted.
"""

from math import ceil

from . import config, domain


def lock_event(conn, event_id: int) -> None:
    conn.execute("SELECT id FROM events WHERE id = %s FOR UPDATE", (event_id,))


def _refuse(http: int, code: str, **extra) -> dict:
    return {"http": http, "code": code, **extra}


def _approved_count(conn, event_id: int) -> int:
    row = conn.execute(
        "SELECT count(*) AS n FROM registrations"
        " WHERE event_id = %s AND status = 'approved'",
        (event_id,),
    ).fetchone()
    return int(row["n"])


def _waiting_count(conn, event_id: int) -> int:
    row = conn.execute(
        "SELECT count(*) AS n FROM registrations"
        " WHERE event_id = %s AND status = 'waitlisted'",
        (event_id,),
    ).fetchone()
    return int(row["n"])


def promote_waiting(conn, event: dict) -> list[dict]:
    """Move the earliest waiting guests up into the free places."""
    if not event["waitlist"] or event["require_approval"] or domain.has_ended(event):
        return []
    free = None
    if event["capacity"] is not None:
        free = event["capacity"] - _approved_count(conn, event["id"])
        if free <= 0:
            return []
    sql = """
        SELECT r.id, m.name FROM registrations r
          JOIN members m ON m.id = r.member_id
         WHERE r.event_id = %s AND r.status = 'waitlisted'
         ORDER BY r.waitlisted_at, r.id
    """
    params: list = [event["id"]]
    if free is not None:
        sql += " LIMIT %s"
        params.append(free)
    waiting = conn.execute(sql, tuple(params)).fetchall()
    if not waiting:
        return []
    conn.execute(
        "UPDATE registrations SET status = 'approved', waitlisted_at = NULL,"
        " promoted_from_waitlist = true WHERE id = ANY (%s)",
        ([row["id"] for row in waiting],),
    )
    return [{"id": row["id"], "name": row["name"]} for row in waiting]


def _access_code_gate_locked(conn, event: dict, member_id: int) -> dict | None:
    """The lockout half of the access-code limit, counted atomically."""
    window = config.ACCESS_CODE_WINDOW_SECONDS
    conn.execute(
        "INSERT INTO access_code_attempts (event_id, member_id)"
        " VALUES (%s, %s) ON CONFLICT DO NOTHING",
        (event["id"], member_id),
    )
    row = conn.execute(
        "SELECT failures, window_start, locked_until, now() AS now"
        " FROM access_code_attempts WHERE event_id = %s AND member_id = %s FOR UPDATE",
        (event["id"], member_id),
    ).fetchone()
    if row["locked_until"] is not None and row["locked_until"] > row["now"]:
        remaining = ceil((row["locked_until"] - row["now"]).total_seconds())
        return _refuse(
            429,
            "too_many_attempts",
            retry_after=max(1, min(remaining, window)),
        )
    return None


def _count_access_code_failure(conn, event: dict, member_id: int) -> None:
    window = config.ACCESS_CODE_WINDOW_SECONDS
    conn.execute(
        """
        UPDATE access_code_attempts AS a
           SET failures = CASE WHEN a.locked_until IS NOT NULL
                                 OR now() - a.window_start > make_interval(secs => %(w)s)
                               THEN 1 ELSE a.failures + 1 END,
               window_start = CASE WHEN a.locked_until IS NOT NULL
                                     OR now() - a.window_start
                                        > make_interval(secs => %(w)s)
                                   THEN now() ELSE a.window_start END,
               locked_until = NULL
         WHERE a.event_id = %(event)s AND a.member_id = %(member)s
        """,
        {"w": window, "event": event["id"], "member": member_id},
    )
    conn.execute(
        """
        UPDATE access_code_attempts
           SET locked_until = now() + make_interval(secs => %(w)s)
         WHERE event_id = %(event)s AND member_id = %(member)s
           AND failures >= %(limit)s
        """,
        {
            "w": window,
            "event": event["id"],
            "member": member_id,
            "limit": config.ACCESS_CODE_FAILURE_LIMIT,
        },
    )


def _clear_access_code_failures(conn, event_id: int, member_id: int) -> None:
    conn.execute(
        "DELETE FROM access_code_attempts WHERE event_id = %s AND member_id = %s",
        (event_id, member_id),
    )


def register(conn, event: dict, member_id: int, access_code: str | None) -> dict:
    """Decide and store one member's place on an event already locked."""
    existing = conn.execute(
        "SELECT id, status FROM registrations WHERE event_id = %s AND member_id = %s",
        (event["id"], member_id),
    ).fetchone()
    if existing is not None and existing["status"] in domain.ACTIVE_STATUSES:
        return {"http": 200, "status": existing["status"], "promoted": []}

    code_only = event["registration_status"] == "code_only"
    if code_only:
        locked = _access_code_gate_locked(conn, event, member_id)
        if locked is not None:
            return locked
    if event["registration_status"] == "closed":
        return _refuse(403, "registration_closed")
    if domain.has_ended(event):
        return _refuse(403, "event_ended")
    if code_only:
        given = (access_code or "").strip()
        if not given:
            return _refuse(403, "access_code_required")
        if given != event["access_code"]:
            _count_access_code_failure(conn, event, member_id)
            return _refuse(403, "invalid_access_code")
    if event["host_id"] == member_id:
        return _refuse(409, "host_cannot_register")

    going = _approved_count(conn, event["id"])
    waiting = _waiting_count(conn, event["id"])
    if event["capacity"] is not None and going >= event["capacity"]:
        if not event["waitlist"]:
            return _refuse(409, "event_full")
        status = "waitlisted"
    elif event["require_approval"]:
        status = "pending"
    else:
        status = "approved" if waiting == 0 else "waitlisted"

    waitlisted_at = "clock_timestamp()" if status == "waitlisted" else "NULL"
    if existing is None:
        conn.execute(
            f"""
            INSERT INTO registrations
                (event_id, member_id, status, requested_at, waitlisted_at)
            VALUES (%s, %s, %s, clock_timestamp(), {waitlisted_at})
            """,
            (event["id"], member_id, status),
        )
    else:
        conn.execute(
            f"""
            UPDATE registrations
               SET status = %s, requested_at = clock_timestamp(),
                   waitlisted_at = {waitlisted_at},
                   promoted_from_waitlist = false
             WHERE id = %s
            """,
            (status, existing["id"]),
        )
    _clear_access_code_failures(conn, event["id"], member_id)
    return {"http": 201, "status": status, "promoted": []}


def cancel(conn, event: dict, member_id: int) -> dict:
    row = conn.execute(
        "SELECT id, status FROM registrations WHERE event_id = %s AND member_id = %s",
        (event["id"], member_id),
    ).fetchone()
    if row is None:
        return _refuse(404, "not_registered")
    if row["status"] == "cancelled":
        return {"http": 200, "status": "cancelled", "promoted": []}
    if row["status"] == "declined":
        return _refuse(409, "registration_declined", status="declined")
    was_approved = row["status"] == "approved"
    conn.execute(
        "UPDATE registrations SET status = 'cancelled', waitlisted_at = NULL,"
        " promoted_from_waitlist = false WHERE id = %s",
        (row["id"],),
    )
    promoted = promote_waiting(conn, event) if was_approved else []
    return {"http": 200, "status": "cancelled", "promoted": promoted}


def find_guest(conn, event_id: int, guest_id: int) -> dict | None:
    """A guest is looked up only among the registrations of its own event."""
    return conn.execute(
        "SELECT id, status FROM registrations WHERE id = %s AND event_id = %s",
        (guest_id, event_id),
    ).fetchone()


def host_decision(conn, event: dict, row: dict, action: str) -> dict:
    """Approve, decline or remove one guest of this event."""
    target = domain.HOST_ACTIONS[action].get(row["status"])
    if target is None:
        return _refuse(409, "invalid_transition")
    if target == "approved" and domain.is_full(
        {**event, "going_count": _approved_count(conn, event["id"])}
    ):
        return _refuse(409, "event_full")
    conn.execute(
        "UPDATE registrations SET status = %s, waitlisted_at = NULL,"
        " promoted_from_waitlist = false WHERE id = %s",
        (target, row["id"]),
    )
    return {
        "http": 200,
        "status": target,
        "promoted": promote_waiting(conn, event) if action == "remove" else [],
    }


def capacity_floor_refusal(conn, event: dict, capacity: int | None) -> dict | None:
    """The capacity floor, checked at the edit's own serialized moment."""
    if capacity is None:
        return None
    going = _approved_count(conn, event["id"])
    if capacity >= going:
        return None
    return {
        "http": 422,
        "errors": {"capacity": domain.capacity_floor_message(going)},
    }

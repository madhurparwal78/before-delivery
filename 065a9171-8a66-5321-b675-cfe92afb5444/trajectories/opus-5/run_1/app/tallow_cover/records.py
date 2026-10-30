"""Record loaders, shared by the endpoints that read and write them."""

from __future__ import annotations

from .db import row, rows
from .projections import ATTENDANCE_SELECT, LEAVE_SELECT

COVER_SELECT = """
    SELECT c.id, c.leave_request_id, c.home_id, c.unit_id, c.shift_date, c.shift, c.skill,
           c.status, c.claimed_by, c.assignment_id, h.name AS home_name, u.name AS unit_name,
           p.display_name AS claimed_by_name
    FROM cover_shifts c
    JOIN homes h ON h.id = c.home_id
    JOIN units u ON u.id = c.unit_id
    LEFT JOIN people p ON p.id = c.claimed_by
"""

SICKNESS_SELECT = """
    SELECT s.id, s.person_id, s.home_id, s.start_date, s.last_sick_date, s.status, s.reason,
           p.display_name AS person_name, p.email AS person_email
    FROM sickness_records s JOIN people p ON p.id = s.person_id
"""


def load_attendance(conn, attendance_id: str, for_update: bool = False) -> dict | None:
    lock = " FOR UPDATE OF a" if for_update else ""
    return row(conn, f"{ATTENDANCE_SELECT} WHERE a.id = %s{lock}", (attendance_id,))


def load_leave_request(conn, request_id: str, for_update: bool = False) -> dict | None:
    lock = " FOR UPDATE OF r" if for_update else ""
    return row(conn, f"{LEAVE_SELECT} WHERE r.id = %s{lock}", (request_id,))


def load_cover(conn, cover_id: str, for_update: bool = False) -> dict | None:
    lock = " FOR UPDATE OF c" if for_update else ""
    return row(conn, f"{COVER_SELECT} WHERE c.id = %s{lock}", (cover_id,))


def load_sickness(conn, sickness_id: str, for_update: bool = False) -> dict | None:
    lock = " FOR UPDATE OF s" if for_update else ""
    return row(conn, f"{SICKNESS_SELECT} WHERE s.id = %s{lock}", (sickness_id,))


def load_fit_note(conn, sickness_id: str) -> dict | None:
    return row(
        conn,
        """SELECT id, file_name, content_type, storage, storage_key, uploaded_at
           FROM uploads WHERE sickness_id = %s ORDER BY uploaded_at DESC, id DESC LIMIT 1""",
        (sickness_id,),
    )


def open_attendance_of(conn, person_id: str) -> list[dict]:
    """Every attendance of the person that has no clock-out yet, newest first."""
    return rows(
        conn,
        f"""{ATTENDANCE_SELECT} WHERE a.person_id = %s AND a.clock_out_at IS NULL
            ORDER BY a.clock_in_at DESC""",
        (person_id,),
    )

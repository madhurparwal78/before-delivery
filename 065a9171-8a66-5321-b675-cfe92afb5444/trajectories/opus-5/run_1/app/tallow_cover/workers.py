"""Background work: service probes, the outbox, held uploads and the sweeps."""

from __future__ import annotations

import smtplib
import threading

from . import emails, mail, storage
from .db import execute, rows, transaction
from .domain.sickness import FIT_NOTE_AFTER_DAYS
from .config import CONFIG
from .timeutil import today_london

PROBE_SECONDS = 4
OUTBOX_SECONDS = 3
STORAGE_SECONDS = 3
ESCALATION_SECONDS = 5
SICKNESS_SECONDS = 20

SERVICE_STATE = {"mail": "down", "storage": "down"}


def probe_services() -> None:
    SERVICE_STATE["mail"] = "up" if mail.reachable() else "down"
    SERVICE_STATE["storage"] = "up" if storage.reachable() else "down"


def deliver_outbox() -> None:
    with transaction() as conn:
        pending = rows(
            conn,
            """SELECT id, to_email, subject, body FROM outbox
               WHERE sent_at IS NULL ORDER BY created_at, id
               LIMIT 50 FOR UPDATE SKIP LOCKED""",
        )
        if not pending:
            return
        with mail.open_transport() as transport:
            for entry in pending:
                try:
                    transport.send_message(
                        mail.compose(entry["to_email"], entry["subject"], entry["body"])
                    )
                except smtplib.SMTPResponseException:
                    continue
                execute(conn, "UPDATE outbox SET sent_at = now() WHERE id = %s", (entry["id"],))


def flush_held_uploads() -> None:
    with transaction() as conn:
        for upload in rows(
            conn,
            """SELECT id, storage_key, content_type, content FROM uploads
               WHERE storage = 'pending' ORDER BY uploaded_at
               LIMIT 20 FOR UPDATE SKIP LOCKED""",
        ):
            storage.put_object(
                upload["storage_key"], bytes(upload["content"]), upload["content_type"]
            )
            execute(conn, "UPDATE uploads SET storage = 'stored' WHERE id = %s", (upload["id"],))
    with transaction() as conn:
        for export in rows(
            conn,
            """SELECT id, storage_key, content FROM timesheet_exports
               WHERE storage = 'pending' ORDER BY created_at
               LIMIT 20 FOR UPDATE SKIP LOCKED""",
        ):
            storage.put_object(export["storage_key"], bytes(export["content"]), "text/csv")
            execute(
                conn,
                "UPDATE timesheet_exports SET storage = 'stored' WHERE id = %s",
                (export["id"],),
            )


def escalate_waiting_requests() -> None:
    """A request still submitted after the escalation delay moves to escalated."""
    with transaction() as conn:
        waiting = rows(
            conn,
            """SELECT r.id, r.leave_type, r.start_date, r.end_date, r.submitted_at,
                      p.display_name AS requester_name, u.name AS unit_name,
                      m.email AS manager_email
               FROM leave_requests r
               JOIN people p ON p.id = r.requester_id
               JOIN homes h ON h.id = r.home_id
               JOIN people m ON m.id = h.manager_id
               LEFT JOIN units u ON u.id = r.unit_id
               WHERE r.status = 'submitted'
                 AND r.submitted_at <= now() - make_interval(secs => %s)
               ORDER BY r.submitted_at
               LIMIT 50 FOR UPDATE OF r SKIP LOCKED""",
            (CONFIG.escalation_after_seconds,),
        )
        for request in waiting:
            execute(
                conn,
                "UPDATE leave_requests SET status = 'escalated' WHERE id = %s",
                (request["id"],),
            )
            emails.escalation(
                conn,
                request["manager_email"],
                request["requester_name"],
                request["unit_name"],
                request,
                request["submitted_at"],
            )


def require_fit_notes() -> None:
    with transaction() as conn:
        execute(
            conn,
            """UPDATE sickness_records SET status = 'fit_note_required'
               WHERE status = 'reported'
                 AND (COALESCE(last_sick_date, %s) - start_date) + 1 > %s""",
            (today_london(), FIT_NOTE_AFTER_DAYS),
        )


def _loop(seconds: int, work) -> None:
    pause = threading.Event()
    while True:
        try:
            work()
        except Exception:  # a sweep outlives an unreachable service
            pass
        pause.wait(seconds)


def start_workers() -> None:
    jobs = (
        ("probe", PROBE_SECONDS, probe_services),
        ("outbox", OUTBOX_SECONDS, deliver_outbox),
        ("storage", STORAGE_SECONDS, flush_held_uploads),
        ("escalation", ESCALATION_SECONDS, escalate_waiting_requests),
        ("sickness", SICKNESS_SECONDS, require_fit_notes),
    )
    for name, seconds, work in jobs:
        threading.Thread(
            target=_loop, args=(seconds, work), name=f"tallow-{name}", daemon=True
        ).start()

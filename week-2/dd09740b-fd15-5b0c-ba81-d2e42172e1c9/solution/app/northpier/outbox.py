"""The email outbox: rows written in the change's own transaction, delivered over SMTP by a sender thread.

Delivery is at least once: a row is marked sent only after SMTP accepted it, under a row lock that keeps every
other sender away, and one inquiry's rows go out in order.
"""
import datetime as dt
import smtplib
import sys
import threading
from email.message import EmailMessage
from email.utils import format_datetime
from typing import Any

from northpier import db
from northpier.config import SETTINGS
from northpier.domain import CALL_ACTIONS, STATUS_LABELS, status_line
from northpier.studio_time import CALL_LENGTH, UTC

STUDIO_ADDRESS = "hello@northpier.studio"
STUDIO_FROM = f"Northpier Studio <{STUDIO_ADDRESS}>"
SMTP_TIMEOUT_S = 10
RETRY_EVERY_S = 2
_wake = threading.Event()


def status_url(token: str) -> str:
    return f"{SETTINGS.public_url}/inquiry/{token}"


def _enqueue(tx: db.Tx, inquiry: dict[str, Any], subject: str, body: str, calendar: str | None,
             now: dt.datetime) -> None:
    tx.run("INSERT INTO outbox (inquiry_id, to_address, subject, body, calendar, created_at) "
           "VALUES (:inquiry_id, :to_address, :subject, :body, :calendar, :now)",
           inquiry_id=inquiry["id"], to_address=inquiry["email"], subject=subject, body=body,
           calendar=calendar, now=now)


def enqueue_confirmation(tx: db.Tx, inquiry: dict[str, Any], now: dt.datetime) -> None:
    reference = inquiry["reference"]
    body = (f"Hi {inquiry['name']},\n\nWe have your inquiry {reference}.\n\n"
            f"Follow your inquiry: {status_url(inquiry['status_token'])}")
    _enqueue(tx, inquiry, f"We have your inquiry {reference}", body, None, now)


def invitation_sequence(tx: db.Tx, inquiry_id: int) -> int:
    """Earlier history entries that sent an invitation: book_call, reschedule_call, decline from call_booked."""
    return tx.value("SELECT count(*) FROM status_events WHERE inquiry_id = :id AND (action IN "
                    "('book_call', 'reschedule_call') OR (action = 'decline' AND from_status = 'call_booked'))",
                    id=inquiry_id)


def _fold(line: str) -> list[str]:
    """Split a content line into physical lines of at most 75 octets, continuations led by one space."""
    out, current = [], ""
    for char in line:
        if len((current + char).encode("utf-8")) > 75:
            out.append(current)
            current = " "
        current += char
    out.append(current)
    return out


def _ics_stamp(moment: dt.datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")


def invitation(method: str, inquiry: dict[str, Any], sequence: int, start: dt.datetime, now: dt.datetime) -> str:
    """One VCALENDAR with one VEVENT for the intro call, CRLF line endings, folded at 75 octets."""
    reference = inquiry["reference"]
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Northpier Studio//Inquiry desk//EN", f"METHOD:{method}",
        "BEGIN:VEVENT",
        f"UID:{reference}@northpier.studio",
        f"SEQUENCE:{sequence}",
        f"DTSTAMP:{_ics_stamp(now)}",
        f"DTSTART:{_ics_stamp(start)}",
        f"DTEND:{_ics_stamp(start + CALL_LENGTH)}",
        f"SUMMARY:Northpier intro call {reference}",
        f"ORGANIZER:mailto:{STUDIO_ADDRESS}",
        f"ATTENDEE:mailto:{inquiry['email']}",
        f"STATUS:{'CONFIRMED' if method == 'REQUEST' else 'CANCELLED'}",
        "END:VEVENT", "END:VCALENDAR",
    ]
    return "".join(physical + "\r\n" for line in lines for physical in _fold(line))


def enqueue_update(tx: db.Tx, before: dict[str, Any], after: dict[str, Any], action: str,
                   now: dt.datetime) -> None:
    """The update email for one successful transition, with the invitation rule 26 asks for.
    Call before the transition's own status event is written, so the sequence counts earlier entries only."""
    calendar = None
    if action in CALL_ACTIONS:
        calendar = invitation("REQUEST", after, invitation_sequence(tx, after["id"]), after["call_at"], now)
    elif action == "decline" and before["status"] == "call_booked":
        calendar = invitation("CANCEL", after, invitation_sequence(tx, after["id"]), before["call_at"], now)
    label = STATUS_LABELS[after["status"]]
    body = (f"{status_line(after['status'], after['call_at'], after['decline_reason'])}\n\n"
            f"Follow your inquiry: {status_url(after['status_token'])}")
    _enqueue(tx, after, f"Your inquiry {after['reference']} is now {label}", body, calendar, now)


def wake() -> None:
    """Ask this process's sender to look at the outbox now."""
    _wake.set()


def _email(row: dict[str, Any]) -> EmailMessage:
    message = EmailMessage()
    message["From"] = STUDIO_FROM
    message["To"] = row["to_address"]
    message["Subject"] = row["subject"]
    message["Date"] = format_datetime(row["created_at"])
    message["Message-ID"] = f"<{row['reference']}.{row['number']}@northpier.studio>"
    message.set_content(row["body"], charset="utf-8")
    if row["calendar"]:
        method = "CANCEL" if "\r\nMETHOD:CANCEL\r\n" in row["calendar"] else "REQUEST"
        message.add_attachment(row["calendar"].encode("utf-8"), maintype="text", subtype="calendar",
                               filename="intro-call.ics")
        part = message.get_payload()[-1]
        part.replace_header("Content-Type", f"text/calendar; method={method}; charset=UTF-8")
    return message


def _deliver_next() -> bool:
    """Send the oldest deliverable row; True when one was sent and there may be more."""
    with db.transaction() as tx:
        row = tx.one(
            "SELECT o.id, o.to_address, o.subject, o.body, o.calendar, o.created_at, i.reference, "
            "  (SELECT count(*) FROM outbox e WHERE e.inquiry_id = o.inquiry_id AND e.id < o.id) AS number "
            "FROM outbox o JOIN inquiries i ON i.id = o.inquiry_id "
            "WHERE o.sent_at IS NULL AND NOT EXISTS (SELECT 1 FROM outbox p WHERE p.inquiry_id = o.inquiry_id "
            "  AND p.sent_at IS NULL AND p.id < o.id) "
            "ORDER BY o.id LIMIT 1 FOR UPDATE OF o SKIP LOCKED")
        if row is None:
            return False
        try:
            with smtplib.SMTP(SETTINGS.smtp_host, SETTINGS.smtp_port, local_hostname="northpier.studio",
                              timeout=SMTP_TIMEOUT_S) as smtp:
                smtp.send_message(_email(row), from_addr=STUDIO_ADDRESS, to_addrs=[row["to_address"]])
        except (OSError, smtplib.SMTPException) as error:
            print(f"outbox: SMTP send failed, will retry: {type(error).__name__}", file=sys.stderr, flush=True)
            tx.run("UPDATE outbox SET attempts = attempts + 1 WHERE id = :id", id=row["id"])
            return False
        tx.run("UPDATE outbox SET attempts = attempts + 1, sent_at = clock_timestamp() WHERE id = :id",
               id=row["id"])
        return True


def run_sender() -> None:
    """Deliver pending rows whenever woken, and at least every two seconds."""
    while True:
        _wake.wait(RETRY_EVERY_S)
        _wake.clear()
        try:
            while _deliver_next():
                pass
        except db.Unavailable:
            continue
        except Exception as error:  # the sender must outlive any one bad row; the row stays unsent
            print(f"outbox: delivery round failed: {type(error).__name__}", file=sys.stderr, flush=True)

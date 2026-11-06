"""Email: the pinned copy, the calendar invitations, the outbox and its SMTP sender."""

from __future__ import annotations

import base64
import logging
import secrets
import smtplib
import threading
import time
from datetime import datetime
from email.utils import formatdate
from typing import Any


from .calendar_rules import CALL_DURATION, format_ics_stamp, now_utc
from .config import CONFIG
from .db import DATABASE, Connection, DatabaseUnavailable
from .domain import STATUS_LABELS, normalise_text, status_line

log = logging.getLogger("northpier.mail")

STUDIO_ADDRESS = "hello@northpier.studio"
STUDIO_FROM = f"Northpier Studio <{STUDIO_ADDRESS}>"
ICS_FILENAME = "intro-call.ics"
PRODID = "-//Northpier Studio//Inquiry desk//EN"

_wake = threading.Event()


# ---------------------------------------------------------------------------
# Calendar invitations (Business rules 26)
# ---------------------------------------------------------------------------


def _fold(line: str) -> str:
    """Fold a content line longer than 75 octets with CRLF and one space."""
    raw = line.encode("utf-8")
    if len(raw) <= 75:
        return line
    pieces: list[bytes] = []
    remaining = raw
    limit = 75
    while len(remaining) > limit:
        cut = limit
        while cut > 0 and (remaining[cut] & 0xC0) == 0x80:
            cut -= 1
        pieces.append(remaining[:cut])
        remaining = remaining[cut:]
        limit = 74
    pieces.append(remaining)
    return "\r\n ".join(piece.decode("utf-8") for piece in pieces)


def build_invitation(
    *,
    method: str,
    reference: str,
    email: str,
    sequence: int,
    call_at: datetime,
    stamp: datetime,
) -> str:
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        f"PRODID:{PRODID}",
        f"METHOD:{method}",
        "BEGIN:VEVENT",
        f"UID:{reference}@northpier.studio",
        f"SEQUENCE:{sequence}",
        f"DTSTAMP:{format_ics_stamp(stamp)}",
        f"DTSTART:{format_ics_stamp(call_at)}",
        f"DTEND:{format_ics_stamp(call_at + CALL_DURATION)}",
        f"SUMMARY:Northpier intro call {reference}",
        f"ORGANIZER:mailto:{STUDIO_ADDRESS}",
        f"ATTENDEE:mailto:{email}",
        "STATUS:CONFIRMED" if method == "REQUEST" else "STATUS:CANCELLED",
        "END:VEVENT",
        "END:VCALENDAR",
    ]
    return "".join(f"{_fold(line)}\r\n" for line in lines)


def invitation_method(calendar: str) -> str:
    return "CANCEL" if "METHOD:CANCEL" in calendar else "REQUEST"


# ---------------------------------------------------------------------------
# The pinned email copy (Business rules 25)
# ---------------------------------------------------------------------------


def confirmation_email(*, reference: str, name: str, status_url: str) -> tuple[str, str]:
    subject = f"We have your inquiry {reference}"
    body = (
        f"Hi {normalise_text(name)},\n"
        "\n"
        f"We have your inquiry {reference}.\n"
        "\n"
        f"Follow your inquiry: {status_url}\n"
    )
    return subject, body


def update_email(
    *,
    reference: str,
    status: str,
    call_at: datetime | None,
    decline_reason: str | None,
    status_url: str,
) -> tuple[str, str]:
    subject = f"Your inquiry {reference} is now {STATUS_LABELS[status]}"
    body = f"{status_line(status, call_at, decline_reason)}\n\nFollow your inquiry: {status_url}\n"
    return subject, body


# ---------------------------------------------------------------------------
# The outbox
# ---------------------------------------------------------------------------


def queue_email(
    conn: Connection,
    *,
    inquiry_id: int,
    to_address: str,
    subject: str,
    body: str,
    calendar: str | None = None,
) -> None:
    """Write one outbox row. Called inside the transaction that makes the change."""
    conn.execute(
        """
        INSERT INTO outbox (inquiry_id, to_address, subject, body, calendar)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (inquiry_id, to_address, subject, body, calendar),
    )


def notify_sender() -> None:
    _wake.set()


def _message_id(reference: str, earlier: int) -> str:
    return f"<{reference}.{earlier}@northpier.studio>"


def _base64_block(payload: bytes) -> str:
    encoded = base64.b64encode(payload).decode("ascii")
    return "\r\n".join(encoded[at : at + 76] for at in range(0, len(encoded), 76))


def _compose(row: dict[str, Any]) -> bytes:
    """The message bytes, written out so the MIME parameters read exactly as pinned."""
    headers = [
        f"From: {STUDIO_FROM}",
        f"To: {row['to_address']}",
        f"Reply-To: {STUDIO_ADDRESS}",
        f"Subject: {row['subject']}",
        f"Date: {formatdate(localtime=False)}",
        f"Message-ID: {_message_id(row['reference'], row['earlier'])}",
        "MIME-Version: 1.0",
    ]
    body_part = [
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: base64",
        "",
        _base64_block(row["body"].encode("utf-8")),
    ]
    calendar = row["calendar"]
    if not calendar:
        return "\r\n".join(headers + body_part).encode("ascii") + b"\r\n"

    boundary = "northpier-" + secrets.token_hex(12)
    headers.append(f'Content-Type: multipart/mixed; boundary="{boundary}"')
    lines = headers + [""]
    lines += [f"--{boundary}"] + body_part + [""]
    lines += [
        f"--{boundary}",
        f"Content-Type: text/calendar; method={invitation_method(calendar)}; charset=UTF-8",
        "Content-Transfer-Encoding: base64",
        f'Content-Disposition: attachment; filename="{ICS_FILENAME}"',
        "",
        _base64_block(calendar.encode("utf-8")),
        "",
        f"--{boundary}--",
    ]
    return "\r\n".join(lines).encode("ascii") + b"\r\n"


def _send_over_smtp(message: bytes, to_address: str) -> None:
    with smtplib.SMTP(CONFIG.smtp_host, CONFIG.smtp_port, timeout=10) as client:
        client.sendmail(STUDIO_ADDRESS, [to_address], message)


def _claim_and_send_one() -> str:
    """Send the oldest unsent outbox row. One of `empty`, `sent` or `failed`."""
    with DATABASE.connection() as conn:
        with conn.transaction():
            row = conn.execute(
                """
                SELECT o.id, o.to_address, o.subject, o.body, o.calendar, o.inquiry_id,
                       i.reference,
                       (SELECT count(*) FROM outbox e
                         WHERE e.inquiry_id = o.inquiry_id AND e.id < o.id) AS earlier
                  FROM outbox o
                  JOIN inquiries i ON i.id = o.inquiry_id
                 WHERE o.sent_at IS NULL
                 ORDER BY o.id
                 FOR UPDATE OF o SKIP LOCKED
                 LIMIT 1
                """
            ).fetchone()
            if row is None:
                return "empty"
            conn.execute(
                "UPDATE outbox SET attempts = attempts + 1 WHERE id = %s", (row["id"],)
            )
            message = _compose(row)
            try:
                _send_over_smtp(message, row["to_address"])
            except (OSError, smtplib.SMTPException):
                return "failed"
            conn.execute(
                "UPDATE outbox SET sent_at = %s WHERE id = %s", (now_utc(), row["id"])
            )
    return "sent"


def _sender_loop() -> None:
    while True:
        _wake.wait(timeout=5.0)
        _wake.clear()
        try:
            while _claim_and_send_one() == "sent":
                pass
        except DatabaseUnavailable:
            pass
        except Exception:  # noqa: BLE001 - the sender must never die
            log.exception("outbox send failed")
        time.sleep(0.2)


def start_sender() -> None:
    threading.Thread(target=_sender_loop, name="np-outbox", daemon=True).start()

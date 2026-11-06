"""Outbox sending over SMTP to Mailpit, with at-least-once delivery."""
from __future__ import annotations

import email.utils
import json
import logging
import smtplib
import threading
import time
import traceback
from email.message import EmailMessage

import psycopg

from .config import CONFIG
from .db import db_call, db_transaction, drop_conn, get_conn, is_unavailable, mark_available, mark_unavailable, put_conn

log = logging.getLogger("northpier.mailer")

CHECK_INTERVAL = 2.0
SEND_TIMEOUT = 4.0


def render_email(row: dict) -> tuple[EmailMessage, str]:
    """Build the MIME message for one outbox row; returns (message, message_id)."""
    reference = row["reference"]
    seq = row["sequence_number"]
    message_id = f"<{reference}.{seq}@northpier.studio>"
    msg = EmailMessage()
    msg["From"] = "Northpier Studio <hello@northpier.studio>"
    msg["To"] = row["to_address"]
    msg["Reply-To"] = "hello@northpier.studio"
    msg["Subject"] = row["subject"]
    msg["Message-ID"] = message_id
    msg["Date"] = email.utils.format_datetime(row["created_at"])
    msg.set_content(row["body"], charset="utf-8")
    if row["calendar"]:
        method = "CANCEL" if row["calendar_method"] == "CANCEL" else "REQUEST"
        msg.add_attachment(
            row["calendar"].encode("utf-8"),
            maintype="text",
            subtype="calendar",
            filename="intro-call.ics",
            params={"method": method, "charset": "UTF-8"},
        )
    return msg, message_id


def send_row(conn, row: dict) -> str:
    """Send one row; returns 'ok', 'refused' or 'uncertain'."""
    try:
        msg, message_id = render_email(row)
        with smtplib.SMTP(
            host=CONFIG.smtp_host, port=CONFIG.smtp_port, timeout=SEND_TIMEOUT
        ) as smtp:
            smtp.send_message(msg)
        return "ok"
    except (smtplib.SMTPResponseException, smtplib.SMTPRecipientsRefused) as exc:
        log.warning("smtp refused: %s", exc)
        return "refused"
    except smtplib.SMTPConnectError as exc:
        log.warning("smtp connect refused: %s", exc)
        return "refused"
    except Exception as exc:  # timeout, reset, anything unknown
        log.warning("smtp uncertain: %s", exc)
        return "uncertain"


def process_one(conn) -> bool:
    """Claim, send and mark one pending row. Returns True when one was handled."""
    row = conn.execute(
        """
        WITH top AS (
            SELECT id FROM outbox
            WHERE sent_at IS NULL AND in_flight = FALSE
            ORDER BY id
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        SELECT o.id, o.inquiry_id, o.to_address, o.subject, o.body, o.calendar,
               COALESCE(o.calendar_method, '') AS calendar_method, o.created_at,
               i.reference,
               (SELECT COUNT(*) FROM outbox p WHERE p.inquiry_id = o.inquiry_id AND p.id < o.id)
                   AS sequence_number
        FROM outbox o
        JOIN inquiries i ON i.id = o.inquiry_id
        WHERE o.id IN (SELECT id FROM top)
        FOR UPDATE OF o
        """
    ).fetchone()
    if row is None:
        return False
    outcome = send_row(conn, row)
    if outcome == "refused":
        conn.execute(
            "UPDATE outbox SET attempts = attempts + 1, in_flight = FALSE WHERE id = %(id)s",
            {"id": row["id"]},
        )
    elif outcome == "uncertain":
        conn.execute(
            "UPDATE outbox SET attempts = attempts + 1, uncertain = TRUE, in_flight = FALSE WHERE id = %(id)s",
            {"id": row["id"]},
        )
    else:
        conn.execute(
            "UPDATE outbox SET sent_at = now(), in_flight = FALSE WHERE id = %(id)s",
            {"id": row["id"]},
        )
    return True


def send_pending() -> bool:
    """Send every currently pending row, oldest first. Returns True when any was sent."""
    if is_unavailable():
        return False
    try:
        conn = get_conn()
    except psycopg.Error:
        mark_unavailable()
        return False
    sent_any = False
    try:
        while True:
            try:
                with conn.transaction():
                    handled = process_one(conn)
            except psycopg.Error:
                drop_conn(conn)
                mark_unavailable()
                return sent_any
            if not handled:
                break
            sent_any = True
        mark_available()
        return sent_any
    finally:
        if is_unavailable():
            drop_conn(conn)
        else:
            put_conn(conn)


def try_send_now() -> None:
    """Kick the sender from a request thread without blocking it long."""
    if is_unavailable():
        return
    thread = threading.Thread(target=send_pending, name="np-send-now", daemon=True)
    thread.start()
    thread.join(timeout=8.0)


_stop = threading.Event()


def _sender_loop() -> None:
    while not _stop.wait(CHECK_INTERVAL):
        try:
            send_pending()
        except Exception:
            traceback.print_exc()


def start_sender() -> None:
    thread = threading.Thread(target=_sender_loop, name="np-outbox-sender", daemon=True)
    thread.start()


def stop_sender() -> None:
    _stop.set()

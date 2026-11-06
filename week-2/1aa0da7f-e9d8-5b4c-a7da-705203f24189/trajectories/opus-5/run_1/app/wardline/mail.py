"""The mail outbox: notices are queued inside the caller's transaction and sent later."""

from __future__ import annotations

import re
import smtplib
import threading
from datetime import datetime, timezone
from email.message import EmailMessage
from typing import Any

from . import db
from .config import CONFIG

_status_lock = threading.Lock()
_mail_up = False

_NEWLINE_RUN = re.compile(r"[\n\u0085\u2028\u2029]+")


def _set_mail(value: bool) -> None:
    global _mail_up
    with _status_lock:
        _mail_up = value


def mail_up() -> bool:
    with _status_lock:
        return _mail_up


def notice_state() -> str:
    return "queued" if mail_up() else "held"


def check_mail() -> bool:
    try:
        with smtplib.SMTP(CONFIG.smtp_host, CONFIG.smtp_port, timeout=4) as smtp:
            smtp.noop()
        _set_mail(True)
        return True
    except (smtplib.SMTPException, OSError):
        _set_mail(False)
        return False


def queue(cur: Any, recipient: str, subject: str, body: str) -> str:
    mail_id = db.next_id(cur, "MAIL", width=6)
    cur.execute(
        """
        INSERT INTO mail_outbox (id, recipient, subject, body, status, created_at)
        VALUES (%s, %s, %s, %s, 'pending', %s)
        """,
        (mail_id, recipient, subject, body, datetime.now(timezone.utc)),
    )
    return mail_id


def flatten_reason(reason: str) -> str:
    return _NEWLINE_RUN.sub(" ", reason)


def break_glass_notice(
    cur: Any, recipient: str, actor_name: str, reason: str, compartment_id: str
) -> str:
    body = (
        "Break-glass access opened.\n"
        f"Actor: {actor_name}\n"
        f"Reason: {flatten_reason(reason)}\n"
        f"Compartment: {compartment_id}\n"
    )
    return queue(
        cur, recipient, f"Break-glass access opened on {compartment_id}", body
    )


def decision_notice(
    cur: Any, recipient: str, release_id: str, decision: str, reviewer_name: str
) -> str:
    body = (
        f"Release {release_id} was {decision} by {reviewer_name}.\n"
        "Open Wardline to read the decision.\n"
    )
    subject = f"Release {release_id} {decision}"
    return queue(cur, recipient, subject, body)


def _send(recipient: str, subject: str, body: str) -> None:
    message = EmailMessage()
    message["From"] = CONFIG.mail_from
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(body, charset="utf-8")
    with smtplib.SMTP(CONFIG.smtp_host, CONFIG.smtp_port, timeout=6) as smtp:
        smtp.send_message(message)


def deliver_pending() -> int:
    """Claims one pending row at a time so a row is sent once across copies."""
    sent = 0
    while True:
        with db.tx() as cur:
            cur.execute(
                """
                UPDATE mail_outbox SET claimed_at = now()
                WHERE id = (
                    SELECT id FROM mail_outbox
                    WHERE status = 'pending'
                      AND (claimed_at IS NULL OR claimed_at < now() - interval '60 seconds')
                    ORDER BY created_at
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                )
                RETURNING id, recipient, subject, body
                """
            )
            row = cur.fetchone()
        if row is None:
            return sent
        try:
            _send(row["recipient"], row["subject"], row["body"])
        except (smtplib.SMTPException, OSError):
            _set_mail(False)
            with db.tx() as cur:
                cur.execute(
                    "UPDATE mail_outbox SET claimed_at = NULL WHERE id = %s",
                    (row["id"],),
                )
            return sent
        with db.tx() as cur:
            cur.execute(
                "UPDATE mail_outbox SET status = 'sent', claimed_at = NULL WHERE id = %s",
                (row["id"],),
            )
        sent += 1

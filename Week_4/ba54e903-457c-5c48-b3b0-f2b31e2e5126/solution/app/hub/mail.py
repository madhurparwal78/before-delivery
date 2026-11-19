"""Email: rows go into the ``outbox`` table with the change that triggers them; a delivery thread sends them.

Headers are built with the standard library's address and header encoding. A row is claimed with
``FOR UPDATE SKIP LOCKED`` and marked sent in the same transaction as the SMTP hand-off, so several
instances deliver each email once.
"""

from __future__ import annotations

import logging
import smtplib
import threading
import time
from email.headerregistry import Address
from email.message import EmailMessage
from email.policy import SMTP


from . import config, db

log = logging.getLogger("hub.mail")
_started = threading.Event()


def enqueue(cur: db.Cursor, *, to: str, name: str | None, subject: str, body: str) -> None:
    cur.execute("INSERT INTO outbox (recipient, recipient_name, subject, body) VALUES (%s, %s, %s, %s)",
                (to, name, subject, body))


def _compose(row: dict) -> EmailMessage:
    message = EmailMessage(policy=SMTP)
    message["From"] = config.MAIL_FROM
    local, _, domain = row["recipient"].rpartition("@")
    message["To"] = Address(display_name=row["recipient_name"] or "", username=local, domain=domain)
    message["Subject"] = row["subject"]
    message.set_content(row["body"])
    return message


def _deliver_batch() -> bool:
    """Send pending rows in id order; stop at the first failure. Returns True when every claimed row was sent."""
    with db.tx() as cur:
        cur.execute("SELECT * FROM outbox WHERE sent_at IS NULL ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED")
        rows = cur.fetchall()
        if not rows:
            return True
        try:
            with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=5) as smtp:
                for row in rows:
                    smtp.send_message(_compose(row))
                    cur.execute("UPDATE outbox SET sent_at = now() WHERE id = %s", (row["id"],))
        except (OSError, smtplib.SMTPException):
            return False
    return True


def _loop() -> None:
    while True:
        try:
            healthy = _deliver_batch()
        except Exception:  # noqa: BLE001 - the delivery thread must outlive any single failure
            log.exception("mail delivery failed")
            healthy = False
        time.sleep(1.0 if healthy else 2.0)


def start() -> None:
    if not _started.is_set():
        _started.set()
        threading.Thread(target=_loop, name="mail-delivery", daemon=True).start()

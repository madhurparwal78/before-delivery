"""Outbound email: recording with its cause, wording, the recipient display name, and delivery."""

from __future__ import annotations

import base64
import logging
import re
import smtplib
import threading
from email.utils import formatdate, parseaddr
from typing import Any

from pg8000.exceptions import DatabaseError

from . import db
from .config import settings

log = logging.getLogger("relayo.outbound")

SUBJECTS = {
    "receipt": "We received your Relayo partner application",
    "approved": "Your Relayo partner application: Approved",
    "rejected": "Your Relayo partner application: Not approved",
}
CLOSING_SENTENCES = {
    "receipt": "Our partner team reviews every application and replies by email.",
    "approved": "Your application has been approved, and a partner manager will contact you at this address.",
    "rejected": "After review, we are not able to offer a partnership at this time.",
}
BACKOFF_CAP_SECONDS = 30
POLL_SECONDS = 1.0

_LINE_BREAKS = re.compile("[\r\n\t\u0085  ]+")
_DOT_ATOM = re.compile(r"[A-Za-z0-9!#$%&'*+/=?^_`{|}~\u0080-\U0010ffff-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~\u0080-\U0010ffff-]+)*")


def body_for(kind: str, first_name: str, company_name: str) -> str:
    return (f"Hello {first_name},\n\nThank you for applying to the Relayo partner program on behalf of "
            f"{company_name}. {CLOSING_SENTENCES[kind]}\n\nThe Relayo partner team")


def record(conn: db.Connection, application: dict[str, Any], kind: str) -> None:
    """Record one email of this kind for the application, inside the caller's transaction."""
    conn.run(
        "INSERT INTO outbound_emails (application_id, kind, recipient, subject, body, next_attempt_at, created_at) "
        "SELECT :application_id, :kind, :recipient, :subject, :body, t.now, t.now "
        "FROM (SELECT clock_timestamp() AS now) t ON CONFLICT (application_id, kind) DO NOTHING",
        application_id=application["id"], kind=kind, recipient=application["work_email"],
        subject=SUBJECTS[kind], body=body_for(kind, application["first_name"], application["company_name"]),
    )


def display_name(first_name: str, last_name: str) -> str:
    return _LINE_BREAKS.sub(" ", f"{first_name} {last_name}")


def encoded_words(text: str, fold: str = "\r\n ") -> str:
    """RFC 2047 base64 encoded words of at most 75 characters, joined by `fold`.

    Encoding the whole display name keeps any applicant text (quotes, commas, angle brackets) inert.
    """
    chunks: list[bytes] = []
    current = b""
    for char in text:
        encoded = char.encode("utf-8")
        if len(current) + len(encoded) > 45:
            chunks.append(current)
            current = b""
        current += encoded
    chunks.append(current)
    return fold.join(f"=?utf-8?b?{base64.b64encode(chunk).decode('ascii')}?=" for chunk in chunks if chunk)


def display_phrase(name: str) -> str:
    """The display name as encoded words inside one quoted string, so the decoded name is a single
    quoted phrase: text in it that looks like an encoded word comes back literally, never decoded again."""
    return f'"{encoded_words(name)}"'


def addr_spec(address: str) -> str:
    local, _, domain = address.rpartition("@")
    if not _DOT_ATOM.fullmatch(local):
        local = '"' + local.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return f"{local}@{domain}"


def _mailbox(name: str, address: str) -> str:
    return f"{display_phrase(name)} <{addr_spec(address)}>" if name else f"<{addr_spec(address)}>"


def message_bytes(row: dict[str, Any]) -> bytes:
    sender_name, sender_address = parseaddr(settings.mail_from)
    body = base64.encodebytes(row["body"].replace("\n", "\r\n").encode("utf-8")).decode("ascii")
    headers = [
        f"From: {_mailbox(sender_name, sender_address)}",
        f"To: {_mailbox(display_name(row['first_name'], row['last_name']), row['recipient'])}",
        f"Subject: {row['subject']}",
        f"Date: {formatdate(usegmt=True)}",
        f"Message-ID: <outbound-email-{row['id']}@relayo.example>",
        "MIME-Version: 1.0",
        'Content-Type: text/plain; charset="utf-8"',
        "Content-Transfer-Encoding: base64",
    ]
    return ("\r\n".join(headers) + "\r\n\r\n" + body.replace("\n", "\r\n")).encode("utf-8")


def _send(row: dict[str, Any]) -> None:
    sender = parseaddr(settings.mail_from)[1]
    message = message_bytes(row)
    options = [] if message.isascii() else ["SMTPUTF8"]
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, local_hostname="relayo.example", timeout=10) as smtp:
        smtp.sendmail(sender, [row["recipient"]], message, mail_options=options)


DUE_ROW = """
SELECT e.id, e.recipient, e.subject, e.body, a.first_name, a.last_name
FROM outbound_emails e JOIN partner_applications a ON a.id = e.application_id
WHERE e.status = 'queued' AND e.next_attempt_at <= clock_timestamp()
ORDER BY e.next_attempt_at, e.id
LIMIT 1
FOR UPDATE OF e SKIP LOCKED
"""
MARK_SENT = """
UPDATE outbound_emails SET status = 'sent', attempts = attempts + 1, last_attempt_at = t.now, sent_at = t.now
FROM (SELECT clock_timestamp() AS now) t WHERE id = :id
"""
MARK_FAILED = """
UPDATE outbound_emails SET attempts = attempts + 1, last_attempt_at = t.now,
    next_attempt_at = t.now + make_interval(secs => least(power(2, attempts + 1), :cap))
FROM (SELECT clock_timestamp() AS now) t WHERE id = :id
"""


class Deliverer:
    """Delivers recorded emails from PostgreSQL; each row is claimed under a row lock."""

    def __init__(self) -> None:
        self._wake = threading.Event()

    def wake(self) -> None:
        self._wake.set()

    def deliver_due(self) -> bool:
        with db.transaction() as conn:
            row = db.one(conn, DUE_ROW)
            if row is None:
                return False
            try:
                _send(row)
            except (smtplib.SMTPException, OSError) as error:
                log.warning("outbound email %s not accepted: %s", row["id"], error)
                conn.run(MARK_FAILED, id=row["id"], cap=float(BACKOFF_CAP_SECONDS))
            else:
                conn.run(MARK_SENT, id=row["id"])
        return True

    def run_forever(self) -> None:
        while True:
            try:
                while self.deliver_due():
                    pass
            except (db.DatabaseUnavailable, DatabaseError) as error:
                log.warning("outbound delivery paused: %s", error)
            except Exception:
                log.exception("outbound delivery failed; retrying on the next poll")
            self._wake.wait(POLL_SECONDS)
            self._wake.clear()


deliverer = Deliverer()

"""Outbound email: recording, wording, the recipient display name and delivery."""

from __future__ import annotations

import asyncio
import base64
import logging
import re
import smtplib
from dataclasses import dataclass
from email.utils import formatdate, parseaddr
from typing import Any

import asyncpg

from .config import CONFIG
from .db import DATABASE, DatabaseUnavailable
from .state import READINESS

LOGGER = logging.getLogger("relayo.emails")

RECEIPT = "receipt"
APPROVED = "approved"
REJECTED = "rejected"

SUBJECTS = {
    RECEIPT: "We received your Relayo partner application",
    APPROVED: "Your Relayo partner application: Approved",
    REJECTED: "Your Relayo partner application: Not approved",
}

_MIDDLE_SENTENCES = {
    RECEIPT: (
        "Thank you for applying to the Relayo partner program on behalf of "
        "{company_name}. Our partner team reviews every application and replies by email."
    ),
    APPROVED: (
        "Thank you for applying to the Relayo partner program on behalf of "
        "{company_name}. Your application has been approved, and a partner manager "
        "will contact you at this address."
    ),
    REJECTED: (
        "Thank you for applying to the Relayo partner program on behalf of "
        "{company_name}. After review, we are not able to offer a partnership at this time."
    ),
}

_HEADER_BREAK_RUN = re.compile("[\r\n\t\u0085\u2028\u2029]+")
_ENCODED_WORD_PAYLOAD_BYTES = 45
_MAX_BACKOFF_SECONDS = 30
_POLL_SECONDS = 1.0


def display_name(first_name: str, last_name: str) -> str:
    """The recipient display name shared by all three email kinds."""
    return _HEADER_BREAK_RUN.sub(" ", f"{first_name} {last_name}")


def _encoded_words(text: str) -> list[str]:
    chunks: list[bytes] = []
    current = bytearray()
    for char in text:
        encoded = char.encode("utf-8", "surrogatepass")
        if len(current) + len(encoded) > _ENCODED_WORD_PAYLOAD_BYTES and current:
            chunks.append(bytes(current))
            current = bytearray()
        current.extend(encoded)
    if current or not chunks:
        chunks.append(bytes(current))
    return [f"=?utf-8?b?{base64.b64encode(chunk).decode('ascii')}?=" for chunk in chunks]


def to_header_value(name: str, address: str) -> str:
    """A To value a standard parser reads back as exactly this name and address.

    The display name travels as RFC 2047 encoded words inside a quoted string, so
    applicant text never ends a phrase, adds an address or folds into a long line.
    """
    quoted = '"' + "\r\n ".join(_encoded_words(name)) + '"'
    return f"{quoted}\r\n <{address}>"


def email_body(kind: str, first_name: str, company_name: str) -> str:
    middle = _MIDDLE_SENTENCES[kind].format(company_name=company_name)
    return f"Hello {first_name},\n\n{middle}\n\nThe Relayo partner team\n"


async def record_email(
    connection: asyncpg.Connection,
    *,
    application_id: int,
    kind: str,
    recipient: str,
    first_name: str,
    company_name: str,
) -> None:
    """Record one email, in the same transaction as the row that causes it."""
    await connection.execute(
        """
        INSERT INTO outbound_emails
            (application_id, kind, recipient, subject, body, status, attempts, next_attempt_at, created_at)
        VALUES ($1, $2, $3, $4, $5, 'queued', 0, now(), now())
        """,
        application_id,
        kind,
        recipient,
        SUBJECTS[kind],
        email_body(kind, first_name, company_name),
    )


async def outcome_email_status(connection: asyncpg.Connection, application_id: int) -> str | None:
    return await connection.fetchval(
        """
        SELECT status FROM outbound_emails
        WHERE application_id = $1 AND kind IN ('approved', 'rejected')
        """,
        application_id,
    )


@dataclass(frozen=True)
class _DueEmail:
    id: int
    recipient: str
    subject: str
    body: str
    attempts: int
    first_name: str
    last_name: str


def _message_bytes(email: _DueEmail) -> bytes:
    name = display_name(email.first_name, email.last_name)
    headers = [
        f"From: {CONFIG.mail_from}",
        f"To: {to_header_value(name, email.recipient)}",
        f"Subject: {email.subject}",
        f"Message-ID: <outbound-email-{email.id}@relayo.example>",
        f"Date: {formatdate(localtime=False)}",
        "MIME-Version: 1.0",
        'Content-Type: text/plain; charset="utf-8"',
        "Content-Transfer-Encoding: base64",
    ]
    encoded_body = base64.b64encode(email.body.encode("utf-8")).decode("ascii")
    body_lines = [encoded_body[index : index + 76] for index in range(0, len(encoded_body), 76)]
    return ("\r\n".join(headers) + "\r\n\r\n" + "\r\n".join(body_lines) + "\r\n").encode("ascii")


def _send_over_smtp(message: bytes, recipient: str) -> None:
    sender = parseaddr(CONFIG.mail_from)[1]
    with smtplib.SMTP(CONFIG.smtp_host, CONFIG.smtp_port, timeout=10) as smtp:
        smtp.sendmail(sender, [recipient], message)


async def deliver_due_emails() -> None:
    """Deliver every due email once; several deliverers never take the same row."""
    async with DATABASE.acquire() as connection:
        async with connection.transaction():
            rows = await connection.fetch(
                """
                SELECT e.id, e.recipient, e.subject, e.body, e.attempts,
                       a.first_name, a.last_name
                FROM outbound_emails e
                JOIN partner_applications a ON a.id = e.application_id
                WHERE e.status = 'queued' AND e.next_attempt_at <= now()
                ORDER BY e.id
                FOR UPDATE OF e SKIP LOCKED
                LIMIT 10
                """
            )
            for row in rows:
                await _deliver_one(connection, _DueEmail(**dict(row)))


async def _deliver_one(connection: asyncpg.Connection, email: _DueEmail) -> None:
    message = _message_bytes(email)
    loop = asyncio.get_running_loop()
    try:
        await loop.run_in_executor(None, _send_over_smtp, message, email.recipient)
    except (smtplib.SMTPException, OSError) as exc:
        LOGGER.warning("outbound email %s could not be delivered: %s", email.id, exc)
        wait = min(2 ** (email.attempts + 1), _MAX_BACKOFF_SECONDS)
        await connection.execute(
            """
            UPDATE outbound_emails
            SET attempts = attempts + 1,
                last_attempt_at = now(),
                next_attempt_at = now() + make_interval(secs => $2)
            WHERE id = $1
            """,
            email.id,
            float(wait),
        )
        return
    await connection.execute(
        """
        UPDATE outbound_emails
        SET status = 'sent', sent_at = now(), attempts = attempts + 1, last_attempt_at = now()
        WHERE id = $1
        """,
        email.id,
    )


async def run_delivery_loop(stopping: asyncio.Event) -> None:
    """The background deliverer that reads the table on a published schedule."""
    while not stopping.is_set():
        try:
            if READINESS.ready:
                await deliver_due_emails()
        except DatabaseUnavailable:
            LOGGER.warning("outbound email delivery skipped: database unavailable")
        except asyncpg.PostgresError:
            LOGGER.exception("outbound email delivery failed")
        try:
            await asyncio.wait_for(stopping.wait(), timeout=_POLL_SECONDS)
        except asyncio.TimeoutError:
            continue

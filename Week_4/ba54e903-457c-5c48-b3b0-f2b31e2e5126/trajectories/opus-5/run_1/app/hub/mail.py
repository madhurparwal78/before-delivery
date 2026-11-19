"""The outbox: every email is queued with its change and delivered exactly once."""

from __future__ import annotations

import asyncio
import smtplib
from email.headerregistry import Address
from email.message import EmailMessage

import asyncpg

from .config import CONFIG
from .db import DB

POLL_SECONDS = 2.0
BATCH = 10
SMTP_TIMEOUT = 5.0


async def queue_email(
    conn: asyncpg.Connection,
    *,
    recipient: str,
    subject: str,
    body: str,
    recipient_name: str = "",
) -> None:
    """Write the email in the same transaction as the change that triggered it."""
    await conn.execute(
        """
        INSERT INTO outbox (recipient, recipient_name, subject, body)
        VALUES ($1, $2, $3, $4)
        """,
        recipient,
        recipient_name,
        subject,
        body,
    )


def _build(recipient: str, recipient_name: str, subject: str, body: str) -> EmailMessage:
    message = EmailMessage()
    message["From"] = CONFIG.mail_from
    if recipient_name:
        local, _, domain = recipient.partition("@")
        message["To"] = Address(display_name=recipient_name, username=local, domain=domain)
    else:
        message["To"] = recipient
    message["Subject"] = subject
    message.set_content(body)
    return message


def _deliver(messages: list[EmailMessage]) -> None:
    with smtplib.SMTP(CONFIG.smtp_host, CONFIG.smtp_port, timeout=SMTP_TIMEOUT) as client:
        for message in messages:
            client.send_message(message)


class Mailer:
    """Delivers pending outbox rows, from whichever instance gets to them first."""

    async def run(self) -> None:
        while True:
            await asyncio.sleep(POLL_SECONDS)
            try:
                await self.deliver_pending()
            except (asyncpg.PostgresError, OSError, ConnectionError, smtplib.SMTPException):
                continue

    async def deliver_pending(self) -> None:
        if not DB.ready:
            return
        async with DB.transaction() as conn:
            rows = await conn.fetch(
                """
                SELECT id, recipient, recipient_name, subject, body
                FROM outbox WHERE sent_at IS NULL
                ORDER BY id LIMIT $1
                FOR UPDATE SKIP LOCKED
                """,
                BATCH,
            )
            if not rows:
                return
            messages = [
                _build(row["recipient"], row["recipient_name"], row["subject"], row["body"])
                for row in rows
            ]
            await asyncio.to_thread(_deliver, messages)
            await conn.execute(
                """
                UPDATE outbox SET sent_at = date_trunc('second', now())
                WHERE id = ANY($1::int[])
                """,
                [row["id"] for row in rows],
            )


MAILER = Mailer()

"""Each running copy's background work: status checks, mail, sweeps."""

from __future__ import annotations

import asyncio
import logging
import smtplib
from email.message import EmailMessage
from email.utils import formataddr, parseaddr

import asyncpg

from wardline.access import GRANT_PAST_TIME, end_past_grant
from wardline.auth import close_session, session_ending
from wardline.config import CONFIG
from wardline.db import DB
from wardline.s3 import STORAGE

log = logging.getLogger("wardline")

CHECK_SECONDS = 3
MAIL_SECONDS = 2
SWEEP_SECONDS = 2
SMTP_TIMEOUT = 3


class Status:
    storage_up = False
    mail_up = False


STATUS = Status()


def _probe_relay() -> bool:
    try:
        with smtplib.SMTP(CONFIG.smtp_host, CONFIG.smtp_port, timeout=SMTP_TIMEOUT) as relay:
            relay.noop()
        return True
    except (OSError, smtplib.SMTPException):
        return False


async def check_services_once() -> None:
    STATUS.storage_up, STATUS.mail_up = await asyncio.gather(STORAGE.check_bucket(), asyncio.to_thread(_probe_relay))


async def status_loop() -> None:
    while True:
        await check_services_once()
        await asyncio.sleep(CHECK_SECONDS)


def _send_one(recipient: str, subject: str, body: str) -> None:
    message = EmailMessage()
    name, address = parseaddr(CONFIG.mail_from)
    message["From"] = formataddr((name, address))
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(body, charset="utf-8")
    with smtplib.SMTP(CONFIG.smtp_host, CONFIG.smtp_port, timeout=SMTP_TIMEOUT) as relay:
        relay.send_message(message)


async def send_pending() -> None:
    """Claim one row at a time, across copies, outside any open transaction while mail moves."""
    while True:
        async with DB.connection() as conn:
            row = await conn.fetchrow(
                """UPDATE mail_outbox SET claimed_until = now() + interval '30 seconds'
                   WHERE id = (SELECT id FROM mail_outbox
                               WHERE status = 'pending' AND (claimed_until IS NULL OR claimed_until < now())
                               ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
                   RETURNING id, recipient, subject, body"""
            )
        if row is None:
            return
        try:
            await asyncio.to_thread(_send_one, row["recipient"], row["subject"], row["body"])
        except (OSError, smtplib.SMTPException) as error:
            log.warning("mail not sent: %s", error)
            async with DB.connection() as conn:
                await conn.execute("UPDATE mail_outbox SET claimed_until = NULL WHERE id = $1", row["id"])
            return
        async with DB.connection() as conn:
            await conn.execute("UPDATE mail_outbox SET status = 'sent', claimed_until = NULL WHERE id = $1", row["id"])


async def mail_loop() -> None:
    while True:
        try:
            await send_pending()
        except (asyncpg.PostgresError, asyncpg.InterfaceError, OSError, TimeoutError) as error:
            log.warning("mail worker: %s", error)
        await asyncio.sleep(MAIL_SECONDS)


async def _sweep_sessions(conn: asyncpg.Connection) -> None:
    rows = await conn.fetch(
        f"""SELECT id, {session_ending()} AS reason FROM sessions
            WHERE closed_at IS NULL AND {session_ending()} IS NOT NULL
            FOR UPDATE SKIP LOCKED"""
    )
    for row in rows:
        await close_session(conn, row["id"], row["reason"], "system", None)


async def _sweep_grants(conn: asyncpg.Connection) -> None:
    rows = await conn.fetch(
        f"""SELECT id, compartment_id, user_id, kind FROM grants
            WHERE {GRANT_PAST_TIME} FOR UPDATE SKIP LOCKED"""
    )
    for row in rows:
        await end_past_grant(conn, row)


async def sweep_loop() -> None:
    while True:
        try:
            async with DB.tx() as conn:
                await _sweep_sessions(conn)
            async with DB.tx() as conn:
                await _sweep_grants(conn)
        except (asyncpg.PostgresError, asyncpg.InterfaceError, OSError, TimeoutError) as error:
            log.warning("sweep: %s", error)
        await asyncio.sleep(SWEEP_SECONDS)

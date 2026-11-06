"""Every email: written to the outbox inside the change's transaction, delivered by `workers.py` after commit."""

import asyncio
import re
import smtplib
import socket
from email.header import Header
from email.mime.text import MIMEText
from email.policy import compat32
from email.utils import parseaddr

import asyncpg

from . import shifts
from .config import settings

TYPE_LABELS = {"annual": "Annual leave", "unpaid": "Unpaid leave", "compassionate": "Compassionate leave"}
SKILL_LABELS = {"senior": "Senior", "carer": "Carer"}
UNFOLDED = compat32.clone(max_line_length=None)  # folding would collapse runs of spaces in stored text
CONTROL_RUN = re.compile(r"[\x00-\x1f\x7f-\x9f\u2028\u2029]+")


def header_text(text: str) -> str:
    """Stored text bound for a header: each run of line breaks or other control characters becomes one space."""
    return CONTROL_RUN.sub(" ", text)


async def enqueue(conn: asyncpg.Connection, to_address: str, subject: str, lines: list[str]) -> None:
    """Compose the email now, with names as they are, so later renames never change it."""
    await conn.execute("INSERT INTO outbox (to_address, subject, body) VALUES ($1, $2, $3)",
                       to_address, header_text(subject), "\n".join(lines) + "\n")


def _span(request: asyncpg.Record) -> str:
    return f"{shifts.fmt_date(request['start_date'])} to {shifts.fmt_date(request['end_date'])}"


async def _requester_email(conn: asyncpg.Connection, request: asyncpg.Record) -> str:
    return await conn.fetchval("SELECT email FROM people WHERE id = $1", request["requester_id"])


async def leave_approved(conn: asyncpg.Connection, request: asyncpg.Record, approver_name: str) -> None:
    await enqueue(conn, await _requester_email(conn, request), f"Leave approved: {_span(request)}", [
        f"Your {TYPE_LABELS[request['type']]} request has been approved.", "",
        f"Dates: {_span(request)}", f"Hours: {shifts.hours(request['hours_seconds'])}",
        f"Approved by: {approver_name}"])


async def leave_declined(conn: asyncpg.Connection, request: asyncpg.Record, reason: str) -> None:
    await enqueue(conn, await _requester_email(conn, request), f"Leave declined: {_span(request)}", [
        f"Your {TYPE_LABELS[request['type']]} request has been declined.", "",
        f"Dates: {_span(request)}", f"Reason: {reason}"])


async def leave_cancelled(conn: asyncpg.Connection, request: asyncpg.Record, reason: str) -> None:
    await enqueue(conn, await _requester_email(conn, request), f"Approved leave cancelled: {_span(request)}", [
        f"Your approved {TYPE_LABELS[request['type']]} has been cancelled by Group HR.", "",
        f"Dates: {_span(request)}", f"Reason: {reason}"])


async def cover_open(conn: asyncpg.Connection, cover: asyncpg.Record) -> None:
    """One email to each bank carer eligible for the cover now; never who is absent or why."""
    home_name, unit_name = await conn.fetchrow(
        "SELECT h.name, u.name FROM units u JOIN homes h ON h.id = u.home_id WHERE u.id = $1", cover["unit_id"])
    starts, ends = shifts.window(cover["date"], cover["shift"])
    label = shifts.shift_label(cover["date"], cover["shift"])
    for row in await conn.fetch(
            "SELECT p.email FROM people p JOIN credentials c ON c.person_id = p.id"
            " WHERE c.home_id = $1 AND p.role = 'bank_carer' AND ($2 = 'carer' OR p.skill = 'senior') ORDER BY p.id",
            cover["home_id"], cover["skill"]):
        await enqueue(conn, row["email"], f"Cover shift at {home_name}: {label}", [
            "A cover shift is open and you can claim it.", "",
            f"Home: {home_name}", f"Unit: {unit_name}", f"Date: {shifts.fmt_date(cover['date'])}",
            f"Shift: {shifts.SHIFT_NAMES[cover['shift']]}, {shifts.hm(starts)}–{shifts.hm(ends)}",
            f"Skill: {SKILL_LABELS[cover['skill']]}", "", "Claim it in Tallow Cover at /cover"])


async def escalation(conn: asyncpg.Connection, request: asyncpg.Record) -> None:
    manager_email, unit_name = await conn.fetchrow(
        "SELECT m.email, u.name FROM homes h JOIN people m ON m.id = h.manager_id"
        " LEFT JOIN units u ON u.id = $2 WHERE h.id = $1", request["home_id"], request["unit_id"])
    await enqueue(conn, manager_email,
                  f"Leave request awaiting decision: {request['requester_name']}, {_span(request)}", [
                      "This leave request has waited for a decision past the escalation time.", "",
                      f"Requester: {request['requester_name']}", f"Unit: {unit_name or 'No unit'}",
                      f"Type: {TYPE_LABELS[request['type']]}", f"Dates: {_span(request)}",
                      (f"Submitted: {shifts.fmt_date(request['submitted_at'].astimezone(shifts.LONDON).date())}"
                       f" at {shifts.hm(request['submitted_at'])}")])


def _deliver(row: asyncpg.Record) -> None:
    """To is the stored address alone; a Subject that is not plain ASCII is RFC 2047 encoded."""
    subject = row["subject"]
    message = MIMEText(row["body"], "plain", "utf-8")
    message["From"] = settings.mail_from
    message["To"] = row["to_address"]
    message["Subject"] = subject if subject.isascii() else Header(subject, "utf-8")
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
        smtp.sendmail(parseaddr(settings.mail_from)[1], [row["to_address"]], message.as_bytes(policy=UNFOLDED))


async def deliver(row: asyncpg.Record) -> bool:
    try:
        await asyncio.to_thread(_deliver, row)
    except (OSError, smtplib.SMTPException):
        return False
    return True


def _probe() -> None:
    socket.create_connection((settings.smtp_host, settings.smtp_port), timeout=3).close()


async def reachable() -> bool:
    try:
        await asyncio.to_thread(_probe)
    except OSError:
        return False
    return True

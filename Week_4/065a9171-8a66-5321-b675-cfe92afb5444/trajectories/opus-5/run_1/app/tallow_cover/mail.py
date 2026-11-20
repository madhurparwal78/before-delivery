"""The email outbox: composed in the change's transaction, delivered once."""

from __future__ import annotations

import re
import smtplib
import uuid
from email.message import EmailMessage
from email.policy import SMTP

from .config import CONFIG
from .db import execute

_CONTROL_RUN = re.compile(r"[\x00-\x1f\x7f]+")
#: The SMTP line limit, so a Subject built from stored text stays one line.
_POLICY = SMTP.clone(max_line_length=998)


def safe_header(text: str) -> str:
    """Every run of control characters in stored header text becomes one space."""
    return _CONTROL_RUN.sub(" ", text)


def queue(conn, to_email: str, subject: str, body: str) -> None:
    execute(
        conn,
        "INSERT INTO outbox (id, to_email, subject, body) VALUES (%s, %s, %s, %s)",
        (f"out-{uuid.uuid4().hex}", to_email, safe_header(subject), body),
    )


def compose(to_email: str, subject: str, body: str) -> EmailMessage:
    message = EmailMessage(policy=_POLICY)
    message["From"] = CONFIG.mail_from
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(body)
    return message


def open_transport() -> smtplib.SMTP:
    return smtplib.SMTP(CONFIG.smtp_host, CONFIG.smtp_port, timeout=10)


def reachable() -> bool:
    try:
        with open_transport() as transport:
            transport.noop()
        return True
    except (OSError, smtplib.SMTPException):
        return False

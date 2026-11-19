"""Outgoing mail to Mailpit over SMTP."""

import asyncio
import smtplib
from email.headerregistry import Address
from email.message import EmailMessage

from .config import settings


class MailUnavailable(Exception):
    """The SMTP server could not be reached or refused the message."""


def _header_safe(value: str) -> str:
    if any(c in value for c in "\r\n\0\u0085  "):
        raise ValueError("header value contains a line break")
    return value


def _address(raw: str) -> Address:
    user, _, domain = raw.partition("@")
    return Address(username=user, domain=domain)


def _send(message: EmailMessage) -> None:
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, local_hostname="tailboard", timeout=5) as smtp:
            smtp.send_message(message)
    except (OSError, smtplib.SMTPException) as error:
        raise MailUnavailable(str(error)) from error


async def send(to: str, subject: str, body: str, attachment: tuple[str, bytes] | None = None) -> None:
    message = EmailMessage()
    message["From"] = settings.mail_from
    message["To"] = _address(to)
    message["Subject"] = _header_safe(subject)
    message.set_content(body)
    if attachment:
        name, data = attachment
        message.add_attachment(data, maintype="text", subtype="csv", filename=_header_safe(name))
    await asyncio.to_thread(_send, message)

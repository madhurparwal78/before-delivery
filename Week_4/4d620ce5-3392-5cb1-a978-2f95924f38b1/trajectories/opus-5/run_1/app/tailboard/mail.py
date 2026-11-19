"""Outgoing mail. Every message leaves from MAIL_FROM through the mail sink."""

import smtplib
from email.message import EmailMessage

from .config import config


class MailUnavailable(Exception):
    pass


def send(to_address, subject, body, attachment=None):
    """Send one message. `attachment` is (filename, bytes) for the pack manifest."""
    message = EmailMessage()
    message["From"] = config.mail_from
    message["To"] = to_address
    message["Subject"] = subject
    message.set_content(body)
    if attachment is not None:
        filename, data = attachment
        message.add_attachment(
            data, maintype="text", subtype="csv", filename=filename
        )
    try:
        with smtplib.SMTP(config.smtp_host, config.smtp_port, timeout=8) as client:
            client.send_message(message)
    except (OSError, smtplib.SMTPException) as error:
        raise MailUnavailable(str(error)) from error

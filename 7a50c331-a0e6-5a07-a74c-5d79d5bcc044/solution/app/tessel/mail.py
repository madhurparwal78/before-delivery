"""Email notices over SMTP to Mailpit: one message per recipient, no cc, no bcc, sent after the change commits."""
import logging
import smtplib
import threading
from email.message import EmailMessage

from . import config

log = logging.getLogger("tessel.mail")


def _deliver(recipients: list[str], subject: str, body: str) -> None:
    for to in recipients:
        msg = EmailMessage()
        msg["From"] = config.MAIL_FROM
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(body)
        try:
            with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=10) as smtp:
                smtp.send_message(msg)
        except (OSError, smtplib.SMTPException) as exc:
            log.error("mail to %s failed: %s", to, type(exc).__name__)


def send(recipients: list[str], subject: str, body: str) -> None:
    """Deliver in the background so the answer never waits on SMTP."""
    threading.Thread(target=_deliver, args=(list(recipients), subject, body), daemon=True).start()

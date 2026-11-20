"""Email composition and the outbox drain.

Every email is composed into the outbox inside the change's transaction and
delivered exactly once after it commits. Headers built from stored text are
neutralised: control characters collapse to one space and non-ASCII is encoded
per RFC 2047, so no stored text can add a header or a recipient.
"""
import re
import smtplib
import threading
import time
from email.message import EmailMessage

from . import domain
from .store import new_id

CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]+")


def clean_header_text(text):
    """Each run of control characters becomes one space."""
    return CONTROL_RE.sub(" ", text or "")


def encode_header(text):
    """One clean Subject fragment: RFC 2047 encoded when not plain ASCII."""
    text = clean_header_text(text)
    try:
        text.encode("ascii")
        return text
    except UnicodeEncodeError:
        return f"=?utf-8?B?{_b_encode(text)}?="


def _b_encode(text):
    import base64
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def build_subject(text):
    """One clean Subject line that decodes back exactly, whatever the stored text."""
    return encode_header(text)


def queue_email(conn, to_email, subject, body):
    """Write one outbox entry inside the caller's transaction."""
    conn.execute(
        "insert into outbox (id, to_email, subject, body) values ($1,$2,$3,$4)",
        [new_id(), to_email, subject, body])


class Mailer:
    """Drains the outbox; an unreachable server holds every message until it returns."""

    def __init__(self, config):
        self.config = config
        self.ok = False
        self.checked_at = 0.0

    @property
    def up(self):
        return self.ok and time.time() - self.checked_at < 10

    def probe(self):
        """A cheap connection check; updates the health state."""
        try:
            with smtplib.SMTP(self.config.smtp_host, self.config.smtp_port, timeout=10) as smtp:
                smtp.ehlo()
            self.ok = True
        except (OSError, smtplib.SMTPException):
            self.ok = False
        self.checked_at = time.time()

    def drain(self, conn):
        rows = conn.execute(
            "select id, to_email, subject, body from outbox where sent_at is null"
            " order by created_at asc limit 50")
        from . import decode as dc
        entries = [(dc.s(r[0]), dc.s(r[1]), dc.s(r[2]), dc.s(r[3])) for r in rows]
        try:
            with smtplib.SMTP(self.config.smtp_host, self.config.smtp_port, timeout=10) as smtp:
                smtp.ehlo()
                try:
                    smtp.starttls()
                    smtp.ehlo()
                except smtplib.SMTPException:
                    pass
                for oid, to, subject, body in entries:
                    msg = EmailMessage()
                    msg["From"] = self.config.mail_from
                    msg["To"] = to
                    msg["Subject"] = subject
                    msg.set_content(body)
                    smtp.send_message(msg)
                    conn.execute("update outbox set sent_at = now() where id = $1", [oid])
                self.ok = True
        except (OSError, smtplib.SMTPException):
            self.ok = False
        self.checked_at = time.time()

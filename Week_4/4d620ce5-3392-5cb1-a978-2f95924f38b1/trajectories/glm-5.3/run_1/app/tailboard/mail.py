"""Outgoing mail to the Mailpit sink. Mail is never a precondition for any commit."""
import asyncio
import smtplib
from email.message import EmailMessage


class Mailer:
    def __init__(self, host: str, port: int, mail_from: str):
        self.host = host
        self.port = port
        self.mail_from = mail_from

    async def send(self, to: str, subject: str, body: str, attachments=()) -> bool:
        """Send one message. Returns False when mail is unreachable; the queue retries."""
        message = EmailMessage()
        message["From"] = self.mail_from
        message["To"] = to
        message["Subject"] = subject
        message.set_content(body)
        for filename, content_type, payload in attachments:
            main, sub = content_type.split("/", 1)
            message.add_attachment(payload, maintype=main, subtype=sub, filename=filename)
        try:
            return await asyncio.to_thread(self._send_sync, message)
        except Exception:
            return False

    def _send_sync(self, message: EmailMessage) -> bool:
        with smtplib.SMTP(self.host, self.port, timeout=5) as client:
            client.send_message(message)
        return True

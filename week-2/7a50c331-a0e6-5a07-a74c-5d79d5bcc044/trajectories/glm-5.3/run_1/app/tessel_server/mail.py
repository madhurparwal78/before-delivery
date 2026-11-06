"""Every notice travels over SMTP to Mailpit, one message per recipient."""
import asyncio
import smtplib
from email.message import EmailMessage

from .config import MAIL_FROM, SMTP_HOST, SMTP_PORT


async def send(app, to, subject, body):
    def deliver():
        msg = EmailMessage()
        msg["From"] = MAIL_FROM
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(body)
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as smtp:
            smtp.send_message(msg)
    loop = asyncio.get_running_loop()
    try:
        await loop.run_in_executor(None, deliver)
    except Exception:
        import traceback
        traceback.print_exc()


async def notify_owners(app, db, organization_id, subject, body_fn):
    owners = await db.fetch(
        "SELECT email FROM app.members WHERE organization_id = $1 AND role = 'owner'",
        organization_id)
    for o in owners:
        await send(app, o["email"], subject, body_fn(o["email"]))

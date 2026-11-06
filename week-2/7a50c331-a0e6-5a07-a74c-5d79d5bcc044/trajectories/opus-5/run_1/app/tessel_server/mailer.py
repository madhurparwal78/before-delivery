"""Every notice Tessel sends, over SMTP to Mailpit, one message per recipient."""
import smtplib
from email.message import EmailMessage

from . import config, pricing


def _send(recipient, subject, body):
    message = EmailMessage()
    message["From"] = config.MAIL_FROM
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(body)
    with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=10) as smtp:
        smtp.send_message(message)


def member_added(email, organization, role):
    _send(
        email,
        "You have been added to %s on Tessel" % organization,
        "You have been added to %s on Tessel with the role %s.\n"
        "Sign in at %s/login\n" % (organization, role, config.APP_PUBLIC_URL),
    )


def plan_changed(recipients, organization, plan):
    subject = "Plan changed to %s" % pricing.PLAN_LABEL[plan]
    body = (
        "The plan for %s is now %s.\n"
        "The monthly minimum is %s.\n"
        % (organization, pricing.PLAN_LABEL[plan], pricing.format_money(pricing.MINIMUM_CENTS[plan]))
    )
    for recipient in recipients:
        _send(recipient, subject, body)


def key_rotated(recipients, key_name):
    for recipient in recipients:
        _send(
            recipient,
            "API key rotated: %s" % key_name,
            "The API key %s was rotated. The previous secret no longer works.\n" % key_name,
        )


def key_revoked(recipients, key_name):
    for recipient in recipients:
        _send(
            recipient,
            "API key revoked: %s" % key_name,
            "The API key %s was revoked and no longer works.\n" % key_name,
        )


def export_ready(recipient, database, job_id):
    _send(
        recipient,
        "Export ready: %s" % database,
        "The export of %s is ready.\n"
        "Job id: %s\n"
        "Download path: /api/v2/jobs/%s/download\n" % (database, job_id, job_id),
    )


def password_reset_link(recipient, token):
    _send(
        recipient,
        "Reset your Tessel password",
        "%s/reset?token=%s\n\n"
        "This link works once. If you did not ask for it, ignore this message.\n"
        % (config.APP_PUBLIC_URL, token),
    )


def password_was_reset(recipient):
    _send(
        recipient,
        "Your Tessel password was reset",
        "Your Tessel password was reset and every session was signed out.\n",
    )

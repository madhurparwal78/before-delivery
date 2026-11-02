"""Background delivery of recorded emails from PostgreSQL to the mail
service, with the published backoff and one delivery claim per email.

A row is due when its status is queued and its next_attempt_at is at or
before the PostgreSQL clock's current time. The table is read at least
every two seconds, so a running instance also delivers rows that another
process recorded.
"""
from __future__ import annotations

import logging
import smtplib
import threading
import time

from . import config, db, outbound_email

log = logging.getLogger("relayo.delivery")

_SCAN_INTERVAL = 2.0
_BACKOFF_CAP = 30
_CLAIM_SQL = (
    "UPDATE outbound_emails SET attempts = attempts + 1,"
    " last_attempt_at = now(), next_attempt_at = now() +"
    " make_interval(secs => least(power(2, attempts + 1), %s))"
    " WHERE id = %s AND status = 'queued' AND next_attempt_at <= now()"
    " RETURNING id, kind, recipient, subject, body"
)


def _claim_due_rows() -> list[tuple]:
    """Claim due rows atomically; several deliverers never share one row."""
    with db.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM outbound_emails WHERE status = 'queued'"
                " AND next_attempt_at <= now() ORDER BY id LIMIT 20"
            )
            ids = [row[0] for row in cur.fetchall()]
            claimed = []
            for row_id in ids:
                cur.execute(_CLAIM_SQL, (_BACKOFF_CAP, row_id))
                row = cur.fetchone()
                if row is not None:
                    claimed.append(row)
            return claimed


def _mark_sent(row_id: int) -> None:
    with db.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE outbound_emails SET status = 'sent', sent_at = now()"
                " WHERE id = %s AND status = 'queued'", (row_id,)
            )


def _deliver(row: tuple) -> None:
    row_id, kind = row[0], row[1]
    with db.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT first_name, last_name, company_name, work_email"
                " FROM partner_applications WHERE id ="
                " (SELECT application_id FROM outbound_emails WHERE id = %s)",
                (row_id,),
            )
            applicant = cur.fetchone()
    if applicant is None:
        log.warning("outbound email %s has no application", row_id)
        _mark_sent(row_id)
        return
    first_name, last_name, company_name, work_email = applicant
    raw = outbound_email.build_raw(
        row_id, kind, work_email,
        outbound_email.display_name(first_name, last_name),
        first_name, company_name, config.MAIL_FROM,
    )
    try:
        with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=15) as (
            smtp
        ):
            smtp.sendmail(_from_address(), [work_email], raw)
        _mark_sent(row_id)
    except (smtplib.SMTPException, OSError):
        log.info("delivery attempt failed for outbound email %s", row_id)


def _cycle() -> None:
    for row in _claim_due_rows():
        _deliver(row)


def run_forever() -> None:
    while True:
        try:
            _cycle()
        except db.DatabaseUnavailable:
            log.info("database unreachable; delivery paused")
        except Exception:  # the loop never dies
            log.exception("delivery cycle failed")
        time.sleep(_SCAN_INTERVAL)


def start() -> None:
    thread = threading.Thread(
        target=run_forever, name="relayo-outbound-email", daemon=True
    )
    thread.start()


def _from_address() -> str:
    """The bare address inside MAIL_FROM, used as the SMTP sender."""
    raw = config.MAIL_FROM
    if "<" in raw and ">" in raw:
        return raw[raw.index("<") + 1:raw.rindex(">")]
    return raw.strip()

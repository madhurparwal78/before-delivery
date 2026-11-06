"""The background pass that emails each finished export exactly once."""
import datetime
import smtplib
import threading
import time

from pg8000.exceptions import DatabaseError, InterfaceError

from . import db, mailer, textutil
from .domain import exports

INTERVAL_SECONDS = 1.0


def _claim_finished():
    """Claim every export whose time has come, so one notice is sent."""
    boundary = textutil.now() - datetime.timedelta(seconds=exports.FINISHED_SECONDS)
    with db.tx() as cur:
        return cur.all(
            """
            UPDATE export_jobs SET email_sent_at = %s
             WHERE id IN (
                 SELECT id FROM export_jobs
                  WHERE email_sent_at IS NULL AND requested_at <= %s
                  FOR UPDATE SKIP LOCKED
             )
            RETURNING id, database_name, requested_by
            """,
            (textutil.now(), boundary),
        )


def _release(job_id):
    with db.tx() as cur:
        cur.execute(
            "UPDATE export_jobs SET email_sent_at = NULL WHERE id = %s", (job_id,)
        )


def _pass():
    for job in _claim_finished():
        try:
            mailer.export_ready(job["requested_by"], job["database_name"], job["id"])
        except (smtplib.SMTPException, OSError):
            _release(job["id"])


def _loop():
    while True:
        try:
            _pass()
        except (DatabaseError, InterfaceError, OSError):
            pass
        time.sleep(INTERVAL_SECONDS)


def start():
    threading.Thread(target=_loop, name="export-notices", daemon=True).start()

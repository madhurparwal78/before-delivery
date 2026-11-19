"""Background work: sending held notices, retrying queued packs and re-rendering
pack objects after an erasure. Its audit entries carry the system actor."""

import datetime
import sys
import threading
import traceback

from . import clock, mail, storage
from .db import transaction
from .domain import packs
from .errors import ApiError
from .seed import SYSTEM_ACTOR_ID

TICK_SECONDS = 5
RETRY_SECONDS = 10

_mail_retry_after = None


def _send_due_notices():
    """Notices wait for their hold period, then go out. While mail is down they stay
    queued and are retried at most every ten seconds."""
    global _mail_retry_after
    if _mail_retry_after and clock.now() < _mail_retry_after:
        return
    with transaction() as cursor:
        rows = cursor.all(
            """SELECT id, to_email, subject, body FROM notices
                WHERE status = 'queued' AND send_after <= %s ORDER BY send_after LIMIT 20""",
            (clock.now(),),
        )
    for row in rows:
        try:
            mail.send(row["to_email"], row["subject"], row["body"])
        except mail.MailUnavailable:
            _mail_retry_after = clock.now() + datetime.timedelta(seconds=RETRY_SECONDS)
            return
        with transaction() as cursor:
            cursor.execute(
                """UPDATE notices SET status = 'sent', sent_at = %s
                    WHERE id = %s AND status = 'queued'""",
                (clock.now(), row["id"]),
            )
    _mail_retry_after = None


def _retry_packs():
    with transaction() as cursor:
        rows = cursor.all(
            """SELECT id FROM packs
                WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= %s)
                ORDER BY requested_at LIMIT 5""",
            (clock.now(),),
        )
    for row in rows:
        with transaction() as cursor:
            packs.attempt(cursor, row["id"], SYSTEM_ACTOR_ID)


def _rerender_packs():
    with transaction() as cursor:
        rows = cursor.all(
            "SELECT id FROM packs WHERE rerender_needed = true ORDER BY requested_at LIMIT 5"
        )
    for row in rows:
        with transaction() as cursor:
            packs.rerender(cursor, row["id"])


def tick():
    try:
        storage.ensure_bucket()
    except ApiError:
        pass
    _send_due_notices()
    _retry_packs()
    _rerender_packs()


def _loop(stop):
    while not stop.wait(TICK_SECONDS):
        try:
            tick()
        except Exception:  # a background fault must not stop later ticks
            traceback.print_exc(file=sys.stderr)


def start():
    stop = threading.Event()
    threading.Thread(target=_loop, args=(stop,), name="background", daemon=True).start()
    return stop

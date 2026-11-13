"""The reading of now: the system instant plus the stored service clock offset, fresh for each request."""
import time
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from flask import g

HELSINKI = ZoneInfo("Europe/Helsinki")


def now(conn):
    """This request's instant, held to the whole second."""
    if "now" not in g:
        offset = conn.execute("SELECT c.offset_seconds FROM service_clock c").fetchone()["offset_seconds"]
        g.now = datetime.fromtimestamp(int(time.time()) + offset, UTC)
    return g.now


def today(conn):
    """The calendar date in Helsinki on the service clock."""
    return now(conn).astimezone(HELSINKI).date()


def published_form(instant):
    """An instant written `YYYY-MM-DDThh:mm:ssZ`, the form the API publishes."""
    return instant.astimezone(UTC).replace(tzinfo=None).isoformat(timespec="seconds") + "Z"

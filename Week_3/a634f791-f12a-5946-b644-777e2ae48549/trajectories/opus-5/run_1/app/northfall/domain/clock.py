"""The service clock: every reading of now, on every surface.

Now is the system instant plus the stored offset, read fresh for each request and
held to the whole second. Nothing else in the product may ask the system or the
database for the time.
"""

from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

from ..config import HELSINKI

HELSINKI_TZ = ZoneInfo(HELSINKI)


def read_offset(conn) -> int:
    row = conn.execute("SELECT offset_seconds FROM service_clock WHERE id = 1").fetchone()
    return int(row["offset_seconds"])


def now_from_offset(offset_seconds: int) -> dt.datetime:
    instant = dt.datetime.now(tz=dt.timezone.utc) + dt.timedelta(seconds=offset_seconds)
    return instant.replace(microsecond=0)


def service_now(conn) -> dt.datetime:
    return now_from_offset(read_offset(conn))


def helsinki_date(now: dt.datetime) -> dt.date:
    return now.astimezone(HELSINKI_TZ).date()


def as_helsinki(now: dt.datetime) -> dt.datetime:
    return now.astimezone(HELSINKI_TZ)


def helsinki_stamp(instant: dt.datetime) -> str:
    """The published wire form: YYYY-MM-DDThh:mm:ss with the Helsinki offset."""
    local = instant.astimezone(HELSINKI_TZ).replace(microsecond=0)
    return local.isoformat()

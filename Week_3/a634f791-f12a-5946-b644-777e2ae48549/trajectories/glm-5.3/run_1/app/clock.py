"""The reading of now and everything the service clock governs.

Every reading of now is the system instant plus the stored ``service_clock``
offset, read fresh for each request and held to the whole second. No HTTP
route reads the offset out or sets it.
"""

from __future__ import annotations

import datetime as dt

import core


def now(conn) -> dt.datetime:
    """The service clock's instant for this request."""
    with conn.cursor() as cur:
        cur.execute("SELECT offset_seconds FROM service_clock ORDER BY id LIMIT 1")
        row = cur.fetchone()
    offset = int(row["offset_seconds"]) if row else 0
    moment = dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=offset)
    return moment.replace(microsecond=0)


def now_today(conn) -> dt.date:
    return core.helsinki_date(now(conn))

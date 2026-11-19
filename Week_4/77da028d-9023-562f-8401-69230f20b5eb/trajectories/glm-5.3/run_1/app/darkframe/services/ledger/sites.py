"""The site facts the ledger needs, passed in by the caller per request."""
from __future__ import annotations

from typing import Any

import pytz

UTC_TZ = pytz.UTC


def zone_from_header(request: Any) -> Any:
    """The gateway forwards the imager's site time zone on internal calls."""
    name = request.headers.get("x-site-time-zone", "")
    try:
        return pytz.timezone(name)
    except Exception:
        return UTC_TZ


def site_today(zone: Any) -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).astimezone(zone).date().isoformat()

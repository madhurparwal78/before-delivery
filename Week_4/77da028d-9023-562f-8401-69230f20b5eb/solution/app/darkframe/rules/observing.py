"""The noon rule: which observing date an instant belongs to, in the site's time zone."""
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

NOON = time(12, 0)


def observing_date(instant: datetime, zone: ZoneInfo) -> date:
    local = instant.astimezone(zone)
    return local.date() if local.time() >= NOON else local.date() - timedelta(days=1)


def local_noon(observing: date, zone: ZoneInfo) -> datetime:
    """The site-local noon that opens the observing date, as an aware datetime."""
    return datetime.combine(observing, NOON, tzinfo=zone)

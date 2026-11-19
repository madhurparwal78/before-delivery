"""Site-local time, the noon rule for observing dates, and wire formats."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

NOON = time(12, 0)


def zone(time_zone: str) -> ZoneInfo:
    return ZoneInfo(time_zone)


def is_known_zone(time_zone: str) -> bool:
    try:
        ZoneInfo(time_zone)
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        return False
    return True


def now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def to_local(instant: datetime, time_zone: str) -> datetime:
    return instant.astimezone(zone(time_zone))


def observing_date_of(instant: datetime, time_zone: str) -> date:
    """The noon rule: before 12:00 site-local an instant belongs to the evening before."""
    local = to_local(instant, time_zone)
    return local.date() if local.time() >= NOON else local.date() - timedelta(days=1)


def resolve_wall_time(day: date, wall: time, time_zone: str) -> datetime:
    """A site-local wall time that may be skipped or repeated by a clock change.

    A skipped time moves forward by the length of the gap, which is what reading
    it with the pre-transition offset already does; a repeated time uses the
    first, earlier instant.
    """
    tz = zone(time_zone)
    naive = datetime.combine(day, wall)
    earlier = naive.replace(tzinfo=tz, fold=0)
    later = naive.replace(tzinfo=tz, fold=1)
    if earlier.utcoffset() >= later.utcoffset():
        return earlier
    return earlier.astimezone(timezone.utc).astimezone(tz)


def iso_local(instant: datetime, time_zone: str) -> str:
    return to_local(instant, time_zone).replace(microsecond=0).isoformat()


def iso_utc(instant: datetime) -> str:
    return (
        instant.astimezone(timezone.utc)
        .replace(microsecond=0, tzinfo=None)
        .isoformat()
        + "Z"
    )


def offset_label(instant: datetime, time_zone: str) -> str:
    """The site's UTC offset at an instant, in whole minutes, as +HH:MM."""
    offset = to_local(instant, time_zone).utcoffset() or timedelta(0)
    total = int(offset.total_seconds()) // 60
    sign = "-" if total < 0 else "+"
    total = abs(total)
    return f"{sign}{total // 60:02d}:{total % 60:02d}"


def hhmm(instant: datetime, time_zone: str) -> str:
    return to_local(instant, time_zone).strftime("%H:%M")


def parse_date(raw: object) -> date | None:
    if not isinstance(raw, str) or len(raw) != 10:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def parse_hhmm(raw: object) -> time | None:
    if not isinstance(raw, str) or len(raw) != 5 or raw[2] != ":":
        return None
    try:
        return time.fromisoformat(raw)
    except ValueError:
        return None


def parse_offset_instant(raw: object) -> datetime | None:
    """An ISO 8601 instant that carries an explicit offset."""
    if not isinstance(raw, str):
        return None
    text = raw[:-1] + "+00:00" if raw.endswith("Z") else raw
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(timezone.utc).replace(microsecond=0)


def parse_site_wall(raw: object, time_zone: str) -> datetime | None:
    """`YYYY-MM-DD HH:MM` in site time, taking the earlier instant of a repeat."""
    if not isinstance(raw, str):
        return None
    text = raw.strip().replace("T", " ")
    try:
        naive = datetime.strptime(text, "%Y-%m-%d %H:%M")
    except ValueError:
        return None
    return resolve_wall_time(naive.date(), naive.time(), time_zone)

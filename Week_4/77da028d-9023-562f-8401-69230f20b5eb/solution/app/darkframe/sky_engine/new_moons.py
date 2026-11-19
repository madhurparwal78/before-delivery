"""New moons from the mean series with its main periodic corrections, and the reminder occurrences built on them."""
from datetime import UTC, date, datetime, time, timedelta
from math import floor, radians, sin
from typing import Any
from zoneinfo import ZoneInfo

from darkframe.rules.timestamps import utc_text

SYNODIC_MONTH_DAYS = 29.530588861
DELTA_T_SECONDS = 69.2
UNIX_EPOCH_JD = 2440587.5
SATURDAY = 5
WEEKEND_REACH_DAYS = 3


def new_moon_utc(k: int) -> datetime:
    t = k / 1236.85
    jde = 2451550.09766 + SYNODIC_MONTH_DAYS * k + 0.00015437 * t ** 2 - 0.00000015 * t ** 3 + 0.00000000073 * t ** 4
    e = 1 - 0.002516 * t - 0.0000074 * t ** 2
    m = radians(2.5534 + 29.10535670 * k - 0.0000014 * t ** 2 - 0.00000011 * t ** 3)
    mp = radians(201.5643 + 385.81693528 * k + 0.0107582 * t ** 2 + 0.00001238 * t ** 3 - 0.000000058 * t ** 4)
    f = radians(160.7108 + 390.67050284 * k - 0.0016118 * t ** 2 - 0.00000227 * t ** 3 + 0.000000011 * t ** 4)
    omega = radians(124.7746 - 1.56375588 * k + 0.0020672 * t ** 2 + 0.00000215 * t ** 3)
    correction = (-0.40720 * sin(mp) + 0.17241 * e * sin(m) + 0.01608 * sin(2 * mp) + 0.01039 * sin(2 * f)
                  + 0.00739 * e * sin(mp - m) - 0.00514 * e * sin(mp + m) + 0.00208 * e * e * sin(2 * m)
                  - 0.00111 * sin(mp - 2 * f) - 0.00057 * sin(mp + 2 * f) + 0.00056 * e * sin(2 * mp + m)
                  - 0.00042 * sin(3 * mp) + 0.00042 * e * sin(m + 2 * f) + 0.00038 * e * sin(m - 2 * f)
                  - 0.00024 * e * sin(2 * mp - m) - 0.00017 * sin(omega) - 0.00007 * sin(mp + 2 * m)
                  + 0.00004 * sin(2 * mp - 2 * f) + 0.00004 * sin(3 * m) + 0.00003 * sin(mp + m - 2 * f)
                  + 0.00003 * sin(2 * mp + 2 * f) - 0.00003 * sin(mp + m + 2 * f) + 0.00003 * sin(mp - m + 2 * f)
                  - 0.00002 * sin(mp - m - 2 * f) - 0.00002 * sin(3 * mp + m) + 0.00002 * sin(4 * mp))
    return (datetime(1970, 1, 1, tzinfo=UTC) + timedelta(days=jde + correction - UNIX_EPOCH_JD)
            - timedelta(seconds=DELTA_T_SECONDS))


def new_moons_from(start: datetime, count: int) -> list[datetime]:
    k = floor((start.year + start.timetuple().tm_yday / 366 - 2000) * 12.3685) - 2
    found: list[datetime] = []
    while len(found) < count:
        moment = new_moon_utc(k)
        if moment >= start:
            found.append(moment)
        k += 1
    return found


def weekend_saturday(new_moon_local_date: date) -> date:
    """The Saturday nearest the date, within three days either way."""
    offset = SATURDAY - new_moon_local_date.weekday()
    if offset > WEEKEND_REACH_DAYS:
        offset -= 7
    return new_moon_local_date + timedelta(days=offset)


def occurrences(zone: ZoneInfo, local_time: str, first: date, count: int) -> list[dict[str, Any]]:
    """The first `count` new moons at or after 00:00 site-local on `first`, with the Friday reminder instant of each.
    A wall time inside a spring gap moves forward by the gap; a repeated autumn wall time takes the earlier instant."""
    hour, minute = map(int, local_time.split(":"))
    start = datetime.combine(first, time(0), tzinfo=zone).astimezone(UTC)
    found = []
    for moment in new_moons_from(start, count):
        local_date = moment.astimezone(zone).date()
        saturday = weekend_saturday(local_date)
        remind = datetime.combine(saturday - timedelta(days=1), time(hour, minute), tzinfo=zone)
        found.append({
            "new_moon_utc": utc_text(moment), "new_moon_local_date": local_date.isoformat(),
            "weekend_saturday": saturday.isoformat(),
            "remind_local": remind.astimezone(zone).isoformat(timespec="seconds"),
            "remind_utc": utc_text(remind)})
    return found

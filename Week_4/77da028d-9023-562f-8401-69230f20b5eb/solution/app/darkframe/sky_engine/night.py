"""The astronomical night of an observing date, and the site-local hours that conditions are entered for."""
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from functools import lru_cache
from zoneinfo import ZoneInfo

from darkframe.rules.observing import local_noon
from darkframe.rules.rounding import round_hundredth
from darkframe.sky_engine.ephemeris import (
    Site,
    julian_date,
    moon_illumination,
    sun_altitude_azimuth,
)

ASTRONOMICAL_TWILIGHT = -18.0
NARROWBAND_MARGIN_MINUTES = 30
MINUTE = timedelta(minutes=1)


@dataclass(frozen=True)
class Night:
    observing: date
    zone_name: str
    start: datetime
    minutes: int
    has_astronomical_night: bool
    moon_illumination: float

    @property
    def zone(self) -> ZoneInfo:
        return ZoneInfo(self.zone_name)

    def instant(self, minute: int) -> datetime:
        return self.start + minute * MINUTE

    def local_iso(self, instant: datetime) -> str:
        return instant.astimezone(self.zone).isoformat(timespec="seconds")

    def offset_text(self) -> str:
        return self.start.astimezone(self.zone).isoformat(timespec="seconds")[-6:]


@lru_cache(maxsize=1024)
def compute_night(site: Site, zone_name: str, observing: date) -> Night:
    zone = ZoneInfo(zone_name)
    noon = local_noon(observing, zone).astimezone(UTC)
    dusk = dawn = None
    for step in range(1, 24 * 60 + 1):
        instant = noon + step * MINUTE
        altitude, _ = sun_altitude_azimuth(julian_date(instant), site)
        if dusk is None and altitude < ASTRONOMICAL_TWILIGHT:
            dusk = instant
        elif dusk is not None and altitude >= ASTRONOMICAL_TWILIGHT:
            dawn = instant
            break
    if dusk is None:
        midnight = local_noon(observing + timedelta(days=1), zone).replace(hour=0).astimezone(UTC)
        return Night(observing, zone_name, midnight, 0, False, round_hundredth(moon_illumination(julian_date(midnight))))
    dawn = dawn or noon + 24 * 60 * MINUTE
    minutes = int((dawn - dusk) / MINUTE)
    return Night(observing, zone_name, dusk, minutes, True, round_hundredth(moon_illumination(julian_date(dusk))))


def narrowband_window(night: Night) -> tuple[datetime, datetime]:
    margin = NARROWBAND_MARGIN_MINUTES * MINUTE
    return night.start - margin, night.instant(night.minutes) + margin


def condition_hours(night: Night) -> list[datetime]:
    """Site-local hour starts from the hour holding the narrowband window's start to the hour holding its last minute."""
    if not night.has_astronomical_night:
        return []
    first, end = narrowband_window(night)
    last = end - MINUTE
    local = first.astimezone(night.zone)
    hour = first - timedelta(minutes=local.minute, seconds=local.second)
    hours = []
    while hour <= last:
        hours.append(hour)
        hour += timedelta(hours=1)
    return hours

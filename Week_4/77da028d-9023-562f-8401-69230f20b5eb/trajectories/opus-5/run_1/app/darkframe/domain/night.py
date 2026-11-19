"""The astronomical night window and the night's site-local hours."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

from . import astro, filters, rounding, timeutil

ASTRONOMICAL_TWILIGHT_DEG = -18.0


@dataclass(frozen=True)
class SiteFacts:
    label: str
    latitude: float
    longitude: float
    elevation_m: float
    time_zone: str

    @property
    def place(self) -> astro.Site:
        return astro.Site(self.latitude, self.longitude, self.elevation_m)


@dataclass(frozen=True)
class Night:
    observing_date: date
    dusk: datetime | None
    dawn: datetime | None
    minutes: int
    origin: datetime
    moon_illumination: float
    site: SiteFacts

    @property
    def has_astronomical_night(self) -> bool:
        return self.minutes > 0

    def instant_at(self, minute: int) -> datetime:
        return self.origin + timedelta(minutes=minute)

    def narrowband_bounds(self) -> tuple[int, int]:
        return filters.filter_window("Ha", self.minutes)

    def hour_starts(self) -> list[datetime]:
        """Site-local hour starts covering the narrowband window, in order."""
        if self.minutes == 0:
            return []
        start, end = self.narrowband_bounds()
        first = self.instant_at(start)
        last = self.instant_at(end - 1)
        local_first = timeutil.to_local(first, self.site.time_zone)
        cursor = local_first.replace(minute=0, second=0, microsecond=0)
        hours: list[datetime] = []
        seen: set[datetime] = set()
        while cursor.astimezone(timezone.utc) <= last.astimezone(timezone.utc):
            utc = cursor.astimezone(timezone.utc)
            if utc not in seen:
                seen.add(utc)
                hours.append(cursor)
            cursor = (cursor.astimezone(timezone.utc) + timedelta(hours=1)).astimezone(
                cursor.tzinfo
            )
        return hours

    def body(self) -> dict[str, object]:
        zone = self.site.time_zone
        start, end = self.narrowband_bounds()
        has_night = self.has_astronomical_night
        reference = self.dusk or self.origin
        return {
            "date": self.observing_date.isoformat(),
            "has_astronomical_night": has_night,
            "dusk": timeutil.iso_local(self.dusk, zone) if self.dusk else None,
            "dawn": timeutil.iso_local(self.dawn, zone) if self.dawn else None,
            "minutes": self.minutes,
            "narrowband_start": timeutil.iso_local(self.instant_at(start), zone)
            if has_night
            else None,
            "narrowband_end": timeutil.iso_local(self.instant_at(end), zone)
            if has_night
            else None,
            "moon_illumination": self.moon_illumination,
            "utc_offset_at_dusk": timeutil.offset_label(reference, zone),
        }


def _sun_altitude(instant: datetime, site: SiteFacts) -> float:
    position = astro.sun_position(instant)
    sidereal = astro.local_sidereal_time_deg(instant, site.longitude)
    return astro.to_horizontal(
        position.ra_deg, position.dec_deg, sidereal, site.latitude
    ).altitude_deg


def compute_night(site: SiteFacts, observing_date: date) -> Night:
    """Dusk is the first whole UTC minute after site-local noon below -18 degrees."""
    zone = site.time_zone
    noon = timeutil.resolve_wall_time(observing_date, time(12, 0), zone)
    next_noon = timeutil.resolve_wall_time(
        observing_date + timedelta(days=1), time(12, 0), zone
    )
    first_minute = _next_whole_minute(noon)
    limit = next_noon.astimezone(timezone.utc)

    dusk: datetime | None = None
    dawn: datetime | None = None
    cursor = first_minute
    while cursor <= limit:
        if _sun_altitude(cursor, site) < ASTRONOMICAL_TWILIGHT_DEG:
            dusk = cursor
            break
        cursor += timedelta(minutes=1)
    if dusk is not None:
        cursor = dusk + timedelta(minutes=1)
        while True:
            if _sun_altitude(cursor, site) >= ASTRONOMICAL_TWILIGHT_DEG:
                dawn = cursor
                break
            cursor += timedelta(minutes=1)

    if dusk is None or dawn is None:
        midnight = timeutil.resolve_wall_time(
            observing_date + timedelta(days=1), time(0, 0), zone
        ).astimezone(timezone.utc)
        origin, minutes = midnight, 0
    else:
        origin = dusk
        minutes = int((dawn - dusk).total_seconds() // 60)

    sun = astro.sun_position(origin)
    moon = astro.moon_position(origin)
    return Night(
        observing_date=observing_date,
        dusk=dusk,
        dawn=dawn,
        minutes=minutes,
        origin=origin,
        moon_illumination=rounding.illumination(astro.moon_illumination(sun, moon)),
        site=site,
    )


def _next_whole_minute(instant: datetime) -> datetime:
    utc = instant.astimezone(timezone.utc).replace(microsecond=0)
    return utc.replace(second=0) + timedelta(minutes=1)


def current_minute(night: Night, now: datetime) -> int:
    """Whole minutes since dusk, held to 0 before dusk and to `minutes` after dawn."""
    if night.dusk is None:
        return 0
    elapsed = math.floor((now - night.dusk).total_seconds() / 60.0)
    return max(0, min(night.minutes, int(elapsed)))

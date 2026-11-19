"""The domain rule: astronomical night windows, position status, usable minutes."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional

from darkframe.common import astro
from darkframe.common.zones import format_local_offset

BROADBAND_MIN_MOON_SEPARATION = 60.0
NARROWBAND_MIN_MOON_SEPARATION = {"OIII": 45.0, "Ha": 30.0, "SII": 30.0}


@dataclass
class Site:
    label: str
    latitude: float
    longitude: float
    elevation_m: int
    time_zone: str
    min_altitude_deg: int


@dataclass
class Night:
    date: str
    has_astronomical_night: bool
    dusk: Optional[datetime]
    dawn: Optional[datetime]
    minutes: int
    narrowband_start: Optional[datetime]
    narrowband_end: Optional[datetime]
    moon_illumination: float
    utc_offset_at_dusk: Optional[str]
    hours: list[datetime] = field(default_factory=list)


def compute_night(date_str: str, site: Site) -> Night:
    """Astronomical night for the observing date, per DP-06."""
    import datetime as dt

    from darkframe.common.zones import get_zone

    d = dt.datetime.strptime(date_str, "%Y-%m-%d").date()
    zone = get_zone(site.time_zone)
    noon_local = zone.localize(dt.datetime(d.year, d.month, d.day, 12, 0))  # type: ignore[attr-defined]
    noon_utc = noon_local.astimezone(timezone.utc)
    jd_noon = astro.julian_day(noon_utc)

    def sun_alt(t: datetime) -> float:
        jd = astro.julian_day(t)
        ra, dec = astro.sun_ra_dec(jd)
        lst = astro.local_sidereal_time_deg(t, site.longitude)
        return astro._alt_az(ra, dec, lst, site.latitude)[0]

    dusk_utc: Optional[datetime] = None
    dawn_utc: Optional[datetime] = None
    # Dusk: first whole minute after 12:00 site-local with the Sun below -18 degrees.
    t = noon_utc + timedelta(minutes=1)
    end_scan = noon_utc + timedelta(hours=18)
    while t <= end_scan:
        if sun_alt(t) < -18.0:
            dusk_utc = t
            break
        t += timedelta(minutes=1)
    if dusk_utc is not None:
        t = dusk_utc + timedelta(minutes=1)
        end_scan = noon_utc + timedelta(hours=24)
        while t <= end_scan:
            if sun_alt(t) >= -18.0:
                dawn_utc = t
                break
            t += timedelta(minutes=1)

    minutes = int((dawn_utc - dusk_utc).total_seconds() // 60) if (dusk_utc and dawn_utc) else 0
    if dusk_utc is None or dawn_utc is None or minutes <= 0:
        minutes = 0
        dusk_utc = None
        dawn_utc = None

    if minutes == 0:
        # Minute 0 is the site-local midnight after the observing date.
        midnight_local = zone.localize(dt.datetime(d.year, d.month, d.day, 0, 0))  # type: ignore[attr-defined]
        midnight_utc = midnight_local.astimezone(timezone.utc) + timedelta(days=1)
        jd_mid = astro.julian_day(midnight_utc)
        illum = round_half(astro.moon_illumination(jd_mid), 2)
        night = Night(
            date=date_str,
            has_astronomical_night=False,
            dusk=None,
            dawn=None,
            minutes=0,
            narrowband_start=None,
            narrowband_end=None,
            moon_illumination=illum,
            utc_offset_at_dusk=None,
        )
        night.hours = [midnight_utc]
        return night

    jd_dusk = astro.julian_day(dusk_utc)
    illum = round_half(astro.moon_illumination(jd_dusk), 2)
    off = format_local_offset(dusk_utc, site.time_zone)
    night = Night(
        date=date_str,
        has_astronomical_night=True,
        dusk=dusk_utc,
        dawn=dawn_utc,
        minutes=minutes,
        narrowband_start=dusk_utc - timedelta(minutes=30),
        narrowband_end=dawn_utc + timedelta(minutes=30),
        moon_illumination=illum,
        utc_offset_at_dusk=off,
    )
    # Site-local hour starts from the hour containing the narrowband start to the
    # hour containing its last minute (the exclusive end).
    start = night.narrowband_start.replace(minute=0, second=0, microsecond=0)
    last_minute = night.narrowband_end - timedelta(minutes=1)
    hours: list[datetime] = []
    cursor = start
    while cursor <= last_minute:
        hours.append(cursor)
        cursor += timedelta(hours=1)
    night.hours = hours
    return night


def round_half(value: float, digits: int) -> float:
    return astro.round_half_away(value, digits)


def minute_instant(night: Night, minute: int) -> datetime:
    """Night minute m is dusk plus m minutes; minute 0 is local midnight when there is no night."""
    if night.dusk is not None:
        return night.dusk + timedelta(minutes=minute)
    return night.hours[0]


def current_minute(night: Night, now_utc: datetime) -> int:
    """The current minute, held to 0 before dusk and `minutes` after dawn (DP-09)."""
    if night.minutes == 0:
        return 0
    assert night.dusk is not None and night.dawn is not None
    if now_utc < night.dusk:
        return 0
    if now_utc >= night.dawn:
        return night.minutes
    return int((now_utc - night.dusk).total_seconds() // 60)


def position_status(alt: float, mask_alt: int, min_alt: int) -> str:
    """Position status at an instant, per Business rules order."""
    if alt < 0:
        return "below-horizon"
    if alt < mask_alt and mask_alt >= min_alt:
        return "behind-treeline"
    if alt < min_alt:
        return "below-minimum"
    return "clear"


def filter_window(night: Night, narrowband: bool) -> tuple[int, int]:
    """Half-open [start, end) in night minutes for a filter's window."""
    if narrowband:
        return -30, night.minutes + 30
    return 0, night.minutes


def moon_clear(moon_alt: float, illumination: float, separation: float, filter_name: str) -> bool:
    if moon_alt < 0:
        return True
    if illumination < 0.25:
        return True
    if filter_name in ("Ha", "SII"):
        return separation >= 30.0
    if filter_name == "OIII":
        return separation >= 45.0
    return separation >= 60.0


def sky_clear(entry: Optional[dict]) -> bool:
    return bool(entry) and entry["cloud_pct"] <= 30 and entry["transparency"] >= 3


def condition_for(hours: list[dict], at_utc: datetime) -> Optional[dict]:
    """The entry whose hour start is at or before the instant and less than one hour before it."""
    best: Optional[dict] = None
    for entry in hours:
        start = entry["hour_start_utc"]
        if start <= at_utc < start + timedelta(hours=1):
            best = entry
            break
    return best

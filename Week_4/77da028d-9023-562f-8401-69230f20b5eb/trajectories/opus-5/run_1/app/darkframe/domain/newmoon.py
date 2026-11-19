"""New moons and the new-moon weekend reminder occurrences."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

from . import timeutil

SYNODIC_MONTH_DAYS = 29.530588861
J2000 = 2451545.0
SATURDAY = 5
NEAREST_SATURDAY_WINDOW_DAYS = 3

_PERIODIC = (
    (-0.40720, 0, 1, 0, 0),
    (0.17241, 1, 0, 1, 0),
    (0.01608, 0, 2, 0, 0),
    (0.01039, 0, 0, 0, 2),
    (0.00739, 1, 1, -1, 0),
    (-0.00514, 1, 1, 1, 0),
    (0.00208, 2, 0, 2, 0),
    (-0.00111, 0, 1, 0, -2),
    (-0.00057, 0, 1, 0, 2),
    (0.00056, 1, 2, 1, 0),
    (-0.00042, 0, 3, 0, 0),
    (0.00042, 1, 0, 1, 2),
    (0.00038, 1, 0, 1, -2),
    (-0.00024, 1, 2, -1, 0),
    (-0.00007, 0, 1, 2, 0),
    (0.00004, 0, 2, 0, -2),
    (0.00004, 0, 0, 3, 0),
    (0.00003, 0, 1, 1, -2),
    (0.00003, 0, 2, 0, 2),
    (-0.00003, 0, 1, 1, 2),
    (0.00003, 0, 1, -1, 2),
    (-0.00002, 0, 1, -1, -2),
    (-0.00002, 0, 3, 1, 0),
    (0.00002, 0, 4, 0, 0),
)

_PLANETARY = (
    (0.000325, 299.77, 0.107408, -0.009173),
    (0.000165, 251.88, 0.016321, 0.0),
    (0.000164, 251.83, 26.651886, 0.0),
    (0.000126, 349.42, 36.412478, 0.0),
    (0.000110, 84.66, 18.206239, 0.0),
    (0.000062, 141.74, 53.303771, 0.0),
    (0.000060, 207.14, 2.453732, 0.0),
    (0.000056, 154.84, 7.306860, 0.0),
    (0.000047, 34.52, 27.261239, 0.0),
    (0.000042, 207.19, 0.121824, 0.0),
    (0.000040, 291.34, 1.844379, 0.0),
    (0.000037, 161.72, 24.198154, 0.0),
    (0.000035, 239.56, 25.513099, 0.0),
    (0.000023, 331.55, 3.592518, 0.0),
)


@dataclass(frozen=True)
class Occurrence:
    new_moon_utc: datetime
    new_moon_local_date: date
    weekend_saturday: date
    remind_local: datetime

    def body(self, time_zone: str) -> dict[str, object]:
        return {
            "new_moon_utc": timeutil.iso_utc(self.new_moon_utc),
            "new_moon_local_date": self.new_moon_local_date.isoformat(),
            "weekend_saturday": self.weekend_saturday.isoformat(),
            "remind_local": self.remind_local.replace(microsecond=0).isoformat(),
            "remind_utc": timeutil.iso_utc(self.remind_local),
        }


def _delta_t_seconds(year: float) -> float:
    t = year - 2000.0
    return 62.92 + 0.32217 * t + 0.005589 * t * t


def _jd_to_datetime(jd: float) -> datetime:
    total = jd + 0.5
    whole = math.floor(total)
    fraction = total - whole
    if whole >= 2299161:
        alpha = math.floor((whole - 1867216.25) / 36524.25)
        whole = whole + 1 + alpha - math.floor(alpha / 4)
    b = whole + 1524
    c = math.floor((b - 122.1) / 365.25)
    d = math.floor(365.25 * c)
    e = math.floor((b - d) / 30.6001)
    day = b - d - math.floor(30.6001 * e)
    month = e - 1 if e < 14 else e - 13
    year = c - 4716 if month > 2 else c - 4715
    seconds = round(fraction * 86400.0)
    return datetime(int(year), int(month), int(day), tzinfo=timezone.utc) + timedelta(
        seconds=seconds
    )


def new_moon_instant(lunation: int) -> datetime:
    """Meeus' mean new-moon series with its periodic and planetary corrections."""
    k = float(lunation)
    t = k / 1236.85
    jde = (
        2451550.09766
        + SYNODIC_MONTH_DAYS * k
        + 0.00015437 * t**2
        - 0.000000150 * t**3
        + 0.00000000073 * t**4
    )
    eccentricity = 1 - 0.002516 * t - 0.0000074 * t * t
    sun_anomaly = math.radians(
        2.5534 + 29.10535670 * k - 0.0000014 * t**2 - 0.00000011 * t**3
    )
    moon_anomaly = math.radians(
        201.5643
        + 385.81693528 * k
        + 0.0107582 * t**2
        + 0.00001238 * t**3
        - 0.000000058 * t**4
    )
    latitude_argument = math.radians(
        160.7108
        + 390.67050284 * k
        - 0.0016118 * t**2
        - 0.00000227 * t**3
        + 0.000000011 * t**4
    )
    node = math.radians(
        124.7746 - 1.56375588 * k + 0.0020672 * t**2 + 0.00000215 * t**3
    )
    for coefficient, e_power, moon_term, sun_term, latitude_term in _PERIODIC:
        jde += (
            coefficient
            * eccentricity**e_power
            * math.sin(
                moon_term * moon_anomaly
                + sun_term * sun_anomaly
                + latitude_term * latitude_argument
            )
        )
    jde -= 0.00017 * math.sin(node)
    for coefficient, base, rate, quadratic in _PLANETARY:
        jde += coefficient * math.sin(
            math.radians(base + rate * k + quadratic * t * t)
        )
    approximate_year = 2000.0 + (jde - J2000) / 365.25
    instant = _jd_to_datetime(jde - _delta_t_seconds(approximate_year) / 86400.0)
    return (instant + timedelta(seconds=30)).replace(second=0, microsecond=0)


def _lunation_near(instant: datetime) -> int:
    reference = datetime(2000, 1, 6, 18, 14, tzinfo=timezone.utc)
    elapsed = (instant - reference).total_seconds() / 86400.0
    return math.floor(elapsed / SYNODIC_MONTH_DAYS) - 1


def nearest_saturday(day: date) -> date:
    """The Saturday nearest a date, within three days either way."""
    offset = (SATURDAY - day.weekday()) % 7
    if offset > NEAREST_SATURDAY_WINDOW_DAYS:
        offset -= 7
    return day + timedelta(days=offset)


def occurrences(
    time_zone: str, local_time: time, start: datetime, count: int
) -> list[Occurrence]:
    """The first `count` new moons at or after `start`, with their reminders."""
    found: list[Occurrence] = []
    lunation = _lunation_near(start)
    while len(found) < count:
        instant = new_moon_instant(lunation)
        lunation += 1
        if instant < start:
            continue
        local_date = timeutil.to_local(instant, time_zone).date()
        saturday = nearest_saturday(local_date)
        friday = saturday - timedelta(days=1)
        found.append(
            Occurrence(
                new_moon_utc=instant,
                new_moon_local_date=local_date,
                weekend_saturday=saturday,
                remind_local=timeutil.resolve_wall_time(friday, local_time, time_zone),
            )
        )
    return found

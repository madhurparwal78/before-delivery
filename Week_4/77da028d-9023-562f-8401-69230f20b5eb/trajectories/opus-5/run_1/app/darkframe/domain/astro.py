"""Ephemeris: the low-precision Astronomical Almanac formulae.

Nutation, aberration and atmospheric refraction are ignored. Azimuth runs from
north through east. Rounding lives in `rounding`, not here.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone

J2000 = 2451545.0
EARTH_RADIUS_KM = 6378.14
AU_IN_EARTH_RADII = 149_597_870.7 / EARTH_RADIUS_KM
FLATTENING_RATIO = 0.99664719


@dataclass(frozen=True)
class Horizontal:
    altitude_deg: float
    azimuth_deg: float


@dataclass(frozen=True)
class Equatorial:
    ra_deg: float
    dec_deg: float
    distance_earth_radii: float


@dataclass(frozen=True)
class Site:
    latitude: float
    longitude: float
    elevation_m: float


def julian_day(instant: datetime) -> float:
    utc = instant.astimezone(timezone.utc)
    year, month = utc.year, utc.month
    day = (
        utc.day
        + (utc.hour + (utc.minute + (utc.second + utc.microsecond / 1e6) / 60) / 60) / 24
    )
    if month <= 2:
        year -= 1
        month += 12
    a = year // 100
    b = 2 - a + a // 4
    return (
        math.floor(365.25 * (year + 4716))
        + math.floor(30.6001 * (month + 1))
        + day
        + b
        - 1524.5
    )


def obliquity_deg(jd: float) -> float:
    return 23.439 - 0.0000004 * (jd - J2000)


def greenwich_mean_sidereal_time_deg(instant: datetime) -> float:
    """The IAU 1982 expression for Greenwich mean sidereal time."""
    utc = instant.astimezone(timezone.utc)
    midnight = utc.replace(hour=0, minute=0, second=0, microsecond=0)
    t0 = (julian_day(midnight) - J2000) / 36525.0
    seconds_of_day = (utc - midnight).total_seconds()
    gmst_seconds = (
        24110.54841
        + 8640184.812866 * t0
        + 0.093104 * t0 * t0
        - 6.2e-6 * t0 * t0 * t0
        + 1.0027379093 * seconds_of_day
    )
    return (gmst_seconds / 240.0) % 360.0


def local_sidereal_time_deg(instant: datetime, longitude: float) -> float:
    return (greenwich_mean_sidereal_time_deg(instant) + longitude) % 360.0


def sun_position(instant: datetime) -> Equatorial:
    jd = julian_day(instant)
    n = jd - J2000
    mean_longitude = 280.460 + 0.9856474 * n
    anomaly = math.radians((357.528 + 0.9856003 * n) % 360.0)
    ecliptic_longitude = math.radians(
        (mean_longitude + 1.915 * math.sin(anomaly) + 0.020 * math.sin(2 * anomaly))
        % 360.0
    )
    epsilon = math.radians(obliquity_deg(jd))
    distance_au = (
        1.00014 - 0.01671 * math.cos(anomaly) - 0.00014 * math.cos(2 * anomaly)
    )
    ra = math.degrees(
        math.atan2(
            math.cos(epsilon) * math.sin(ecliptic_longitude),
            math.cos(ecliptic_longitude),
        )
    ) % 360.0
    dec = math.degrees(math.asin(math.sin(epsilon) * math.sin(ecliptic_longitude)))
    return Equatorial(ra, dec, distance_au * AU_IN_EARTH_RADII)


def moon_position(instant: datetime) -> Equatorial:
    jd = julian_day(instant)
    t = (jd - J2000) / 36525.0
    longitude = (
        218.32
        + 481267.881 * t
        + 6.29 * math.sin(math.radians(135.0 + 477198.87 * t))
        - 1.27 * math.sin(math.radians(259.2 - 413335.36 * t))
        + 0.66 * math.sin(math.radians(235.7 + 890534.22 * t))
        + 0.21 * math.sin(math.radians(269.9 + 954397.74 * t))
        - 0.19 * math.sin(math.radians(357.5 + 35999.05 * t))
        - 0.11 * math.sin(math.radians(186.5 + 966404.03 * t))
    )
    latitude = (
        5.13 * math.sin(math.radians(93.3 + 483202.02 * t))
        + 0.28 * math.sin(math.radians(228.2 + 960400.89 * t))
        - 0.28 * math.sin(math.radians(318.3 + 6003.15 * t))
        - 0.17 * math.sin(math.radians(217.6 - 407332.21 * t))
    )
    parallax = (
        0.9508
        + 0.0518 * math.cos(math.radians(135.0 + 477198.87 * t))
        + 0.0095 * math.cos(math.radians(259.2 - 413335.38 * t))
        + 0.0078 * math.cos(math.radians(235.7 + 890534.22 * t))
        + 0.0028 * math.cos(math.radians(269.9 + 954397.70 * t))
    )
    lam = math.radians(longitude % 360.0)
    beta = math.radians(latitude)
    epsilon = math.radians(obliquity_deg(jd))
    ra = math.degrees(
        math.atan2(
            math.sin(lam) * math.cos(epsilon)
            - math.tan(beta) * math.sin(epsilon),
            math.cos(lam),
        )
    ) % 360.0
    dec = math.degrees(
        math.asin(
            math.sin(beta) * math.cos(epsilon)
            + math.cos(beta) * math.sin(epsilon) * math.sin(lam)
        )
    )
    return Equatorial(ra, dec, 1.0 / math.sin(math.radians(parallax)))


def precess_from_j2000(ra_deg: float, dec_deg: float, instant: datetime) -> tuple[float, float]:
    """Precesses J2000 coordinates to the date with the IAU 1976 angles."""
    t = (julian_day(instant) - J2000) / 36525.0
    arcsec = 1.0 / 3600.0
    zeta = math.radians(
        arcsec * (2306.2181 * t + 0.30188 * t * t + 0.017998 * t * t * t)
    )
    z = math.radians(arcsec * (2306.2181 * t + 1.09468 * t * t + 0.018203 * t * t * t))
    theta = math.radians(
        arcsec * (2004.3109 * t - 0.42665 * t * t - 0.041833 * t * t * t)
    )
    ra = math.radians(ra_deg)
    dec = math.radians(dec_deg)
    a = math.cos(dec) * math.sin(ra + zeta)
    b = math.cos(theta) * math.cos(dec) * math.cos(ra + zeta) - math.sin(
        theta
    ) * math.sin(dec)
    c = math.sin(theta) * math.cos(dec) * math.cos(ra + zeta) + math.cos(
        theta
    ) * math.sin(dec)
    return (math.degrees(math.atan2(a, b) + z) % 360.0, math.degrees(math.asin(c)))


def to_horizontal(
    ra_deg: float, dec_deg: float, sidereal_deg: float, latitude: float
) -> Horizontal:
    hour_angle = math.radians((sidereal_deg - ra_deg) % 360.0)
    dec = math.radians(dec_deg)
    lat = math.radians(latitude)
    sin_altitude = math.sin(dec) * math.sin(lat) + math.cos(dec) * math.cos(
        lat
    ) * math.cos(hour_angle)
    sin_altitude = max(-1.0, min(1.0, sin_altitude))
    altitude = math.asin(sin_altitude)
    north = math.sin(dec) * math.cos(lat) - math.cos(dec) * math.sin(lat) * math.cos(
        hour_angle
    )
    east = -math.cos(dec) * math.sin(hour_angle)
    azimuth = math.degrees(math.atan2(east, north)) % 360.0
    return Horizontal(math.degrees(altitude), azimuth)


def _observer_vector(site: Site, sidereal_deg: float) -> tuple[float, float, float]:
    lat = math.radians(site.latitude)
    reduced = math.atan(FLATTENING_RATIO * math.tan(lat))
    height = site.elevation_m / (EARTH_RADIUS_KM * 1000.0)
    rho_sin = FLATTENING_RATIO * math.sin(reduced) + height * math.sin(lat)
    rho_cos = math.cos(reduced) + height * math.cos(lat)
    sidereal = math.radians(sidereal_deg)
    return (rho_cos * math.cos(sidereal), rho_cos * math.sin(sidereal), rho_sin)


def moon_topocentric(
    geocentric: Equatorial, site: Site, sidereal_deg: float
) -> Horizontal:
    """The Moon with topocentric parallax from the site's position."""
    ra = math.radians(geocentric.ra_deg)
    dec = math.radians(geocentric.dec_deg)
    r = geocentric.distance_earth_radii
    x = r * math.cos(dec) * math.cos(ra)
    y = r * math.cos(dec) * math.sin(ra)
    z = r * math.sin(dec)
    ox, oy, oz = _observer_vector(site, sidereal_deg)
    dx, dy, dz = x - ox, y - oy, z - oz
    distance = math.sqrt(dx * dx + dy * dy + dz * dz)
    topocentric_ra = math.degrees(math.atan2(dy, dx)) % 360.0
    topocentric_dec = math.degrees(math.asin(dz / distance))
    return to_horizontal(topocentric_ra, topocentric_dec, sidereal_deg, site.latitude)


def moon_illumination(sun: Equatorial, moon: Equatorial) -> float:
    """The lit fraction of the Moon's disc."""
    elongation = angular_separation_equatorial(sun, moon)
    psi = math.radians(elongation)
    phase_angle = math.atan2(
        sun.distance_earth_radii * math.sin(psi),
        moon.distance_earth_radii - sun.distance_earth_radii * math.cos(psi),
    )
    return (1.0 + math.cos(phase_angle)) / 2.0


def angular_separation_equatorial(a: Equatorial, b: Equatorial) -> float:
    return _separation(a.ra_deg, a.dec_deg, b.ra_deg, b.dec_deg)


def angular_separation(a: Horizontal, b: Horizontal) -> float:
    return _separation(a.azimuth_deg, a.altitude_deg, b.azimuth_deg, b.altitude_deg)


def _separation(lon_a: float, lat_a: float, lon_b: float, lat_b: float) -> float:
    lat1, lat2 = math.radians(lat_a), math.radians(lat_b)
    delta = math.radians(lon_a - lon_b)
    cosine = math.sin(lat1) * math.sin(lat2) + math.cos(lat1) * math.cos(
        lat2
    ) * math.cos(delta)
    return math.degrees(math.acos(max(-1.0, min(1.0, cosine))))

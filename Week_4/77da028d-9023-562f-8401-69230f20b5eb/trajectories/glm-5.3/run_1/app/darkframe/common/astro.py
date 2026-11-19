"""Astronomy primitives: ephemeris, sidereal time, night windows, new moons."""
from __future__ import annotations

import math
from datetime import datetime, timezone

J2000 = datetime(2000, 1, 1, 12, 0, 0, tzinfo=timezone.utc)


def to_utc(aware: datetime) -> datetime:
    return aware.astimezone(timezone.utc)


def julian_day(utc: datetime) -> float:
    return 2451545.0 + (to_utc(utc) - J2000).total_seconds() / 86400.0


def j2000_centuries(utc: datetime) -> float:
    return (julian_day(utc) - 2451545.0) / 36525.0


def normalize_deg(angle: float) -> float:
    return angle % 360.0


def normalize_signed_deg(angle: float) -> float:
    a = normalize_deg(angle)
    return a - 360.0 if a > 180.0 else a


def round_half_away(value: float, digits: int = 0) -> float:
    scale = 10 ** digits
    scaled = value * scale
    floor = math.floor(scaled)
    frac = scaled - floor
    if frac > 0.5:
        floor += 1
    elif frac == 0.5 and (floor % 2) != 0:
        floor += 1
    return floor / scale


def _quad(x: float) -> float:
    """Normalize x to the range [0, 2*pi)."""
    return x % (2 * math.pi)


def _radians(degrees: float) -> float:
    return math.radians(degrees)


def _degrees(radians: float) -> float:
    return math.degrees(radians)


def sun_ra_dec(jd: float) -> tuple[float, float]:
    t = (jd - 2451545.0) / 36525.0
    mean = normalize_deg(280.460 + 36000.7712 * t)
    mean_anomaly = normalize_deg(357.5291092 + 35999.0502909 * t)
    m = _radians(mean_anomaly)
    center = (
        1.914666471 * math.sin(m)
        + 0.019994643 * math.sin(2 * m)
        + 0.000292538 * math.sin(3 * m)
    )
    true_long = mean + center
    omega = 259.18 - 1934.142 * t
    lam = true_long - 0.00569 - 0.00478 * math.sin(_radians(omega))
    r = 1.000001018 * (1 - 0.016708634 * math.cos(m) - 0.00014166 * math.cos(2 * m))
    epsilon = _radians(23.4392911 - 0.0130042 * t)
    lam_r = _radians(lam)
    ra = normalize_deg(_degrees(math.atan2(math.cos(epsilon) * math.sin(lam_r), math.cos(lam_r))))
    dec = _degrees(math.asin(math.sin(epsilon) * math.sin(lam_r)))
    return ra, dec


def greenwich_mean_sidereal_time_deg(utc: datetime) -> float:
    jd = julian_day(utc)
    t = (jd - 2451545.0) / 36525.0
    theta = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * t * t - (t ** 3) / 38710000.0
    return normalize_deg(theta)


def local_sidereal_time_deg(utc: datetime, longitude_deg: float) -> float:
    return normalize_deg(greenwich_mean_sidereal_time_deg(utc) + longitude_deg)


def moon_state(jd: float) -> dict:
    """Moon ecliptic longitude and geocentric distance from the simplified lunar theory."""
    t = (jd - 2451545.0) / 36525.0
    lp = 218.3164477 + 481267.88123421 * t
    d = 477198.8675055 + 444501.77613095 * t
    m = 357.5291092 + 35999.0502909 * t
    mp = 96.14554717 + 2775.776961 * t
    f = 93.2720950 + 483202.0175233 * t
    moon_long = normalize_deg(lp + 6.28875 * math.sin(_radians(d)) + 1.274018 * math.sin(_radians(2 * d - m))
                              + 0.658309 * math.sin(_radians(2 * d)) + 0.213616 * math.sin(_radians(2 * mp))
                              - 0.185596 * math.sin(_radians(m)) - 0.114336 * math.sin(_radians(2 * f)))
    moon_lat = 5.128122 * math.sin(_radians(f)) + 0.280602 * math.sin(_radians(mp + f)) + 0.277693 * math.sin(
        _radians(mp - f)) + 0.173237 * math.sin(_radians(2 * d - f))
    moon_dist = 20905555.0 + (
        -3699111.23 * math.cos(_radians(d)) - 2955967.75 * math.cos(_radians(2 * d))
        - 569925.19 * math.cos(_radians(2 * d - m)) + 48888.30 * math.cos(_radians(2 * mp))
        - 3149.00 * math.cos(_radians(2 * f))
    )
    ra_corr = normalize_deg(moon_long - 1.397 * t - 0.00031 * t * t)
    return {
        "long": moon_long,
        "lat": moon_lat,
        "distance": moon_dist,
        "ra_corr": ra_corr,
    }


def obliquity(jd: float) -> float:
    t = (jd - 2451545.0) / 36525.0
    return _radians(23.4392911 - 0.0130042 * t)


def moon_ra_dec_dist(jd: float) -> tuple[float, float, float]:
    ms = moon_state(jd)
    eps = obliquity(jd)
    lon = _radians(ms["long"])
    lat = _radians(ms["lat"])
    x = math.cos(lat) * math.cos(lon)
    y = math.cos(eps) * math.cos(lat) * math.sin(lon) - math.sin(eps) * math.sin(lat)
    z = math.sin(eps) * math.cos(lat) * math.sin(lon) + math.cos(eps) * math.sin(lat)
    ra = normalize_deg(_degrees(math.atan2(y, x)))
    dec = _degrees(math.atan2(z, math.sqrt(x * x + y * y)))
    return ra, dec, ms["distance"]


def precess_ra_dec(ra_deg: float, dec_deg: float, jd: float) -> tuple[float, float]:
    """Precess J2000 equatorial coordinates to the date of jd (IAU precession angles)."""
    t = (jd - 2451545.0) / 36525.0
    zeta = _radians((2306.2181 * t + 0.30188 * t * t + 0.017998 * t ** 3) / 3600.0)
    z = _radians((2306.2181 * t + 1.09468 * t * t + 0.017998 * t ** 3) / 3600.0)
    theta = _radians((2004.3109 * t - 0.42665 * t * t - 0.041833 * t ** 3) / 3600.0)
    ra_r = _radians(ra_deg)
    dec_r = _radians(dec_deg)
    cosd = math.cos(dec_r)
    x = cosd * math.cos(ra_r)
    y = cosd * math.sin(ra_r)
    zc = math.sin(dec_r)
    # P = R3(-z) R2(theta) R3(-zeta), applied to the unit vector.
    x1 = math.cos(zeta) * x - math.sin(zeta) * y
    y1 = math.sin(zeta) * x + math.cos(zeta) * y
    x2 = math.cos(theta) * x1 + math.sin(theta) * zc
    z2 = -math.sin(theta) * x1 + math.cos(theta) * zc
    x3 = math.cos(z) * x2 - math.sin(z) * y1
    y3 = math.sin(z) * x2 + math.cos(z) * y1
    ra2 = normalize_deg(_degrees(math.atan2(y3, x3)))
    dec2 = _degrees(math.asin(max(-1.0, min(1.0, z2))))
    return ra2, dec2


def _alt_az(ra_deg: float, dec_deg: float, lst_deg: float, lat_deg: float) -> tuple[float, float]:
    ha = _radians(normalize_signed_deg(lst_deg - ra_deg))
    dec_r = _radians(dec_deg)
    lat_r = _radians(lat_deg)
    sin_alt = math.sin(dec_r) * math.sin(lat_r) + math.cos(dec_r) * math.cos(lat_r) * math.cos(ha)
    alt = math.asin(max(-1.0, min(1.0, sin_alt)))
    cos_az = (math.sin(dec_r) - math.sin(alt) * math.sin(lat_r)) / (math.cos(alt) * math.cos(lat_r))
    cos_az = max(-1.0, min(1.0, cos_az))
    az = _degrees(math.acos(cos_az))
    if math.sin(ha) > 0:
        az = 360.0 - az
    return _degrees(alt), normalize_deg(az)


def topocentric_moon(jd: float, utc: datetime, lat_deg: float, lon_deg: float, elevation_m: float) -> tuple[float, float, float]:
    """Moon topocentric altitude and azimuth, corrected for parallax."""
    ra, dec, dist = moon_ra_dec_dist(jd)
    lst = local_sidereal_time_deg(utc, lon_deg)
    alt, az = _alt_az(ra, dec, lst, lat_deg)
    parallax = _degrees(math.asin(6378.137 / dist))
    alt_topo = alt - parallax * math.cos(_radians(alt))
    return alt_topo, az, dist


def separation_deg(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    ra1r, dec1r = _radians(ra1), _radians(dec1)
    ra2r, dec2r = _radians(ra2), _radians(dec2)
    cos_d = math.sin(dec1r) * math.sin(dec2r) + math.cos(dec1r) * math.cos(dec2r) * math.cos(ra1r - ra2r)
    return _degrees(math.acos(max(-1.0, min(1.0, cos_d))))


def moon_illumination(jd: float) -> float:
    """Lit fraction of the lunar disc from the Sun-Moon-observer geometry."""
    sun_ra, sun_dec = sun_ra_dec(jd)
    moon_ra, moon_dec, dist = moon_ra_dec_dist(jd)
    elong = separation_deg(sun_ra, sun_dec, moon_ra, moon_dec)
    sun_dist = 149597870.7
    phase_angle = math.atan2(
        sun_dist * math.sin(_radians(elong)),
        dist - sun_dist * math.cos(_radians(elong)),
    )
    return (1 + math.cos(phase_angle)) / 2


def angular_separation_altaz(alt1: float, az1: float, alt2: float, az2: float) -> float:
    a1, d1 = _radians(90 - alt1), _radians(az1)
    a2, d2 = _radians(90 - alt2), _radians(az2)
    cos_d = math.cos(a1) * math.cos(a2) + math.sin(a1) * math.sin(a2) * math.cos(d1 - d2)
    return _degrees(math.acos(max(-1.0, min(1.0, cos_d))))

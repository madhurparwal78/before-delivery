"""Sun, Moon, sidereal time and target positions: the Astronomical Almanac low-precision Sun, the Meeus truncated
lunar series with topocentric parallax, the IAU 1982 sidereal time. Nutation, aberration and refraction are ignored."""
from datetime import datetime
from math import acos, asin, atan2, cos, degrees, radians, sin, tan
from typing import NamedTuple

J2000 = 2451545.0
EARTH_RADIUS_KM = 6378.14
ASTRONOMICAL_UNIT_KM = 149597870.7
SIDEREAL_DEGREES_PER_MINUTE = 360.98564736629 / 1440


class Site(NamedTuple):
    latitude: float
    longitude: float
    elevation_m: float


# Meeus, Astronomical Algorithms ch. 47: (D, M, M', F, longitude 1e-6 deg, distance 1e-3 km)
LUNAR_LONGITUDE_DISTANCE = (
    (0, 0, 1, 0, 6288774, -20905355), (2, 0, -1, 0, 1274027, -3699111), (2, 0, 0, 0, 658314, -2955968),
    (0, 0, 2, 0, 213618, -569925), (0, 1, 0, 0, -185116, 48888), (0, 0, 0, 2, -114332, -3149),
    (2, 0, -2, 0, 58793, 246158), (2, -1, -1, 0, 57066, -152138), (2, 0, 1, 0, 53322, -170733),
    (2, -1, 0, 0, 45758, -204586), (0, 1, -1, 0, -40923, -129620), (1, 0, 0, 0, -34720, 108743),
    (0, 1, 1, 0, -30383, 104755), (2, 0, 0, -2, 15327, 10321), (0, 0, 1, 2, -12528, 0),
    (0, 0, 1, -2, 10980, 79661), (4, 0, -1, 0, 10675, -34782), (0, 0, 3, 0, 10034, -23210),
    (4, 0, -2, 0, 8548, -21636), (2, 1, -1, 0, -7888, 24208), (2, 1, 0, 0, -6766, 30824),
    (1, 0, -1, 0, -5163, -8379), (1, 1, 0, 0, 4987, -16675), (2, -1, 1, 0, 4036, -12831),
    (2, 0, 2, 0, 3994, -10445), (4, 0, 0, 0, 3861, -11650), (2, 0, -3, 0, 3665, 14403),
    (0, 1, -2, 0, -2689, -7003), (2, 0, -1, 2, -2602, 0), (2, -1, -2, 0, 2390, 10056),
    (1, 0, 1, 0, -2348, 6322), (2, -2, 0, 0, 2236, -9884),
)
# (D, M, M', F, latitude 1e-6 deg)
LUNAR_LATITUDE = (
    (0, 0, 0, 1, 5128122), (0, 0, 1, 1, 280602), (0, 0, 1, -1, 277693), (2, 0, 0, -1, 173237),
    (2, 0, -1, 1, 55413), (2, 0, -1, -1, 46271), (2, 0, 0, 1, 32573), (0, 0, 2, 1, 17198),
    (2, 0, 1, -1, 9266), (0, 0, 2, -1, 8822), (2, -1, 0, -1, 8216), (2, 0, -2, -1, 4324),
    (2, 0, 1, 1, 4200), (2, 1, 0, -1, -3359), (2, -1, -1, 1, 2463), (2, -1, 0, 1, 2211),
    (2, -1, -1, -1, 2065), (0, 1, -1, -1, -1870), (4, 0, -1, -1, 1828), (0, 1, 0, 1, -1794),
    (0, 0, 0, 3, -1749), (0, 1, -1, 1, -1565), (1, 0, 0, 1, -1491), (0, 1, 1, 1, -1475),
    (0, 1, 1, -1, -1410), (0, 1, 0, -1, -1344), (1, 0, 0, -1, -1335),
)


def julian_date(instant: datetime) -> float:
    return instant.timestamp() / 86400 + 2440587.5


def greenwich_sidereal_degrees(jd: float) -> float:
    days = jd - J2000
    centuries = days / 36525
    return (280.46061837 + 360.98564736629 * days + 0.000387933 * centuries ** 2 - centuries ** 3 / 38710000) % 360


def local_sidereal_degrees(jd: float, longitude: float) -> float:
    return (greenwich_sidereal_degrees(jd) + longitude) % 360


def sun_equatorial(jd: float) -> tuple[float, float, float]:
    """Right ascension and declination in degrees, and the distance in kilometres."""
    days = jd - J2000
    mean_longitude = 280.460 + 0.9856474 * days
    anomaly = radians((357.528 + 0.9856003 * days) % 360)
    ecliptic_longitude = radians(mean_longitude + 1.915 * sin(anomaly) + 0.020 * sin(2 * anomaly))
    obliquity = radians(23.439 - 0.0000004 * days)
    right_ascension = degrees(atan2(cos(obliquity) * sin(ecliptic_longitude), cos(ecliptic_longitude))) % 360
    declination = degrees(asin(sin(obliquity) * sin(ecliptic_longitude)))
    distance = ASTRONOMICAL_UNIT_KM * (1.00014 - 0.01671 * cos(anomaly) - 0.00014 * cos(2 * anomaly))
    return right_ascension, declination, distance


def altitude_azimuth(right_ascension: float, declination: float, local_sidereal: float,
                     latitude: float) -> tuple[float, float]:
    """Altitude and azimuth (north through east) in degrees for an equatorial position."""
    hour_angle = radians(local_sidereal - right_ascension)
    dec, lat = radians(declination), radians(latitude)
    altitude = asin(sin(lat) * sin(dec) + cos(lat) * cos(dec) * cos(hour_angle))
    azimuth = atan2(-sin(hour_angle) * cos(dec), sin(dec) * cos(lat) - cos(dec) * sin(lat) * cos(hour_angle))
    return degrees(altitude), degrees(azimuth) % 360


def sun_altitude_azimuth(jd: float, site: Site) -> tuple[float, float]:
    right_ascension, declination, _ = sun_equatorial(jd)
    return altitude_azimuth(right_ascension, declination, local_sidereal_degrees(jd, site.longitude), site.latitude)


def moon_geocentric(jd: float) -> tuple[float, float, float]:
    """Right ascension and declination in degrees, and the distance in kilometres."""
    t = (jd - J2000) / 36525
    mean_longitude = 218.3164477 + 481267.88123421 * t
    elongation = 297.8501921 + 445267.1114034 * t
    sun_anomaly = 357.5291092 + 35999.0502909 * t
    moon_anomaly = 134.9633964 + 477198.8675055 * t
    latitude_argument = 93.2720950 + 483202.0175233 * t
    venus = 119.75 + 131.849 * t
    jupiter = 53.09 + 479264.290 * t
    flattening = 313.45 + 481266.484 * t
    eccentricity = 1 - 0.002516 * t
    longitude_sum = distance_sum = latitude_sum = 0.0
    for d, m, mp, f, longitude_term, distance_term in LUNAR_LONGITUDE_DISTANCE:
        argument = radians(d * elongation + m * sun_anomaly + mp * moon_anomaly + f * latitude_argument)
        weight = eccentricity ** abs(m)
        longitude_sum += longitude_term * weight * sin(argument)
        distance_sum += distance_term * weight * cos(argument)
    for d, m, mp, f, latitude_term in LUNAR_LATITUDE:
        argument = radians(d * elongation + m * sun_anomaly + mp * moon_anomaly + f * latitude_argument)
        latitude_sum += latitude_term * eccentricity ** abs(m) * sin(argument)
    longitude_sum += (3958 * sin(radians(venus)) + 1962 * sin(radians(mean_longitude - latitude_argument))
                      + 318 * sin(radians(jupiter)))
    latitude_sum += (-2235 * sin(radians(mean_longitude)) + 382 * sin(radians(flattening))
                     + 175 * sin(radians(venus - latitude_argument)) + 175 * sin(radians(venus + latitude_argument))
                     + 127 * sin(radians(mean_longitude - moon_anomaly))
                     - 115 * sin(radians(mean_longitude + moon_anomaly)))
    longitude = radians(mean_longitude + longitude_sum / 1e6)
    latitude = radians(latitude_sum / 1e6)
    obliquity = radians(23.4392911 - 0.0130042 * t)
    right_ascension = degrees(atan2(sin(longitude) * cos(obliquity) - tan(latitude) * sin(obliquity),
                                    cos(longitude))) % 360
    declination = degrees(asin(sin(latitude) * cos(obliquity) + cos(latitude) * sin(obliquity) * sin(longitude)))
    return right_ascension, declination, 385000.56 + distance_sum / 1000


def moon_topocentric(jd: float, site: Site, geocentric: tuple[float, float, float] | None = None) -> tuple[float, float]:
    """Altitude (with parallax from the site's height) and azimuth in degrees."""
    right_ascension, declination, distance = geocentric or moon_geocentric(jd)
    altitude, azimuth = altitude_azimuth(right_ascension, declination, local_sidereal_degrees(jd, site.longitude),
                                         site.latitude)
    elevated_radius = EARTH_RADIUS_KM + site.elevation_m / 1000
    geocentric_altitude = radians(altitude)
    return degrees(atan2(distance * sin(geocentric_altitude) - elevated_radius, distance * cos(geocentric_altitude))), azimuth


def moon_illumination(jd: float, geocentric: tuple[float, float, float] | None = None) -> float:
    """The lit fraction of the disc, 0 to 1."""
    sun_ra, sun_dec, sun_distance = sun_equatorial(jd)
    moon_ra, moon_dec, moon_distance = geocentric or moon_geocentric(jd)
    elongation = angular_separation(sun_dec, sun_ra, moon_dec, moon_ra)
    phase_angle = atan2(sun_distance * sin(elongation), moon_distance - sun_distance * cos(elongation))
    return (1 + cos(phase_angle)) / 2


def angular_separation(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle separation in radians between two (latitude/altitude, longitude/azimuth) pairs given in degrees."""
    a1, l1, a2, l2 = map(radians, (lat1, lon1, lat2, lon2))
    cosine = sin(a1) * sin(a2) + cos(a1) * cos(a2) * cos(l1 - l2)
    return acos(max(-1.0, min(1.0, cosine)))


def precess(right_ascension: float, declination: float, jd: float) -> tuple[float, float]:
    """J2000 right ascension and declination precessed to the date of `jd`."""
    t = (jd - J2000) / 36525
    zeta = radians((2306.2181 * t + 0.30188 * t * t + 0.017998 * t ** 3) / 3600)
    z = radians((2306.2181 * t + 1.09468 * t * t + 0.018203 * t ** 3) / 3600)
    theta = radians((2004.3109 * t - 0.42665 * t * t - 0.041833 * t ** 3) / 3600)
    alpha, delta = radians(right_ascension), radians(declination)
    a = cos(delta) * sin(alpha + zeta)
    b = cos(theta) * cos(delta) * cos(alpha + zeta) - sin(theta) * sin(delta)
    c = sin(theta) * cos(delta) * cos(alpha + zeta) + cos(theta) * sin(delta)
    return (degrees(atan2(a, b)) + degrees(z)) % 360, degrees(asin(c))

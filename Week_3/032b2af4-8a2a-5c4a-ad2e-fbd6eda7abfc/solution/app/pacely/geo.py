"""Geometry: the one haversine, segment matching and privacy zones all use it."""

import math

EARTH_RADIUS_M = 6371000.0
MATCH_RADIUS_M = 25.0


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres on a sphere of radius 6371000 m."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    half_dlat = (phi2 - phi1) / 2
    half_dlon = math.radians(lon2 - lon1) / 2
    a = math.sin(half_dlat) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(half_dlon) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def within(lat: float, lon: float, centre_lat: float, centre_lon: float, radius_m: float) -> bool:
    return haversine(lat, lon, centre_lat, centre_lon) <= radius_m


def match_effort(track: list, start: tuple[float, float], end: tuple[float, float]):
    """Indexes (first, last) of an effort on a segment, or None.

    The effort starts at the first track point within 25 m of the segment start and ends at the first
    later track point within 25 m of the segment end. `track` holds objects with `lat` and `lon`.
    """
    first = next((i for i, p in enumerate(track) if within(p.lat, p.lon, *start, MATCH_RADIUS_M)), None)
    if first is None:
        return None
    last = next((j for j in range(first + 1, len(track)) if within(track[j].lat, track[j].lon, *end, MATCH_RADIUS_M)), None)
    return None if last is None else (first, last)


def inside_zone(lat: float, lon: float, zone: dict) -> bool:
    """True when a point lies within the privacy zone's radius of its centre."""
    return within(lat, lon, zone["lat"], zone["lon"], zone["radius_m"])


def search_box(lat_min: float, lat_max: float, lon_min: float, lon_max: float) -> tuple[float, float, float, float]:
    """A bounding box widened by the match radius, to preselect candidates in SQL before matching exactly."""
    lat_margin = math.degrees(MATCH_RADIUS_M * 2 / EARTH_RADIUS_M)
    widest = max(abs(lat_min), abs(lat_max))
    lon_margin = lat_margin / max(math.cos(math.radians(min(widest + 1.0, 89.0))), 0.01)
    return lat_min - lat_margin, lat_max + lat_margin, lon_min - lon_margin, lon_max + lon_margin

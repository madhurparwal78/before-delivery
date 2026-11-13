"""The one home of the great-circle distance used everywhere in Pacely."""
from math import asin, cos, radians, sin, sqrt

EARTH_RADIUS_M = 6371000.0


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = radians(lat1), radians(lat2)
    d_phi = (phi2 - phi1) / 2.0
    d_lambda = (radians(lon2) - radians(lon1)) / 2.0
    h = sin(d_phi) ** 2 + cos(phi1) * cos(phi2) * sin(d_lambda) ** 2
    return 2.0 * EARTH_RADIUS_M * asin(sqrt(h))

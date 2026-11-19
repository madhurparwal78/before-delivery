"""Mean new-moon times from the standard series with main periodic corrections."""
from __future__ import annotations

import math
from datetime import datetime, timezone


def _radians(deg: float) -> float:
    return math.radians(deg)


def mean_new_moon_utc(k: int) -> datetime:
    """The k-th mean new moon after 2000-01-06 18:14 UTC (Meeus chapter 49)."""
    t = k / 1236.85
    jd = 2451550.09766 + 29.530588861 * k + 0.00015437 * t * t - 0.000000150 * t ** 3 + 0.00000000073 * t ** 4
    # Main periodic corrections to the mean time.
    e = 1.0 - 0.002516 * t - 0.0000074 * t * t
    m = 2.5534 + 29.10535670 * k - 0.0000014 * t - 0.00000011 * t * t  # Sun mean anomaly
    mp = 201.5643 + 385.81693528 * k + 0.0107582 * t + 0.00001238 * t * t  # Moon mean anomaly
    f = 160.7108 + 390.67050284 * k - 0.0016118 * t - 0.00000227 * t * t  # Moon argument of latitude
    om = 124.7746 - 1.56375588 * k + 0.000000001 * t  # ascending node
    corr = (
        -0.40720 * math.sin(_radians(mp))
        + 0.17241 * e * math.sin(_radians(m))
        + 0.01608 * math.sin(_radians(2 * mp))
        + 0.01039 * math.sin(_radians(2 * f))
        + 0.00739 * math.sin(_radians(mp - m))
        - 0.00514 * e * math.sin(_radians(mp + m))
        + 0.00208 * e * math.sin(_radians(2 * m))
        - 0.00111 * math.sin(_radians(mp - 2 * f))
        - 0.00057 * math.sin(_radians(mp + 2 * f))
        + 0.00056 * e * math.sin(_radians(2 * mp + m))
        - 0.00042 * math.sin(_radians(3 * mp))
        + 0.00042 * e * math.sin(_radians(m + 2 * f))
        + 0.00038 * e * math.sin(_radians(m - 2 * f))
        - 0.00024 * e * math.sin(_radians(2 * mp - m))
        - 0.00017 * math.sin(_radians(om))
        - 0.00007 * math.sin(_radians(mp + 2 * m))
        + 0.00004 * math.sin(_radians(2 * mp - 2 * f))
        + 0.00004 * math.sin(_radians(3 * m))
        + 0.00003 * math.sin(_radians(mp + m - 2 * f))
        + 0.00003 * math.sin(_radians(2 * mp + 2 * f))
        - 0.00003 * math.sin(_radians(mp + m + 2 * f))
        + 0.00003 * math.sin(_radians(mp - m + 2 * f))
        - 0.00002 * math.sin(_radians(mp - m - 2 * f))
        - 0.00002 * math.sin(_radians(3 * mp + m))
        + 0.00002 * math.sin(_radians(4 * mp))
    )
    jd_true = jd + corr
    # Additional additive corrections for the new-moon case.
    a1 = 299.77 + 0.55 * k
    a2 = 251.88 + 0.016321 * k
    a3 = 251.83 + 0.000165 * k
    extra = (
        0.000325 * math.sin(_radians(a1))
        + 0.000165 * math.sin(_radians(a2))
        + 0.000164 * math.sin(_radians(a3))
        + 0.000126 * math.sin(_radians(a1 - a2))
        - 0.000110 * math.sin(_radians(a3 + a1))
        - 0.000066 * math.sin(_radians(a3 - a2))
    )
    jd_final = jd_true + extra
    return jd_to_utc(jd_final)


def jd_to_utc(jd: float) -> datetime:
    from datetime import timedelta

    unix = (jd - 2440587.5) * 86400.0
    return datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=unix)


def new_moons_between(start_utc: datetime, count: int) -> list[datetime]:
    """The first `count` new moons at or after start_utc."""
    target_jd = start_utc.timestamp() / 86400.0 + 2440587.5
    k_est = int((target_jd - 2451550.09766) / 29.530588861) - 1
    out: list[datetime] = []
    k = k_est
    while len(out) < count + 2 and k <= k_est + 30:
        nm = mean_new_moon_utc(k)
        if nm >= start_utc:
            out.append(nm)
        k += 1
    return out[:count]

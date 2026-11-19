"""The grid-factor feed, read once per allocation for hours with no stored factor."""

from __future__ import annotations

from datetime import datetime, timedelta

from .. import clock
from ..config import CONFIG
from ..domain.residual import factor_e4
from . import http


def factors(
    zone: str, from_hour: datetime, to_instant: datetime, wanted: set[datetime]
) -> dict[datetime, int]:
    """Scaled grams per kWh for each wanted hour the feed covers."""
    url = (
        f"{CONFIG.wiremock_url}/grid/v1/factors"
        f"?zone={zone}&from={clock.hour(from_hour)}&to={clock.instant(to_instant)}"
    )
    body = http.get_json(url)
    runs = body.get("runs")
    if not isinstance(runs, list):
        raise http.ProviderUnavailable("factors body")
    found: dict[datetime, int] = {}
    for run in runs:
        start = clock.parse_instant(run["start"])
        end = start + timedelta(hours=int(run["count"]))
        scaled = factor_e4(run["g_per_kwh"])
        for hour_utc in wanted:
            if start <= hour_utc < end:
                found[hour_utc] = scaled
    return found

"""The meter data hub: interval readings and late corrections."""

from __future__ import annotations

from typing import Any

from ..config import CONFIG
from . import http


def readings(meter_id: str, from_hour: str, to_instant: str) -> list[dict[str, Any]]:
    url = (
        f"{CONFIG.wiremock_url}/hub/v1/readings"
        f"?meter={meter_id}&from={from_hour}&to={to_instant}"
    )
    body = http.get_json(url)
    runs = body.get("runs")
    if not isinstance(runs, list):
        raise http.ProviderUnavailable("readings body")
    return runs


def corrections(meter_id: str, since_instant: str) -> list[dict[str, Any]]:
    url = (
        f"{CONFIG.wiremock_url}/hub/v1/corrections"
        f"?meter={meter_id}&since={since_instant}"
    )
    body = http.get_json(url)
    rows = body.get("corrections")
    if not isinstance(rows, list):
        raise http.ProviderUnavailable("corrections body")
    return rows

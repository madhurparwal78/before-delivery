"""Site field validation, shared by workspace creation and the site route."""

from __future__ import annotations

import re
from typing import Any

from .domain import timeutil
from .validate import Fields

PUSH_TOPIC = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MIN_ALTITUDE_MAX_DEG = 60


def read_site(
    body: dict[str, Any], *, prefix: str = "", required: bool
) -> dict[str, Any]:
    """Validates the site fields present in a body and returns them."""
    fields = Fields(body, prefix=prefix)
    wanted: dict[str, Any] = {}
    for name, reader in (
        ("label", lambda: fields.text("label", 1, 60)),
        ("latitude", lambda: fields.decimal("latitude", -90.0, 90.0)),
        ("longitude", lambda: fields.decimal("longitude", -180.0, 180.0)),
        ("elevation_m", lambda: fields.decimal("elevation_m", -500.0, 9000.0)),
    ):
        if required or name in body:
            wanted[name] = reader()
    if required or "time_zone" in body:
        zone = fields.text("time_zone", 1, 64)
        if isinstance(zone, str) and not timeutil.is_known_zone(zone):
            fields.fail("time_zone", "Use an IANA time zone name.")
        else:
            wanted["time_zone"] = zone
    if "min_altitude_deg" in body:
        wanted["min_altitude_deg"] = fields.whole(
            "min_altitude_deg", 0, MIN_ALTITUDE_MAX_DEG
        )
    if "push_topic" in body:
        topic = body["push_topic"]
        if topic is None:
            wanted["push_topic"] = None
        elif isinstance(topic, str) and PUSH_TOPIC.match(topic):
            wanted["push_topic"] = topic
        else:
            fields.fail(
                "push_topic", "Use 1 to 64 letters, digits, underscores or dashes."
            )
    fields.done()
    return wanted

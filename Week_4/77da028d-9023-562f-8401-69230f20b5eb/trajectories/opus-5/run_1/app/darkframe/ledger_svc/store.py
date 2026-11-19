"""The ledger's database handle and the site facts it reads from the sky engine."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, datetime

from ..config import CONFIG, LEDGER, SKY_ENGINE
from ..db import Database
from ..domain import timeutil
from ..errors import service_unavailable
from ..service import call_service
from ..httpclient import HttpError
from .schema import SCHEMA_SQL

DATABASE = Database(LEDGER, SCHEMA_SQL)


@dataclass(frozen=True)
class SiteFacts:
    label: str
    latitude: float
    longitude: float
    time_zone: str

    def observing_date_of(self, instant: datetime) -> date:
        return timeutil.observing_date_of(instant, self.time_zone)

    def today(self) -> date:
        return timeutil.to_local(timeutil.now_utc(), self.time_zone).date()


async def site_facts(imager_id: str, request_id: str) -> SiteFacts:
    try:
        response = await call_service(
            CONFIG.base_url(SKY_ENGINE),
            "GET",
            "/internal/site",
            imager_id=imager_id,
            request_id=request_id,
        )
    except HttpError:
        raise service_unavailable(SKY_ENGINE)
    if response.status != 200:
        raise service_unavailable(SKY_ENGINE)
    body = json.loads(response.body)
    return SiteFacts(
        label=body["label"],
        latitude=body["latitude"],
        longitude=body["longitude"],
        time_zone=body["time_zone"],
    )

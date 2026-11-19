"""Assembling a plan from the site, the horizon mask, the plan's targets, its conditions and the ledger's projects,
and re-evaluating plans so a changed verdict is queued once."""
import asyncio
import logging
from datetime import UTC, date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from darkframe.common.config import Settings
from darkframe.common.database import Database
from darkframe.common.http import InternalClient
from darkframe.rules.errors import ApiFault, validation
from darkframe.rules.observing import observing_date
from darkframe.rules.push_text import verdict_message, verdict_title
from darkframe.sky_engine import store
from darkframe.sky_engine.evaluation import SiteSettings, build_plan, current_minute
from darkframe.sky_engine.night import Night, compute_night

log = logging.getLogger("darkframe.sky_engine")


def site_body(site: SiteSettings) -> dict[str, Any]:
    def plain(value: float) -> float | int:
        return int(value) if float(value).is_integer() else value

    return {"label": site.label, "latitude": site.latitude, "longitude": site.longitude,
            "elevation_m": plain(site.elevation_m), "time_zone": site.time_zone,
            "min_altitude_deg": site.min_altitude_deg, "push_topic": site.push_topic}


class Planner:
    def __init__(self, settings: Settings, database: Database, client: InternalClient) -> None:
        self.settings = settings
        self.database = database
        self.client = client
        self._locks: dict[str, asyncio.Lock] = {}
        self._background: set[asyncio.Task[None]] = set()

    async def site(self, imager: str) -> SiteSettings:
        async with self.database.connection() as connection:
            return await store.fetch_site(connection, imager)

    async def night(self, imager: str, observing: date) -> Night:
        site = await self.site(imager)
        return compute_night(site.position, site.time_zone, observing)

    async def tonight_date(self, imager: str, now: datetime) -> date:
        site = await self.site(imager)
        return observing_date(now, ZoneInfo(site.time_zone))

    async def fetch_projects(self, imager: str, project_ids: list[str]) -> list[dict[str, Any]]:
        return list(await asyncio.gather(*(self.client.json("ledger", "GET", f"/api/projects/{project_id}", imager=imager)
                                           for project_id in project_ids)))

    async def plan(self, imager: str, observing: date, minute: int | None = None, *, follow_clock: bool = False) -> dict[str, Any]:
        """The plan body. `minute` None means 0; `follow_clock` means the server's current minute (GET /api/tonight)."""
        now = datetime.now(UTC).replace(microsecond=0)
        async with self.database.connection() as connection:
            site = await store.fetch_site(connection, imager)
            mask = await store.fetch_horizon_mask(connection, imager)
            project_ids = await store.fetch_plan_project_ids(connection, imager, observing)
            entries, entered_at = await store.fetch_conditions(connection, imager, observing)
        night = compute_night(site.position, site.time_zone, observing)
        is_tonight = observing_date(now, ZoneInfo(site.time_zone)) == observing
        if follow_clock:
            minute = current_minute(night, now)
        minute = 0 if minute is None else minute
        if not 0 <= minute <= night.minutes:
            raise validation({"minute": f"Minute must be a whole number from 0 to {night.minutes}."})
        projects = await self.fetch_projects(imager, project_ids)
        return await asyncio.to_thread(
            build_plan, night=night, minute=minute, now=now, site=site, horizon_mask=mask, projects=projects,
            entries=entries, entered_at=entered_at, stale_seconds=self.settings.conditions_stale_seconds,
            is_tonight=is_tonight)

    def _lock(self, imager: str) -> asyncio.Lock:
        return self._locks.setdefault(imager, asyncio.Lock())

    def reevaluate_soon(self, imager: str, dates: list[date] | None = None) -> None:
        task = asyncio.create_task(self.reevaluate(imager, dates))
        self._background.add(task)
        task.add_done_callback(self._background.discard)

    async def reevaluate(self, imager: str, dates: list[date] | None = None) -> None:
        """Re-evaluate the imager's planned nights; queue one push when a night's verdict becomes go or no-go."""
        async with self._lock(imager):
            try:
                site = await self.site(imager)
                if dates is None:
                    first = observing_date(datetime.now(UTC), ZoneInfo(site.time_zone))
                    async with self.database.connection() as connection:
                        dates = await store.planned_dates(connection, imager, first)
                for observing in dates:
                    await self._evaluate_night(imager, observing, site)
            except (ApiFault, OSError):
                log.exception("re-evaluation for %s skipped", imager)

    async def _evaluate_night(self, imager: str, observing: date, site: SiteSettings) -> None:
        plan = await self.plan(imager, observing)
        verdict = plan["verdict"]
        async with self.database.transaction() as connection:
            previous = await store.record_verdict(connection, imager, observing, verdict)
            if verdict in ("go", "no-go") and previous != verdict and site.push_topic:
                await store.queue_verdict_push(
                    connection, imager, observing, site.push_topic, verdict_title(verdict, observing),
                    verdict_message(verdict, site.label, site.latitude, site.longitude, plan["best"], plan["clear_window"]))


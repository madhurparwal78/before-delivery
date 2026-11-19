"""The sky engine's HTTP surface: site, horizon mask, nights, plans, conditions, and its few internal routes."""
import re
from datetime import UTC, date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from aiohttp import web

from darkframe.common.http import imager_id, json_response, read_json_object
from darkframe.common.validate import (
    Fields,
    parse_date,
    parse_offset_datetime,
    require_object,
)
from darkframe.rules.errors import conflict, not_found, validation
from darkframe.sky_engine import new_moons, store
from darkframe.sky_engine.evaluation import ConditionEntry, night_body
from darkframe.sky_engine.night import condition_hours
from darkframe.sky_engine.planning import Planner, site_body

PLAN_CAPACITY = 8
PUSH_TOPIC_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MINUTE_PATTERN = re.compile(r"^\d+$")
MASK_BINS = 72


def site_fields(body: dict[str, Any], *, partial: bool, prefix: str = "") -> dict[str, Any]:
    fields = Fields(body, prefix)
    changes: dict[str, Any] = {}
    readers = {
        "label": lambda: fields.text("label", 1, 60, "Site label"),
        "latitude": lambda: fields.number("latitude", -90, 90, "Latitude"),
        "longitude": lambda: fields.number("longitude", -180, 180, "Longitude"),
        "elevation_m": lambda: fields.number("elevation_m", -500, 9000, "Elevation"),
        "time_zone": lambda: fields.zone("time_zone", "Time zone"),
        "min_altitude_deg": lambda: fields.whole("min_altitude_deg", 0, 60, "Minimum altitude"),
    }
    for name, read in readers.items():
        if name in body or not partial:
            if name == "min_altitude_deg" and name not in body:
                continue
            changes[name] = read()
    if "push_topic" in body:
        topic = body["push_topic"]
        if topic is not None and not (isinstance(topic, str) and PUSH_TOPIC_PATTERN.fullmatch(topic)):
            fields.fail("push_topic", "Push topic must be 1 to 64 letters, digits, underscores or hyphens.")
        changes["push_topic"] = topic
    fields.raise_errors()
    return changes


class Routes:
    def __init__(self, planner: Planner) -> None:
        self.planner = planner

    def add_to(self, app: web.Application) -> None:
        app.add_routes([
            web.post("/internal/imagers", self.create_imager),
            web.post("/internal/changed", self.changed),
            web.get("/internal/new-moons", self.list_new_moons),
            web.get("/api/site", self.get_site),
            web.patch("/api/site", self.patch_site),
            web.get("/api/site/horizon", self.get_horizon),
            web.put("/api/site/horizon", self.put_horizon),
            web.get("/api/sky/night", self.get_night),
            web.get("/api/tonight", self.get_tonight),
            web.get("/api/plans/{date}", self.get_plan),
            web.post("/api/plans/{date}/targets", self.add_target),
            web.delete("/api/plans/{date}/targets/{project_id}", self.remove_target),
            web.put("/api/plans/{date}/conditions", self.put_conditions),
        ])

    async def create_imager(self, request: web.Request) -> web.Response:
        body = await read_json_object(request)
        site = site_fields(require_object(body.get("site"), "site"), partial=False, prefix="site.")
        async with self.planner.database.transaction() as connection:
            await store.insert_site(connection, body["imager_id"], site)
        return json_response({}, 201)

    async def changed(self, request: web.Request) -> web.Response:
        self.planner.reevaluate_soon(imager_id(request))
        return json_response({}, 202)

    async def list_new_moons(self, request: web.Request) -> web.Response:
        site = await self.planner.site(imager_id(request))
        found = new_moons.occurrences(ZoneInfo(site.time_zone), request.query["local_time"],
                                      date.fromisoformat(request.query["from"]), int(request.query["count"]))
        return json_response({"occurrences": found})

    async def get_site(self, request: web.Request) -> web.Response:
        return json_response(site_body(await self.planner.site(imager_id(request))))

    async def patch_site(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        changes = site_fields(await read_json_object(request), partial=True)
        async with self.planner.database.transaction() as connection:
            if changes:
                await store.update_site(connection, imager, changes)
        await self.planner.reevaluate(imager)
        return json_response(site_body(await self.planner.site(imager)))

    async def get_horizon(self, request: web.Request) -> web.Response:
        async with self.planner.database.connection() as connection:
            return json_response({"altitudes": await store.fetch_horizon_mask(connection, imager_id(request))})

    async def put_horizon(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        altitudes = (await read_json_object(request)).get("altitudes")
        message = f"Altitudes must be exactly {MASK_BINS} whole numbers from 0 to 90."
        if not isinstance(altitudes, list) or len(altitudes) != MASK_BINS:
            raise validation({"altitudes": message})
        for value in altitudes:
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not float(value).is_integer() \
                    or not 0 <= value <= 90:
                raise validation({"altitudes": message})
        altitudes = [int(value) for value in altitudes]
        async with self.planner.database.transaction() as connection:
            await store.save_horizon_mask(connection, imager, altitudes)
        await self.planner.reevaluate(imager)
        return json_response({"altitudes": altitudes})

    async def get_night(self, request: web.Request) -> web.Response:
        observing = parse_date(request.query.get("date", ""))
        return json_response(night_body(await self.planner.night(imager_id(request), observing)))

    async def get_tonight(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        observing = await self.planner.tonight_date(imager, datetime.now(UTC))
        return json_response(await self.planner.plan(imager, observing, follow_clock=True))

    async def get_plan(self, request: web.Request) -> web.Response:
        observing = parse_date(request.match_info["date"])
        text = request.query.get("minute", "0")
        if not MINUTE_PATTERN.fullmatch(text):
            raise validation({"minute": "Minute must be a whole number inside the night."})
        return json_response(await self.planner.plan(imager_id(request), observing, int(text)))

    async def add_target(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        project_id = (await read_json_object(request)).get("project_id")
        if not isinstance(project_id, str) or not project_id:
            raise validation({"project_id": "Choose a project."})
        project = (await self.planner.fetch_projects(imager, [project_id]))[0]
        if project["state"] != "active":
            raise conflict("project_not_active", "Only active projects can be planned.")
        observing = parse_date(request.match_info["date"])
        async with self.planner.database.transaction() as connection:
            await store.lock_plan(connection, imager, observing)
            planned = await store.fetch_plan_project_ids(connection, imager, observing)
            if project_id in planned:
                raise conflict("already_planned", "That project is already in this plan.")
            if len(planned) >= PLAN_CAPACITY:
                raise conflict("plan_full", f"A plan holds at most {PLAN_CAPACITY} targets.")
            await store.add_plan_target(connection, imager, observing, project_id)
        await self.planner.reevaluate(imager, [observing])
        return json_response(await self.planner.plan(imager, observing), 201)

    async def remove_target(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        observing = parse_date(request.match_info["date"])
        async with self.planner.database.transaction() as connection:
            removed = await store.remove_plan_target(connection, imager, observing, request.match_info["project_id"])
        if not removed:
            raise not_found()
        await self.planner.reevaluate(imager, [observing])
        return json_response(await self.planner.plan(imager, observing))

    async def put_conditions(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        observing = parse_date(request.match_info["date"])
        hours = (await read_json_object(request)).get("hours")
        if not isinstance(hours, list):
            raise validation({"hours": "Hours must be a list of hourly conditions."})
        night = await self.planner.night(imager, observing)
        allowed = set(condition_hours(night))
        entries: list[ConditionEntry] = []
        errors: dict[str, str] = {}
        seen: set[datetime] = set()
        for index, entry in enumerate(hours):
            fields = Fields(entry if isinstance(entry, dict) else {}, prefix=f"hours[{index}].")
            start = parse_offset_datetime(entry["hour_start"]) if isinstance(entry, dict) and isinstance(
                entry.get("hour_start"), str) else None
            if start is None or start.astimezone(UTC) not in allowed or start.astimezone(UTC) in seen:
                fields.fail("hour_start", "Hour start must be one of the hours of this night.")
            cloud = fields.whole("cloud_pct", 0, 100, "Cloud")
            transparency = fields.whole("transparency", 1, 5, "Transparency")
            seeing = fields.whole("seeing", 1, 5, "Seeing")
            errors.update(fields.errors)
            if not fields.errors:
                seen.add(start.astimezone(UTC))
                entries.append(ConditionEntry(start.astimezone(UTC), cloud, transparency, seeing))
        if errors:
            raise validation(errors)
        entries.sort(key=lambda e: e.hour_start)
        async with self.planner.database.transaction() as connection:
            await store.replace_conditions(connection, imager, observing, entries, datetime.now(UTC).replace(microsecond=0))
        await self.planner.reevaluate(imager, [observing])
        return json_response(await self.planner.plan(imager, observing))

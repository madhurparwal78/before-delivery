"""The push log and the new-moon weekend reminder."""
import re
from datetime import UTC, datetime, timedelta
from typing import Any

from aiohttp import web

from darkframe.common.database import Database
from darkframe.common.http import (
    InternalClient,
    imager_id,
    json_response,
    read_json_object,
)
from darkframe.common.validate import TIME_PATTERN, parse_date
from darkframe.push_dispatcher import store
from darkframe.rules.errors import ApiFault, validation

UPCOMING = 3
UPCOMING_LOOKBACK_DAYS = 10
COUNT_PATTERN = re.compile(r"^\d{1,3}$")
MAX_OCCURRENCES = 12


class Routes:
    def __init__(self, database: Database, client: InternalClient) -> None:
        self.database = database
        self.client = client

    def add_to(self, app: web.Application) -> None:
        app.add_routes([
            web.get("/api/pushes", self.pushes),
            web.get("/api/reminders/new-moon", self.get_reminder),
            web.put("/api/reminders/new-moon", self.put_reminder),
            web.get("/api/reminders/new-moon/occurrences", self.occurrences),
        ])

    async def pushes(self, request: web.Request) -> web.Response:
        async with self.database.connection() as connection:
            return json_response({"pushes": [store.push_body(row) for row in await store.list_pushes(connection, imager_id(request))]})

    async def reminder_body(self, imager: str) -> dict[str, Any]:
        async with self.database.connection() as connection:
            row = await store.fetch_reminder(connection, imager)
        enabled, local_time = (row["enabled"], row["local_time"]) if row else (False, store.DEFAULT_REMINDER_TIME)
        now = datetime.now(UTC)
        start = (now - timedelta(days=UPCOMING_LOOKBACK_DAYS)).date().isoformat()
        found = await self.client.json("sky-engine", "GET", "/internal/new-moons", imager=imager,
                                       query=f"?local_time={local_time}&from={start}&count=6")
        upcoming = [item for item in found["occurrences"]
                    if datetime.fromisoformat(item["remind_utc"].replace("Z", "+00:00")) > now]
        return {"enabled": enabled, "local_time": local_time, "upcoming": upcoming[:UPCOMING]}

    async def get_reminder(self, request: web.Request) -> web.Response:
        return json_response(await self.reminder_body(imager_id(request)))

    async def put_reminder(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        body = await read_json_object(request)
        errors = {}
        if not isinstance(body.get("enabled"), bool):
            errors["enabled"] = "Enabled must be true or false."
        if not isinstance(body.get("local_time"), str) or not TIME_PATTERN.fullmatch(body["local_time"]):
            errors["local_time"] = "Reminder time must be written HH:MM, 00:00 to 23:59."
        if errors:
            raise validation(errors)
        async with self.database.connection() as connection:
            await store.save_reminder(connection, imager, body["enabled"], body["local_time"])
        return json_response(await self.reminder_body(imager))

    async def occurrences(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        errors = {}
        try:
            start = parse_date(request.query.get("from", ""), "from")
        except ApiFault as fault:
            errors.update(fault.fields)
        count_text = request.query.get("count", "")
        if not COUNT_PATTERN.fullmatch(count_text) or not 1 <= int(count_text) <= MAX_OCCURRENCES:
            errors["count"] = f"Count must be a whole number from 1 to {MAX_OCCURRENCES}."
        if errors:
            raise validation(errors)
        async with self.database.connection() as connection:
            row = await store.fetch_reminder(connection, imager)
        local_time = row["local_time"] if row else store.DEFAULT_REMINDER_TIME
        return json_response(await self.client.json(
            "sky-engine", "GET", "/internal/new-moons", imager=imager,
            query=f"?local_time={local_time}&from={start.isoformat()}&count={count_text}"))

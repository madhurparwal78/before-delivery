"""Delivery to ntfy and the new-moon weekend reminder loop."""
import asyncio
import logging
from datetime import UTC, date, datetime, timedelta

import aiohttp
import asyncpg

from darkframe.common.config import Settings
from darkframe.common.database import Database
from darkframe.common.http import InternalClient
from darkframe.push_dispatcher import store
from darkframe.rules.errors import ApiFault
from darkframe.rules.push_text import REMINDER_TITLE, reminder_message

TICK_SECONDS = 1
REMINDER_SECONDS = 30
NTFY_TIMEOUT_SECONDS = 5
LOOKBACK_DAYS = 12
log = logging.getLogger("darkframe.push_dispatcher")


class Publisher:
    def __init__(self, settings: Settings, database: Database, client: InternalClient) -> None:
        self.settings = settings
        self.database = database
        self.client = client
        self._session: aiohttp.ClientSession | None = None

    def session(self) -> aiohttp.ClientSession:
        if self._session is None:
            self._session = aiohttp.ClientSession(
                auth=aiohttp.BasicAuth(self.settings.ntfy_username, self.settings.ntfy_password),
                timeout=aiohttp.ClientTimeout(total=NTFY_TIMEOUT_SECONDS))
        return self._session

    async def close(self) -> None:
        if self._session is not None:
            await self._session.close()

    async def run(self) -> None:
        last_reminders = 0.0
        while True:
            try:
                async with self.database.connection() as connection:
                    await store.take_outbox(connection)
                if asyncio.get_running_loop().time() - last_reminders >= REMINDER_SECONDS:
                    last_reminders = asyncio.get_running_loop().time()
                    await self.queue_due_reminders()
                await self.deliver_due()
            except ApiFault:
                log.warning("database not answering; retrying")
            except asyncpg.UndefinedTableError:
                log.warning("waiting for the sky engine to create its tables")
            except asyncpg.PostgresError:
                log.exception("dispatch tick failed; retrying")
            await asyncio.sleep(TICK_SECONDS)

    async def deliver_due(self) -> None:
        async with self.database.connection() as connection:
            pushes = await store.due_pushes(connection)
        for push in pushes:
            delivered = await self.publish(push["topic"], push["title"], push["message"])
            async with self.database.connection() as connection:
                await store.record_attempt(connection, push["id"], delivered, self.settings.push_retry_seconds)

    async def publish(self, topic: str, title: str, message: str) -> bool:
        try:
            async with self.session().post(f"{self.settings.ntfy_url}/", json={
                    "topic": topic, "title": title, "message": message, "tags": ["telescope"]}) as response:
                return 200 <= response.status < 300
        except (aiohttp.ClientError, TimeoutError):
            return False

    async def queue_due_reminders(self) -> None:
        now = datetime.now(UTC)
        async with self.database.connection() as connection:
            reminders = await store.enabled_reminders(connection)
        for reminder in reminders:
            imager = reminder["imager_id"]
            try:
                site = await self.client.json("sky-engine", "GET", "/api/site", imager=imager)
                found = await self.client.json(
                    "sky-engine", "GET", "/internal/new-moons", imager=imager,
                    query=f"?local_time={reminder['local_time']}&from={(now.date() - timedelta(days=LOOKBACK_DAYS)).isoformat()}&count=3")
            except ApiFault:
                continue
            if not site["push_topic"]:
                continue
            for occurrence in found["occurrences"]:
                remind = datetime.fromisoformat(occurrence["remind_utc"].replace("Z", "+00:00"))
                if reminder["enabled_at"] < remind <= now:
                    async with self.database.connection() as connection:
                        await store.queue_reminder(
                            connection, imager, remind, date.fromisoformat(occurrence["remind_local"][:10]), REMINDER_TITLE,
                            reminder_message(occurrence["new_moon_local_date"], occurrence["weekend_saturday"], site["label"]),
                            site["push_topic"])

"""GET /api/health: every service and dependency with a one-second answer budget."""
import asyncio

import aiohttp
from aiohttp import web

from darkframe.common.config import Settings
from darkframe.common.database import Database
from darkframe.common.http import VERSION, InternalClient, json_response
from darkframe.common.s3 import ObjectStore

PROBE_SECONDS = 1


class Health:
    def __init__(self, settings: Settings, database: Database, objects: ObjectStore, client: InternalClient) -> None:
        self.settings = settings
        self.database = database
        self.objects = objects
        self.client = client

    async def service(self, name: str) -> dict[str, str | None]:
        try:
            async with self.client.session().get(f"{self.settings.service_url(name)}/internal/health",
                                                 timeout=aiohttp.ClientTimeout(total=PROBE_SECONDS)) as response:
                payload = await response.json()
                return {"status": "ok", "version": payload["version"]}
        except (aiohttp.ClientError, TimeoutError):
            return {"status": "down", "version": None}

    async def postgres(self) -> bool:
        try:
            return await asyncio.wait_for(self.database.ping(), PROBE_SECONDS)
        except TimeoutError:
            return False

    async def ntfy(self) -> bool:
        try:
            async with self.client.session().get(f"{self.settings.ntfy_url}/v1/health",
                                                 timeout=aiohttp.ClientTimeout(total=PROBE_SECONDS)) as response:
                return response.status == 200
        except (aiohttp.ClientError, TimeoutError):
            return False

    async def handle(self, _: web.Request) -> web.Response:
        sky, ledger, dispatcher, postgres, minio, ntfy = await asyncio.gather(
            self.service("sky-engine"), self.service("ledger"), self.service("push-dispatcher"),
            self.postgres(), self.objects.ping(), self.ntfy())
        word = {True: "ok", False: "down"}
        body = {"status": "ok", "version": VERSION,
                "services": {"gateway": {"status": "ok", "version": VERSION}, "sky-engine": sky, "ledger": ledger,
                             "push-dispatcher": dispatcher},
                "dependencies": {"postgres": word[postgres], "minio": word[minio], "ntfy": word[ntfy]}}
        if not (sky["status"] == "ok" and ledger["status"] == "ok" and postgres):
            body["status"] = "unavailable"
            return json_response(body, 503)
        return json_response(body)

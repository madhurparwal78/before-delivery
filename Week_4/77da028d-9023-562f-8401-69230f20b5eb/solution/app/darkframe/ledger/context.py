"""What every ledger module shares: the database, the object store, calls to the sky engine."""
import time
from typing import Any
from zoneinfo import ZoneInfo

from darkframe.common.config import Settings
from darkframe.common.database import Database
from darkframe.common.http import InternalClient
from darkframe.common.s3 import ObjectStore
from darkframe.rules.errors import ApiFault

SITE_CACHE_SECONDS = 3


class Context:
    def __init__(self, settings: Settings, database: Database, objects: ObjectStore, client: InternalClient) -> None:
        self.settings = settings
        self.database = database
        self.objects = objects
        self.client = client
        self._sites: dict[str, tuple[float, dict[str, Any]]] = {}

    async def site(self, imager: str) -> dict[str, Any]:
        cached = self._sites.get(imager)
        if cached is None or time.monotonic() - cached[0] > SITE_CACHE_SECONDS:
            cached = (time.monotonic(), await self.client.json("sky-engine", "GET", "/api/site", imager=imager))
            self._sites[imager] = cached
        return cached[1]

    async def zone(self, imager: str) -> ZoneInfo:
        return ZoneInfo((await self.site(imager))["time_zone"])

    async def changed(self, imager: str) -> None:
        """Tell the sky engine a verdict may have moved. It re-evaluates on its own; a refusal here is not the caller's."""
        try:
            await self.client.json("sky-engine", "POST", "/internal/changed", imager=imager)
        except ApiFault:
            return

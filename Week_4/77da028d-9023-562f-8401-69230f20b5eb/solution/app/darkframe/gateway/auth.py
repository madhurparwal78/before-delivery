"""Workspace keys: bearer token or the unlock cookie. A share token is never a key."""
from dataclasses import dataclass

from aiohttp import web

from darkframe.common.database import Database
from darkframe.gateway import store
from darkframe.rules.errors import PRECEDENCE_MESSAGES, ApiFault

COOKIE = "darkframe_key"
COOKIE_MAX_AGE_SECONDS = 30 * 24 * 3600
BEARER = "Bearer "


@dataclass(frozen=True)
class Imager:
    imager_id: str
    name: str


class Keys:
    def __init__(self, database: Database) -> None:
        self._database = database
        self._known: dict[str, Imager] = {}

    async def lookup(self, key: str) -> Imager | None:
        """The imager a workspace key belongs to. Only successful lookups are remembered; a key never changes."""
        if key in self._known:
            return self._known[key]
        async with self._database.connection() as connection:
            row = await store.find_workspace(connection, key)
        if row is None:
            return None
        self._known[key] = Imager(row["imager_id"], row["name"])
        return self._known[key]

    async def authenticate(self, request: web.Request) -> Imager | None:
        header = request.headers.get("Authorization", "")
        key = header[len(BEARER):] if header.startswith(BEARER) else request.cookies.get(COOKIE, "")
        return await self.lookup(key) if key else None

    async def require(self, request: web.Request) -> Imager:
        imager = await self.authenticate(request)
        if imager is None:
            raise ApiFault(401, "unauthenticated", PRECEDENCE_MESSAGES["unauthenticated"])
        return imager

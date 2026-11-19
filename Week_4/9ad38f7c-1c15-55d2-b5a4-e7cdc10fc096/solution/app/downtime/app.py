"""The one-origin ASGI application: pages, static files, media and /api."""

import asyncio
import mimetypes
from contextlib import suppress
from importlib import resources
from pathlib import Path

from starlette.requests import Request
from starlette.responses import FileResponse, PlainTextResponse
from starlette.staticfiles import StaticFiles
from starlette.types import Receive, Scope, Send

from . import api, pages
from .db import DB
from .live import LIVE

for extension, kind in ((".woff2", "font/woff2"), (".webm", "video/webm"), (".ogg", "audio/ogg"),
                        (".svg", "image/svg+xml"), (".js", "text/javascript"), (".vtt", "text/vtt")):
    mimetypes.add_type(kind, extension)

PACKAGE = Path(str(resources.files(__package__)))
CAPTIONS = PACKAGE / "media" / "briefing.vtt"
SECURITY_HEADERS = [(b"x-content-type-options", b"nosniff"), (b"referrer-policy", b"same-origin"),
                    (b"x-frame-options", b"DENY")]


class Downtime:
    def __init__(self) -> None:
        self.static = StaticFiles(directory=PACKAGE / "static")
        self.assets = StaticFiles(directory=PACKAGE.parent / "assets")
        self.tasks: list[asyncio.Task] = []

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "lifespan":
            await self._lifespan(receive, send)
            return
        if scope["type"] != "http":
            return
        path = scope["path"]

        async def secured(message: dict) -> None:
            if message["type"] == "http.response.start":
                message["headers"] = [*message.get("headers", []), *SECURITY_HEADERS]
            await send(message)

        if path == "/api" or path.startswith("/api/"):
            response = await api.dispatch(Request(scope, receive))
            await response(scope, receive, secured)
        elif path.startswith(("/static/", "/assets/")):
            mount = path.split("/", 2)[1]
            await getattr(self, mount)({**scope, "root_path": f"/{mount}"}, receive, secured)
        elif scope["method"] not in ("GET", "HEAD"):
            await PlainTextResponse("Method not allowed", status_code=405, headers={"Allow": "GET, HEAD"})(
                scope, receive, secured)
        elif path == "/media/briefing.vtt":
            await FileResponse(CAPTIONS, media_type="text/vtt; charset=utf-8")(scope, receive, secured)
        else:
            await (await pages.page(Request(scope, receive)))(scope, receive, secured)

    async def _lifespan(self, receive: Receive, send: Send) -> None:
        while True:
            message = await receive()
            if message["type"] == "lifespan.startup":
                self.tasks = [asyncio.create_task(DB.bootstrap()), asyncio.create_task(LIVE.run())]
                await send({"type": "lifespan.startup.complete"})
            elif message["type"] == "lifespan.shutdown":
                for task in self.tasks:
                    task.cancel()
                    with suppress(asyncio.CancelledError):
                        await task
                await DB.close()
                await send({"type": "lifespan.shutdown.complete"})
                return


app = Downtime()

"""Frame uploads: stored in object storage, confirmed by reading it back, and only then counted."""
import hashlib
import re

from aiohttp import web

from darkframe.common.http import imager_id, json_response
from darkframe.common.ids import new_id
from darkframe.common.s3 import StorageUnavailable
from darkframe.ledger.context import Context
from darkframe.ledger.sessions import fetch_batch, fetch_session, frame_body
from darkframe.rules.errors import ApiFault, conflict, not_found, validation
from darkframe.rules.states import SESSION_FRAME_STATES

FILE_NAME = re.compile(r"^[A-Za-z0-9._-]{1,120}$")
STORAGE_DOWN = "Frame storage is unreachable. The frame was not counted."


class FrameRoutes:
    def __init__(self, context: Context) -> None:
        self.context = context

    def add_to(self, app: web.Application) -> None:
        app.add_routes([
            web.put("/api/batches/{id}/frames/{name}", self.upload),
            web.get("/api/frames/{id}/content", self.download),
        ])

    async def upload(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        name = request.match_info["name"]
        content_type = request.headers.get("Content-Type", "").split(";")[0].strip().lower()
        upload_bytes = await request.read()
        async with self.context.database.connection() as connection:
            batch = await fetch_batch(connection, imager, request.match_info["id"])
            session = await fetch_session(connection, imager, batch["session_id"])
            if session["state"] not in SESSION_FRAME_STATES:
                raise conflict("wrong_state", "Frames can only be added to an imaging or logged session.")
            if await connection.fetchval("SELECT 1 FROM ledger.frames WHERE batch_id = $1 AND name = $2", batch["id"], name):
                raise conflict("frame_exists", "A frame with that name is already in this batch.")
            if not FILE_NAME.fullmatch(name) or not upload_bytes:
                raise validation({"name" if not FILE_NAME.fullmatch(name) else "body":
                                  "Frame names use letters, digits, dots, underscores and hyphens, and frames are not empty."})
            frame = new_id()
            key = f"frames/{imager}/{session['id']}/{batch['id']}/{frame}/{name}"
            try:
                await self.context.objects.put(key, upload_bytes, content_type)
            except StorageUnavailable as error:
                raise ApiFault(503, "storage_unavailable", STORAGE_DOWN) from error
            async with connection.transaction():
                await connection.execute(
                    "INSERT INTO ledger.frames (id, imager_id, session_id, batch_id, name, size_bytes, content_type, "
                    "sha256, object_key) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)", frame, imager, session["id"],
                    batch["id"], name, len(upload_bytes), content_type, hashlib.sha256(upload_bytes).hexdigest(), key)
            record = await connection.fetchrow("SELECT * FROM ledger.frames WHERE id = $1", frame)
            count = await connection.fetchval("SELECT count(*) FROM ledger.frames WHERE session_id = $1", session["id"])
        return json_response({"frame": frame_body(record), "session_frame_count": count}, 201)

    async def download(self, request: web.Request) -> web.Response:
        async with self.context.database.connection() as connection:
            record = await connection.fetchrow("SELECT * FROM ledger.frames WHERE id = $1 AND imager_id = $2",
                                               request.match_info["id"], imager_id(request))
        if record is None:
            raise not_found()
        try:
            upload_bytes, _ = await self.context.objects.get(record["object_key"])
        except StorageUnavailable as error:
            raise ApiFault(503, "storage_unavailable", "Frame storage is unreachable. The frame could not be read.") from error
        return web.Response(body=upload_bytes, content_type=record["content_type"])

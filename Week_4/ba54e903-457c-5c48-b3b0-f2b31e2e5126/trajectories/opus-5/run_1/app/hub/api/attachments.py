"""Uploads: stored in the database exactly as received."""

from __future__ import annotations

import hashlib

from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException
from starlette.responses import Response

from ..app import Ctx
from ..db import DB
from ..errors import ApiError, invalid
from ..media import clean_filename, inspect
from ..serialize import attachment_json
from ..users import upload_limit_for
from .common import json_response

READ_CHUNK = 1_048_576


async def upload(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    try:
        form = await ctx.request.form()
    except MultiPartException:
        raise invalid("file") from None
    part = form.get("file")
    if not isinstance(part, UploadFile) or not part.filename:
        raise invalid("file")

    filename = clean_filename(part.filename)
    limit = upload_limit_for(ctx.caller.tier)
    data = bytearray()
    while True:
        chunk = await part.read(READ_CHUNK)
        if not chunk:
            break
        data += chunk
        if len(data) > limit:
            raise ApiError(413, "payload_too_large", "file")
    await form.close()
    if not data:
        raise invalid("file")

    details = inspect(bytes(data))
    digest = hashlib.sha256(bytes(data)).hexdigest()
    async with DB.transaction() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO attachments (uploader_id, filename, size_bytes, content_type, sha256,
                                     data, width, height, duration_ms)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id, filename, size_bytes, content_type, sha256, width, height, duration_ms
            """,
            ctx.caller.id,
            filename,
            len(data),
            details["content_type"],
            digest,
            bytes(data),
            details["width"],
            details["height"],
            details["duration_ms"],
        )
    return json_response(attachment_json(row), 201)


async def serve_media(ctx: Ctx) -> Response:
    from ..media import media_response

    return await media_response(ctx.params["attachment_id"], ctx.request)

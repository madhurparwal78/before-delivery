"""Preview and download grants, the single-use claim, and streaming outside any transaction."""

from __future__ import annotations

import asyncio
import tempfile
from collections.abc import AsyncIterator
from typing import Any

import asyncpg
import httpx

from wardline import fields, ledger, media
from wardline.access import (
    authorise,
    grant_in_force,
    link_in_force,
    require_grant,
    well_formed,
)
from wardline.auth import TOKEN_SHAPE, digest_token, new_token, session_ending
from wardline.db import DB
from wardline.errors import ApiError, StorageUnavailable
from wardline.routes.exhibits import load_exhibit
from wardline.s3 import CHUNK, STORAGE
from wardline.states import READABLE, not_previewable
from wardline.web import (
    STALL_SECONDS,
    Reply,
    Request,
    base_headers,
    privacy_headers,
    route,
)

GRANT_SECONDS = 60


def _not_found() -> ApiError:
    return ApiError("not_found")


async def issue_token(conn: asyncpg.Connection, kind: str, exhibit_id: str, *, derivative_id: str | None = None,
                      page: int | None = None, request: Request | None = None, grant_id: str | None = None,
                      link_id: str | None = None) -> Reply:
    token = new_token()
    await conn.execute(
        """INSERT INTO download_grants (token_hash, kind, exhibit_id, derivative_id, page, issued_by, session_id, grant_id,
             link_id, via_break_glass, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() + make_interval(secs => $11))""",
        digest_token(token), kind, exhibit_id, derivative_id, page,
        request.person.id if request else None, request.person.session_id if request else None,
        grant_id, link_id, bool(request and request.break_glass_grant), float(GRANT_SECONDS),
    )
    return Reply(201, {"token": token, "expires_in_seconds": GRANT_SECONDS})


@route("POST", "/api/exhibits/{id}/preview-grants")
async def preview_grant(request: Request) -> Reply:
    identifier = request.params["id"]
    async with DB.connection() as conn:
        row = await load_exhibit(request, conn)
        standing = await require_grant(request, conn, row["compartment_id"], identifier)
        authorise(request, standing, "preview")
        if row["state"] not in READABLE:
            raise ApiError("exhibit_not_cleared", state=row["state"])
        if not_previewable(row):
            raise ApiError("not_previewable")
        body = request.require_body()
    page = body.get("page")
    page_error = fields.REQUIRED if type(page) is not int else None if 1 <= page <= row["page_count"] else fields.PAGE
    if page_error is not None:
        form = fields.Form(body)
        form.errors["page"] = page_error
        form.done()
    if await STORAGE.size_of(row["object_key"]) is None:
        raise StorageUnavailable("original missing")
    async with DB.connection() as conn:
        return await issue_token(conn, "preview", row["id"], page=page, request=request, grant_id=standing.grant_id)


@route("POST", "/api/exhibits/{id}/download-grants")
async def original_grant(request: Request) -> Reply:
    identifier = request.params["id"]
    async with DB.connection() as conn:
        row = await load_exhibit(request, conn)
        standing = await require_grant(request, conn, row["compartment_id"], identifier)
        authorise(request, standing, "download_original")
        if row["state"] not in READABLE:
            raise ApiError("exhibit_not_cleared", state=row["state"])
        request.require_body()
        return await issue_token(conn, "file", row["id"], request=request, grant_id=standing.grant_id)


@route("POST", "/api/derivatives/{id}/download-grants")
async def derivative_grant(request: Request) -> Reply:
    identifier = request.params["id"]
    async with DB.connection() as conn:
        if not well_formed(identifier):
            raise request.not_found(identifier)
        row = await conn.fetchrow(
            """SELECT d.id, d.exhibit_id, d.compartment_id, e.state FROM derivatives d JOIN exhibits e ON e.id = d.exhibit_id
               WHERE d.id = $1""",
            str(identifier),
        )
        if row is None:
            raise request.not_found(identifier)
        standing = await require_grant(request, conn, row["compartment_id"], identifier)
        if row["state"] not in READABLE:
            raise ApiError("exhibit_not_cleared", state=row["state"])
        request.require_body()
        return await issue_token(conn, "file", row["exhibit_id"], derivative_id=row["id"], request=request, grant_id=standing.grant_id)


async def _grant_row(conn: asyncpg.Connection, token_hash: str) -> asyncpg.Record | None:
    """An unclaimed, unlapsed token whose authority still stands. Anything else is simply not found."""
    return await conn.fetchrow(
        f"""SELECT t.*, e.state AS exhibit_state, e.sha256 AS exhibit_sha256, e.size AS exhibit_size,
                  e.object_key AS exhibit_key, e.sniffed_type, d.sha256 AS derivative_sha256,
                  d.object_key AS derivative_key, d.content_type, d.size AS derivative_size
           FROM download_grants t
           JOIN exhibits e ON e.id = t.exhibit_id
           LEFT JOIN derivatives d ON d.id = t.derivative_id
           LEFT JOIN sessions s ON s.id = t.session_id
           LEFT JOIN grants g ON g.id = t.grant_id
           LEFT JOIN links l ON l.id = t.link_id
           LEFT JOIN releases r ON r.id = l.release_id
           WHERE t.token_hash = $1 AND t.claimed_at IS NULL AND t.expires_at > now()
             AND e.state <> 'disposed' AND (d.id IS NULL OR NOT d.disposed)
             AND (t.link_id IS NOT NULL OR (
                   s.closed_at IS NULL AND {session_ending("s")} IS NULL
                   AND {grant_in_force("g")}
                   AND (t.derivative_id IS NOT NULL OR g.scope = 'full')))
             AND (t.link_id IS NULL OR ({link_in_force()}))""",
        token_hash,
    )


async def _claim(token_hash: str, row: asyncpg.Record, kind: str) -> bool:
    """Commit the claim and its entry. Of any number of concurrent requests, exactly one gets True."""
    async with DB.tx() as conn:
        if await _grant_row(conn, token_hash) is None:
            return False
        claimed = await conn.fetchval(
            "UPDATE download_grants SET claimed_at = now() WHERE token_hash = $1 AND claimed_at IS NULL RETURNING 1", token_hash
        )
        if not claimed:
            return False
        detail: dict[str, Any] = {
            "sha256": row["derivative_sha256"] or row["exhibit_sha256"],
            "exhibit_id": row["exhibit_id"],
            "kind": kind,
        }
        if row["derivative_id"]:
            detail["derivative_id"] = row["derivative_id"]
        if row["via_break_glass"]:
            detail.update(via="break_glass", grant_id=row["grant_id"])
        if row["link_id"]:
            actor, session = f"link:{row['link_id']}", None
        else:
            actor, session = row["issued_by"], row["session_id"]
        await ledger.append(conn, actor_id=actor, session_id=session, action="download.claimed",
                            target=row["derivative_id"] or row["exhibit_id"], detail=detail)
    return True


def _file_headers(path: str, record_id: str, digest: str, content_type: str, size: int) -> list[tuple[bytes, bytes]]:
    extension = media.EXTENSIONS[content_type]
    return base_headers({
        **privacy_headers(path),
        "content-type": content_type,
        "content-length": str(size),
        "content-disposition": f'attachment; filename="{record_id}-{digest}.{extension}"',
    })


async def _stream(request: Request, headers: list[tuple[bytes, bytes]], chunks: AsyncIterator[bytes]) -> None:
    """Send bytes outside any transaction. A dropped client or thirty stalled seconds ends the transfer."""
    request.started = True

    async def pump() -> None:
        await request.send({"type": "http.response.start", "status": 200, "headers": headers})
        async for chunk in chunks:
            await asyncio.wait_for(request.send({"type": "http.response.body", "body": chunk, "more_body": True}), STALL_SECONDS)
        await request.send({"type": "http.response.body", "body": b""})

    sender = asyncio.ensure_future(pump())
    watcher = asyncio.ensure_future(request.client_left())
    try:
        await asyncio.wait({sender, watcher}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for task in (sender, watcher):
            task.cancel()
        await asyncio.gather(sender, watcher, return_exceptions=True)


async def _serve_preview(request: Request, token_hash: str, row: asyncpg.Record) -> None:
    with tempfile.NamedTemporaryFile(prefix="wardline-") as source, tempfile.NamedTemporaryFile(prefix="wardline-") as output:
        if not await STORAGE.spool(row["exhibit_key"], source):
            raise StorageUnavailable("original missing")
        await media.POOL.run(media.render_preview, source.name, row["sniffed_type"], row["page"], output.name)
        if not await _claim(token_hash, row, "preview"):
            raise _not_found()
        size = output.seek(0, 2)
        output.seek(0)

        async def chunks() -> AsyncIterator[bytes]:
            while chunk := output.read(CHUNK):
                yield chunk

        headers = _file_headers(request.raw_path, row["exhibit_id"], row["exhibit_sha256"], "image/png", size)
        await _stream(request, headers, chunks())


async def _serve_file(request: Request, token_hash: str, row: asyncpg.Record) -> None:
    derivative = row["derivative_id"] is not None
    key = row["derivative_key"] if derivative else row["exhibit_key"]
    async with STORAGE.opened(key) as answer:
        if answer is None:
            raise StorageUnavailable("object missing")
        if not await _claim(token_hash, row, "file"):
            raise _not_found()

        async def chunks() -> AsyncIterator[bytes]:
            try:
                async for chunk in answer.aiter_bytes(CHUNK):
                    yield chunk
            except (httpx.HTTPError, OSError):
                return

        headers = _file_headers(
            request.raw_path,
            row["derivative_id"] or row["exhibit_id"],
            row["derivative_sha256"] or row["exhibit_sha256"],
            row["content_type"] or row["sniffed_type"],
            row["derivative_size"] if derivative else row["exhibit_size"],
        )
        await _stream(request, headers, chunks())


@route("GET", "/api/download/{token}", auth=False)
async def download(request: Request) -> Reply | None:
    token = request.params["token"]
    if not TOKEN_SHAPE.fullmatch(token):
        raise _not_found()
    token_hash = digest_token(str(token))
    async with DB.connection() as conn:
        row = await _grant_row(conn, token_hash)
    if row is None:
        raise _not_found()
    if row["kind"] == "preview":
        await _serve_preview(request, token_hash, row)
    else:
        await _serve_file(request, token_hash, row)
    return None



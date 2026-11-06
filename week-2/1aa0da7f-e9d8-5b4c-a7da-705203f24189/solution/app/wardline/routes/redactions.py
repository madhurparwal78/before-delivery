"""Saved marks, finding text, rendering derivatives."""

from __future__ import annotations

import hashlib
import tempfile
from typing import Any

import asyncpg

from wardline import fields, media
from wardline.access import authorise, entry, require_grant, well_formed
from wardline.db import DB, next_id
from wardline.errors import ApiError, StorageUnavailable
from wardline.routes.exhibits import load_exhibit, remove_object
from wardline.s3 import STORAGE, fresh_key
from wardline.states import WRITABLE, is_superseded, not_previewable
from wardline.web import Reply, Request, route

_REGION_KEYS = ("page", "x", "y", "w", "h")


def derivative_json(row: asyncpg.Record, exhibit_version: int) -> dict[str, Any]:
    return {
        "id": row["id"],
        "exhibit_id": row["exhibit_id"],
        "compartment_id": row["compartment_id"],
        "sha256": row["sha256"],
        "size": row["size"],
        "content_type": row["content_type"],
        "page_count": row["page_count"],
        "created_by": row["created_by"],
        "marks_version": row["marks_version"],
        "marks_saved_by": row["marks_saved_by"],
        "superseded": is_superseded(row["marks_version"], exhibit_version),
        "disposed": row["disposed"],
    }


def _region_valid(region: Any, page_count: int) -> bool:
    if not isinstance(region, dict) or any(type(region.get(key)) is not int for key in _REGION_KEYS):
        return False
    x, y, w, h, page = region["x"], region["y"], region["w"], region["h"], region["page"]
    return x >= 0 and y >= 0 and w >= 1 and h >= 1 and x + w <= 1000 and y + h <= 1000 and 1 <= page <= page_count


def _as_set(regions: list[dict]) -> list[tuple[int, ...]]:
    return sorted(tuple(r[key] for key in _REGION_KEYS) for r in regions)


def _check_writable(row: asyncpg.Record) -> None:
    if row["state"] not in WRITABLE:
        raise ApiError("exhibit_not_cleared", state=row["state"])
    if not_previewable(row):
        raise ApiError("not_redactable")


@route("GET", "/api/exhibits/{id}/redactions")
async def read_marks(request: Request) -> Reply:
    identifier = request.params["id"]
    async with DB.connection() as conn:
        row = await load_exhibit(request, conn)
        standing = await require_grant(request, conn, row["compartment_id"], identifier)
        authorise(request, standing, "redact")
    return Reply(200, {"regions": row["regions"], "marks_version": row["marks_version"]})


@route("PUT", "/api/exhibits/{id}/redactions")
async def save_marks(request: Request) -> Reply:
    identifier = request.params["id"]
    body = request.json_body() or {}
    async with DB.tx() as conn:
        row = await load_exhibit(request, conn, lock=True)
        standing = await require_grant(request, conn, row["compartment_id"], identifier)
        authorise(request, standing, "redact")
        _check_writable(row)
        version = body.get("marks_version")
        if type(version) is int and version != row["marks_version"]:
            raise ApiError("stale_marks", marks_version=row["marks_version"])
        form = fields.Form(request.require_body())
        form.whole_number("marks_version")
        regions = body.get("regions")
        if not isinstance(regions, list):
            form.errors["regions"] = fields.REQUIRED
        elif not all(_region_valid(r, row["page_count"]) for r in regions):
            form.errors["regions"] = fields.REGIONS
        form.done()
        clean = [{key: r[key] for key in _REGION_KEYS} for r in regions]
        if _as_set(clean) == _as_set(row["regions"]):
            return Reply(200, {"regions": row["regions"], "marks_version": row["marks_version"]})
        updated = await conn.fetchrow(
            "UPDATE exhibits SET regions = $2, marks_version = marks_version + 1, marks_saved_by = $3 WHERE id = $1 RETURNING marks_version",
            row["id"], clean, request.person.id,
        )
        await entry(conn, request, "redaction.saved", row["id"], {"marks_version": updated["marks_version"]})
        return Reply(200, {"regions": clean, "marks_version": updated["marks_version"]})


@route("POST", "/api/exhibits/{id}/redactions/find")
async def find_text(request: Request) -> Reply:
    identifier = request.params["id"]
    async with DB.connection() as conn:
        row = await load_exhibit(request, conn)
        standing = await require_grant(request, conn, row["compartment_id"], identifier)
        authorise(request, standing, "find_text")
    _check_writable(row)
    form = fields.Form(request.require_body())
    text = form.text("text", 200)
    form.done()
    if row["sniffed_type"] != "application/pdf":
        if await STORAGE.size_of(row["object_key"]) is None:
            raise StorageUnavailable("original missing")
        return Reply(200, {"matches": []})
    with tempfile.NamedTemporaryFile(prefix="wardline-") as source:
        if not await STORAGE.spool(row["object_key"], source):
            raise StorageUnavailable("original missing")
        matches = await media.POOL.run(media.find_text, source.name, text)
    return Reply(200, {"matches": matches})


@route("POST", "/api/exhibits/{id}/derivatives")
async def render_derivative(request: Request) -> Reply:
    identifier = request.params["id"]
    async with DB.connection() as conn:
        row = await load_exhibit(request, conn)
        standing = await require_grant(request, conn, row["compartment_id"], identifier)
        authorise(request, standing, "render")
    _check_writable(row)
    request.require_body()
    object_key = fresh_key("derivatives")
    with tempfile.NamedTemporaryFile(prefix="wardline-") as source, tempfile.NamedTemporaryFile(prefix="wardline-") as output:
        if not await STORAGE.spool(row["object_key"], source):
            raise StorageUnavailable("original missing")
        content_type, page_count = await media.POOL.run(
            media.render_derivative, source.name, row["sniffed_type"], row["regions"], output.name
        )
        digest = hashlib.sha256()
        size = 0
        output.seek(0)
        while chunk := output.read(1 << 20):
            digest.update(chunk)
            size += len(chunk)
        try:
            await STORAGE.put_file(object_key, output, size)
        except BaseException:
            await remove_object(object_key)
            raise
    try:
        if await STORAGE.digest_of(object_key) != (digest.hexdigest(), size):
            raise StorageUnavailable("stored derivative does not match what was sent")
        async with DB.tx() as conn:
            current = await conn.fetchval("SELECT state FROM exhibits WHERE id = $1 FOR UPDATE", row["id"])
            authorise(request, await require_grant(request, conn, row["compartment_id"], identifier), "render")
            if current not in WRITABLE:
                raise ApiError("exhibit_not_cleared", state=current)
            derivative_id = await next_id(conn, "DV", "derivatives_seq")
            created = await conn.fetchrow(
                """INSERT INTO derivatives (id, exhibit_id, compartment_id, sha256, size, content_type, page_count,
                     created_by, marks_version, marks_saved_by, object_key)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *""",
                derivative_id, row["id"], row["compartment_id"], digest.hexdigest(), size, content_type, page_count,
                request.person.id, row["marks_version"], row["marks_saved_by"], object_key,
            )
            version = await conn.fetchval("SELECT marks_version FROM exhibits WHERE id = $1", row["id"])
            await entry(conn, request, "derivative.rendered", derivative_id, {
                "exhibit_id": row["id"], "sha256": digest.hexdigest(), "size": size, "marks_version": row["marks_version"],
            })
            return Reply(201, derivative_json(created, version))
    except BaseException:
        await remove_object(object_key)
        raise


@route("GET", "/api/exhibits/{id}/derivatives")
async def list_derivatives(request: Request) -> Reply:
    identifier = request.params["id"]
    async with DB.connection() as conn:
        row = await load_exhibit(request, conn)
        await require_grant(request, conn, row["compartment_id"], identifier)
        rows = await conn.fetch("SELECT * FROM derivatives WHERE exhibit_id = $1 ORDER BY length(id), id", row["id"])
    return Reply(200, {"derivatives": [derivative_json(d, row["marks_version"]) for d in rows]})


@route("GET", "/api/derivatives/{id}")
async def read_derivative(request: Request) -> Reply:
    identifier = request.params["id"]
    async with DB.connection() as conn:
        if not well_formed(identifier):
            raise request.not_found(identifier)
        row = await conn.fetchrow(
            "SELECT d.*, e.marks_version AS exhibit_version FROM derivatives d JOIN exhibits e ON e.id = d.exhibit_id WHERE d.id = $1",
            str(identifier),
        )
        if row is None:
            raise request.not_found(identifier)
        await require_grant(request, conn, row["compartment_id"], identifier)
    return Reply(200, derivative_json(row, row["exhibit_version"]))



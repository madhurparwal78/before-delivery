"""Strip scans: upload, listing, downloads, calibration and frame detection."""

import asyncio
import hashlib
import re
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import quote

import anyio
import asyncpg
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from . import densitometry, imaging
from .analysis import calibration_of, original_key, preview_key, refresh_densities, refresh_from_stored_calibration
from .context import load_context, owned_roll, owned_scan
from .errors import ApiError, StorageUnavailable, not_found, validation_failed
from .http import parse_id, read_json, require_account, respond
from .validation import DPI_RANGE, FIRST_EDGE_RANGE, MESSAGES, UPLOAD_LIMIT, Form, whole_number
from .storage import Storage
from .views import calibration_view, frames_view, scan_view

FILENAME_LIMIT = 120
FILE_MESSAGES = {"dimensions": "file_dimensions", "pixel_format": "file_pixel_format",
                 "tiff_layout": "file_tiff_layout", "unreadable": "file_unreadable"}
CONTENT_TYPES = {"png": "image/png", "tiff": "image/tiff"}
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def clean_filename(raw: str) -> str:
    """Path components and control characters removed, cut to 120 characters, never empty."""
    name = _CONTROL.sub("", re.split(r"[\\/]", raw)[-1]).strip()[:FILENAME_LIMIT]
    return name or "strip"


_guards: dict[tuple[uuid.UUID, str], tuple[asyncio.Lock, int]] = {}


@asynccontextmanager
async def duplicate_guard(roll_id: uuid.UUID, sha256: str) -> AsyncIterator[None]:
    """Identical bytes for one roll are stored one at a time, so exactly one of several simultaneous uploads wins."""
    key = (roll_id, sha256)
    lock, users = _guards.get(key, (asyncio.Lock(), 0))
    _guards[key] = (lock, users + 1)
    try:
        async with lock:
            yield
    finally:
        lock, users = _guards[key]
        if users == 1:
            del _guards[key]
        else:
            _guards[key] = (lock, users - 1)


async def _read_body(request: Request) -> tuple[bytes, str]:
    """The upload body and its SHA-256; 413 as soon as it passes the limit. A client that drops mid-body leaves nothing."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > UPLOAD_LIMIT:
        raise ApiError(413, "too_large")
    body, digest = bytearray(), hashlib.sha256()
    async for chunk in request.stream():
        body += chunk
        digest.update(chunk)
        if len(body) > UPLOAD_LIMIT:
            raise ApiError(413, "too_large")
    return bytes(body), digest.hexdigest()


def _prepare(data: bytes) -> tuple[imaging.DecodedImage, list[bytes]]:
    image = imaging.open_image(data)
    return image, imaging.preview_slices(imaging.preview_image(image))


def _upload_form(request: Request, data: bytes, digest: str) -> Form:
    """Validate dpi, first_edge, the declared size and checksum together; the file checks run in `upload_scan`."""
    form = Form({"dpi": _whole(request.query_params.get("dpi")), "first_edge": _whole(request.query_params.get("first_edge"))})
    form.field("dpi", whole_number(*DPI_RANGE))
    form.field("first_edge", whole_number(*FIRST_EDGE_RANGE))
    declared_size = request.headers.get("X-Scan-Size", "")
    if not (declared_size.isdigit() and int(declared_size) == len(data)):
        form.fail("size")
    if request.headers.get("X-Scan-SHA256", "") != digest:
        form.fail("sha256")
    return form


def _whole(text: str | None) -> int | None:
    return int(text) if text is not None and re.fullmatch(r"-?[0-9]{1,12}", text) else None


async def _existing_scan_id(connection: asyncpg.Connection, roll_id: uuid.UUID, digest: str) -> uuid.UUID | None:
    return await connection.fetchval("SELECT id FROM scans WHERE roll_id = $1 AND sha256 = $2", roll_id, digest)


async def upload_scan(request: Request) -> JSONResponse:
    """Upload a strip: size, format, duplicate, validation, then storage. The original and its previews are written,
    the original is read back and its size and SHA-256 confirmed, and only then is the scan record committed; any
    failure deletes every object this upload wrote."""
    account = await require_account(request)
    roll_id = parse_id(request.path_params["roll_id"])
    db, storage = request.app.state.db, request.app.state.storage
    async with db.connection() as connection:
        await owned_roll(connection, account.id, roll_id)
    data, digest = await _read_body(request)
    if not imaging.has_supported_signature(data):
        raise ApiError(415, "unsupported_format")
    async with duplicate_guard(roll_id, digest):
        async with db.connection() as connection:
            existing = await _existing_scan_id(connection, roll_id, digest)
        if existing is not None:
            raise ApiError(409, "duplicate_scan", scan_id=str(existing))
        form = _upload_form(request, data, digest)
        prepared = None
        try:
            prepared = await anyio.to_thread.run_sync(_prepare, data)
        except imaging.RefusedFile as refused:
            form.errors["file"] = MESSAGES[FILE_MESSAGES[refused.kind]]
        if form.errors:
            raise validation_failed({name: form.errors[name] for name in ("size", "sha256", "dpi", "first_edge", "file")
                                     if name in form.errors})
        image, slices = prepared
        scan_id = uuid.uuid4()
        keys = [original_key(account.id, scan_id)] + [preview_key(account.id, scan_id, n) for n in range(len(slices))]
        committed = False
        try:
            await storage.put(keys[0], data, CONTENT_TYPES[image.format])
            for key, body in zip(keys[1:], slices):
                await storage.put(key, body, "image/png")
            stored = await storage.get(keys[0])
            if len(stored) != len(data) or hashlib.sha256(stored).hexdigest() != digest:
                raise StorageUnavailable()
            async with db.transaction() as connection:
                await connection.execute("SELECT id FROM rolls WHERE id = $1 FOR UPDATE", roll_id)
                position = await connection.fetchval("SELECT coalesce(max(position), 0) + 1 FROM scans WHERE roll_id = $1", roll_id)
                try:
                    scan = await connection.fetchrow(
                        "INSERT INTO scans (id, roll_id, position, filename, format, size, sha256, width, height, dpi,"
                        " first_edge, transfer, gamma, state, preview_slices) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,"
                        " $10, $11, $12, $13, 'stored', $14) RETURNING *", scan_id, roll_id, position,
                        clean_filename(request.query_params.get("filename", "")), image.format, len(data), digest,
                        image.width, image.height, form.values["dpi"], form.values["first_edge"], image.transfer,
                        image.gamma, len(slices))
                except asyncpg.UniqueViolationError as error:
                    winner = await _existing_scan_id(connection, roll_id, digest)
                    raise ApiError(409, "duplicate_scan", scan_id=str(winner)) from error
            committed = True
        finally:
            if not committed:
                await _delete_objects(storage, keys)
    return respond(scan_view(scan, None), 201)


async def _delete_objects(storage: Storage, keys: list[str]) -> None:
    """Remove everything an unfinished upload wrote; an unreachable store holds nothing to remove."""
    for key in keys:
        try:
            await storage.delete(key)
        except StorageUnavailable:
            return


async def list_scans(request: Request) -> JSONResponse:
    account = await require_account(request)
    async with request.app.state.db.connection() as connection:
        roll = await owned_roll(connection, account.id, parse_id(request.path_params["roll_id"]))
        scans = await connection.fetch("SELECT * FROM scans WHERE roll_id = $1 ORDER BY position", roll["id"])
        calibrations = await _current_calibrations(connection, scans)
        return respond({"scans": [scan_view(s, calibrations.get(s["calibration_id"])) for s in scans]})


async def _current_calibrations(connection: asyncpg.Connection, scans: list[asyncpg.Record]) -> dict[Any, asyncpg.Record]:
    ids = [s["calibration_id"] for s in scans if s["calibration_id"]]
    rows = await connection.fetch("SELECT * FROM calibrations WHERE id = ANY($1::uuid[])", ids)
    return {row["id"]: row for row in rows}


async def get_scan(request: Request) -> JSONResponse:
    account = await require_account(request)
    async with request.app.state.db.connection() as connection:
        scan = await owned_scan(connection, account.id, parse_id(request.path_params["scan_id"]))
        roll = await owned_roll(connection, account.id, scan["roll_id"])
        ctx = await load_context(connection, roll)
        calibration = await connection.fetchrow("SELECT * FROM calibrations WHERE id = $1", scan["calibration_id"])
        return respond({**scan_view(scan, calibration), "frames": frames_view(ctx, scan["id"])})


def _content_disposition(filename: str) -> str:
    plain = re.sub(r'["\\]', "_", filename)
    if plain.isascii():
        return f'attachment; filename="{plain}"'
    return f"attachment; filename=\"{plain.encode('ascii', 'replace').decode().replace('?', '_')}\"; filename*=UTF-8''{quote(filename)}"


async def download_original(request: Request) -> Response:
    account = await require_account(request)
    async with request.app.state.db.connection() as connection:
        scan = await owned_scan(connection, account.id, parse_id(request.path_params["scan_id"]))
    body = await request.app.state.storage.get(original_key(account.id, scan["id"]))
    return Response(body, media_type=CONTENT_TYPES[scan["format"]], headers={
        "Content-Disposition": _content_disposition(scan["filename"]), "X-Scan-SHA256": scan["sha256"],
        "X-Content-Type-Options": "nosniff"})


async def download_preview(request: Request) -> Response:
    account = await require_account(request)
    async with request.app.state.db.connection() as connection:
        scan = await owned_scan(connection, account.id, parse_id(request.path_params["scan_id"]))
    number = request.path_params["slice"]
    if not number.isdigit() or int(number) >= scan["preview_slices"]:
        raise not_found()
    body = await request.app.state.storage.get(preview_key(account.id, scan["id"], int(number)))
    return Response(body, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})


def _area(value: Any, scan: asyncpg.Record) -> densitometry.Area | None:
    """The marked rectangle when it lies inside the scan with whole-pixel sides, otherwise None."""
    if not isinstance(value, dict) or not all(isinstance(value.get(k), int) and not isinstance(value.get(k), bool)
                                              for k in "xywh"):
        return None
    area = densitometry.Area(value["x"], value["y"], value["w"], value["h"])
    inside = area.x >= 0 and area.y >= 0 and area.x + area.w <= scan["width"] and area.y + area.h <= scan["height"]
    return area if inside and area.w > 0 and area.h > 0 else None


async def calibrate(request: Request) -> JSONResponse:
    """Mark a clear-light patch or a 21-step wedge; the scan's frame densities follow at once."""
    account = await require_account(request)
    scan_id = parse_id(request.path_params["scan_id"])
    db = request.app.state.db
    async with db.connection() as connection:
        await owned_scan(connection, account.id, scan_id)
    body = await read_json(request)
    method = body.get("method")
    async with db.transaction() as connection:
        scan = await owned_scan(connection, account.id, scan_id, lock=True)
        area = _area(body.get("area"), scan)
        wedge = method == "step_wedge"
        if method not in ("clear_light", "step_wedge") or area is None:
            raise validation_failed({"area": MESSAGES["area"]})
        if area.w < (densitometry.MIN_WEDGE_WIDTH if wedge else densitometry.MIN_AREA) or area.h < densitometry.MIN_AREA:
            raise validation_failed({"wedge": MESSAGES["wedge_size"]} if wedge else {"area": MESSAGES["area"]})
        analysis = await request.app.state.analyses.load(account.id, scan_id)
        reference, steps = None, None
        if wedge:
            means = densitometry.wedge_step_means(analysis.linear, area)
            if not densitometry.wedge_darkens_in_order(means):
                raise validation_failed({"wedge": MESSAGES["wedge_order"]})
            steps = [{"k": k, "nominal": densitometry.wedge_nominal(k), "value": value} for k, value in enumerate(means)]
        else:
            reference = densitometry.area_mean(analysis.linear, area)
        row = await connection.fetchrow(
            "INSERT INTO calibrations (id, scan_id, method, area, reference, steps) VALUES ($1, $2, $3, $4, $5, $6)"
            " RETURNING *", uuid.uuid4(), scan_id, method, {"x": area.x, "y": area.y, "w": area.w, "h": area.h},
            reference, steps)
        await connection.execute(
            "UPDATE scans SET calibration_id = $2, state = CASE WHEN state = 'stored' THEN 'calibrated' ELSE state END"
            " WHERE id = $1", scan_id, row["id"])
        if await connection.fetchval("SELECT count(*) FROM frames WHERE scan_id = $1", scan_id):
            await refresh_densities(connection, scan, analysis, calibration_of(row))
    return respond(calibration_view(row), 201)


async def detect_frames(request: Request) -> JSONResponse:
    """Find the frames of a calibrated scan from its stored original."""
    account = await require_account(request)
    scan_id = parse_id(request.path_params["scan_id"])
    db = request.app.state.db
    async with db.connection() as connection:
        await owned_scan(connection, account.id, scan_id)
    await read_json(request)
    async with db.transaction() as connection:
        scan = await owned_scan(connection, account.id, scan_id, lock=True)
        await connection.execute("SELECT id FROM rolls WHERE id = $1 FOR UPDATE", scan["roll_id"])
        if scan["state"] == "stored":
            raise ApiError(409, "not_calibrated")
        if scan["state"] != "calibrated":
            raise ApiError(409, "frames_exist")
        analysis = await request.app.state.analyses.load(account.id, scan_id)
        roll = await owned_roll(connection, account.id, scan["roll_id"])
        found = densitometry.detect_frames(analysis.band, roll["format"], scan["dpi"])
        if not found:
            raise validation_failed({"scan": MESSAGES["scan_no_frames"]})
        for index, frame in enumerate(found):
            await connection.execute(
                "INSERT INTO frames (id, scan_id, number, edge_number, x0, x1, flag, blank_slot, mean_density,"
                " net_density, unexposed) VALUES ($1, $2, 0, $3, $4, $5, $6, $7, 0, 0, false)", uuid.uuid4(), scan_id,
                scan["first_edge"] + index, frame.x0, frame.x1,
                densitometry.frame_flag(frame.blank_slot, frame.x0, frame.x1, roll["format"], scan["dpi"]), frame.blank_slot)
        await number_frames(connection, roll["id"])
        await refresh_from_stored_calibration(connection, scan, analysis)
        await connection.execute("UPDATE scans SET state = 'framed' WHERE id = $1", scan_id)
        ctx = await load_context(connection, roll)
        return respond({"frames": frames_view(ctx, scan_id)}, 201)


async def number_frames(connection: asyncpg.Connection, roll_id: uuid.UUID) -> None:
    """Frames are numbered across the roll by scan position, then by x0, starting at 1."""
    await connection.execute(
        "UPDATE frames SET number = q.number FROM (SELECT f.id, row_number() OVER (ORDER BY s.position, f.x0) AS number"
        " FROM frames f JOIN scans s ON s.id = f.scan_id WHERE s.roll_id = $1) q WHERE frames.id = q.id", roll_id)

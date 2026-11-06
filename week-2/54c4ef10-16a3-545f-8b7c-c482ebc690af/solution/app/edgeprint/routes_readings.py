"""Loupe readings of a sample cell and pinned readings."""

import uuid
from typing import Any

import asyncpg
from starlette.requests import Request
from starlette.responses import JSONResponse

from . import densitometry
from .analysis import stored_calibration
from .context import RollContext, curve_for, load_context, owned_roll, owned_scan
from .errors import ApiError, validation_failed
from .exposure import half_away
from .http import parse_id, read_json, require_account, respond
from .validation import MESSAGES
from .views import curve_position, reading_view


def _coordinates(source: Any, scan: asyncpg.Record) -> tuple[int, int]:
    """The point (x, y) inside the scan, else a 422 naming each coordinate that is outside."""
    bad, values = {}, {}
    for name, limit in (("x", scan["width"]), ("y", scan["height"])):
        raw = source.get(name)
        if isinstance(raw, str) and raw.lstrip("-").isdigit():
            raw = int(raw)
        if isinstance(raw, int) and not isinstance(raw, bool) and 0 <= raw < limit:
            values[name] = raw
        else:
            bad[name] = MESSAGES["point_outside"]
    if bad:
        raise validation_failed(bad)
    return values["x"], values["y"]


def _frame_at(ctx: RollContext, scan_id: uuid.UUID, x: int) -> asyncpg.Record | None:
    """The frame of this scan whose [x0, x1) holds the cell's left column."""
    left = densitometry.sample_cell_origin(x, 0)[0]
    return next((f for f in ctx.frames if f["scan_id"] == scan_id and f["x0"] <= left < f["x1"]), None)


async def _measure(request: Request, account_id: uuid.UUID, scan: asyncpg.Record, x: int, y: int,
                   ) -> tuple[float, float | None, asyncpg.Record]:
    analysis = await request.app.state.analyses.load(account_id, scan["id"])
    async with request.app.state.db.connection() as connection:
        calibration, described = await stored_calibration(connection, scan)
    gross, net = densitometry.reading_densities(analysis.linear, x, y, described, scan["base_fog"])
    return gross, net, calibration


async def read_cell(request: Request) -> JSONResponse:
    account = await require_account(request)
    db = request.app.state.db
    async with db.connection() as connection:
        scan = await owned_scan(connection, account.id, parse_id(request.path_params["scan_id"]))
    if scan["state"] == "stored":
        raise ApiError(409, "not_calibrated")
    x, y = _coordinates(request.query_params, scan)
    gross, net, calibration = await _measure(request, account.id, scan, x, y)
    cell_x, cell_y = densitometry.sample_cell_origin(x, y)
    async with db.connection() as connection:
        roll = await owned_roll(connection, account.id, scan["roll_id"])
        ctx = await load_context(connection, roll)
        frame = _frame_at(ctx, scan["id"], x)
        log_h = zone = None
        if net is not None:
            _, curve = await curve_for(connection, ctx)
            log_h, zone = curve_position(curve, net)
    return respond({"x": cell_x, "y": cell_y, "gross": half_away(gross, 2),
                    "net": None if net is None else half_away(net, 2), "log_h": log_h, "zone": zone,
                    "frame_id": str(frame["id"]) if frame else None, "calibration_id": str(calibration["id"])})


async def pin_reading(request: Request) -> JSONResponse:
    account = await require_account(request)
    db = request.app.state.db
    async with db.connection() as connection:
        scan = await owned_scan(connection, account.id, parse_id(request.path_params["scan_id"]))
    body = await read_json(request)
    if scan["state"] == "stored":
        raise ApiError(409, "not_calibrated")
    async with db.connection() as connection:
        if not await connection.fetchval("SELECT count(*) FROM frames WHERE scan_id = $1", scan["id"]):
            raise ApiError(409, "no_frames")
    x, y = _coordinates(body, scan)
    async with db.connection() as connection:
        roll = await owned_roll(connection, account.id, scan["roll_id"])
        frame = _frame_at(await load_context(connection, roll), scan["id"], x)
    if frame is None:
        raise validation_failed({"x": MESSAGES["pin_outside_frame"]})
    gross, net, calibration = await _measure(request, account.id, scan, x, y)
    cell_x, cell_y = densitometry.sample_cell_origin(x, y)
    async with db.transaction() as connection:
        roll = await owned_roll(connection, account.id, scan["roll_id"])
        ctx = await load_context(connection, roll)
        entry_id = next((uuid.UUID(e) for e, (f, _) in ctx.matched.items() if f == str(frame["id"])), None)
        row = await connection.fetchrow(
            "INSERT INTO readings (id, scan_id, frame_id, entry_id, x, y, gross, net, calibration_id)"
            " VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *", uuid.uuid4(), scan["id"], frame["id"], entry_id,
            cell_x, cell_y, half_away(gross, 2), half_away(net, 2), calibration["id"])
        _, curve = await curve_for(connection, ctx)
    return respond(reading_view(row, curve), 201)

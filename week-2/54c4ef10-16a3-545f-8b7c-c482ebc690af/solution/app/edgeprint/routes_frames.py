"""Frames: reading one, nudging its edges (one at a time per scan), titles and accepting a flagged width."""

import uuid
from typing import Any

import asyncpg
from starlette.requests import Request
from starlette.responses import JSONResponse

from . import densitometry
from .analysis import refresh_from_stored_calibration
from .context import RollContext, curve_for, load_context, owned_frame, owned_roll, owned_scan
from .errors import ApiError
from .http import parse_id, read_json, require_account, respond
from .validation import TITLE_LIMIT, Form, Invalid, text, whole_number
from .views import entry_view, frame_view, reading_view

EDGE_RULE = whole_number(-(2**31), 2**31 - 1)


async def _context_of_frame(connection: asyncpg.Connection, account_id: uuid.UUID, frame_id: uuid.UUID) -> tuple[RollContext, asyncpg.Record]:
    frame = await owned_frame(connection, account_id, frame_id)
    scan = await connection.fetchrow("SELECT * FROM scans WHERE id = $1", frame["scan_id"])
    roll = await connection.fetchrow("SELECT * FROM rolls WHERE id = $1", scan["roll_id"])
    ctx = await load_context(connection, roll)
    return ctx, next(f for f in ctx.frames if f["id"] == frame_id)


def frame_response(ctx: RollContext, frame: asyncpg.Record) -> dict[str, Any]:
    scan = next(s for s in ctx.scans if s["id"] == frame["scan_id"])
    entry_id = next((entry_id for entry_id, (frame_id, _) in ctx.matched.items() if frame_id == str(frame["id"])), None)
    return frame_view(frame, scan, entry_id)


async def get_frame(request: Request) -> JSONResponse:
    account = await require_account(request)
    async with request.app.state.db.connection() as connection:
        ctx, frame = await _context_of_frame(connection, account.id, parse_id(request.path_params["frame_id"]))
        _, curve = await curve_for(connection, ctx)
        readings = await connection.fetch("SELECT * FROM readings WHERE frame_id = $1 ORDER BY created_at, id", frame["id"])
        entry = next((e for e in ctx.entries if ctx.matched[str(e["id"])][0] == str(frame["id"])), None)
        return respond({"frame": frame_response(ctx, frame), "entry": entry_view(ctx, entry) if entry else None,
                        "readings": [reading_view(r, curve) for r in readings]})


async def update_frame(request: Request) -> JSONResponse:
    """Change a frame's edges and title. Edge changes are judged and recomputed under the scan's row lock, so
    concurrent nudges on one scan apply one at a time, each against the edges the earlier ones saved."""
    account = await require_account(request)
    frame_id = parse_id(request.path_params["frame_id"])
    db = request.app.state.db
    async with db.connection() as connection:
        await owned_frame(connection, account.id, frame_id)
    body = await read_json(request)
    form = Form(body)
    form.optional("title", text(0, TITLE_LIMIT))
    async with db.transaction() as connection:
        scan = await owned_scan(connection, account.id, (await owned_frame(connection, account.id, frame_id))["scan_id"], lock=True)
        saved = await owned_frame(connection, account.id, frame_id)
        edges = {}
        for name in ("x0", "x1"):
            if name in body:
                try:
                    edges[name] = EDGE_RULE(body[name])
                except Invalid:
                    form.fail(name, "edge")
        x0, x1 = edges.get("x0", saved["x0"]), edges.get("x1", saved["x1"])
        if edges and not form.errors.keys() & edges.keys():
            neighbours = await connection.fetch("SELECT x0, x1 FROM frames WHERE scan_id = $1 AND id <> $2", scan["id"], frame_id)
            overlaps = any(x0 < n["x1"] and n["x0"] < x1 for n in neighbours)
            if not (0 <= x0 < x1 <= scan["width"]) or x1 - x0 < densitometry.MIN_AREA or overlaps:
                for name in edges:
                    form.fail(name, "edge")
        values = form.done()
        if "title" in values:
            await connection.execute("UPDATE frames SET title = $2 WHERE id = $1", frame_id, values["title"])
        if (x0, x1) != (saved["x0"], saved["x1"]):
            analysis = await request.app.state.analyses.load(account.id, scan["id"])
            roll = await owned_roll(connection, account.id, scan["roll_id"])
            await connection.execute("UPDATE frames SET x0 = $2, x1 = $3, flag = $4 WHERE id = $1", frame_id, x0, x1,
                                     densitometry.frame_flag(saved["blank_slot"], x0, x1, roll["format"], scan["dpi"]))
            await refresh_from_stored_calibration(connection, scan, analysis)
        ctx, frame = await _context_of_frame(connection, account.id, frame_id)
        return respond(frame_response(ctx, frame))


async def accept_width(request: Request) -> JSONResponse:
    account = await require_account(request)
    frame_id = parse_id(request.path_params["frame_id"])
    db = request.app.state.db
    async with db.connection() as connection:
        await owned_frame(connection, account.id, frame_id)
    await read_json(request)
    async with db.transaction() as connection:
        saved = await owned_frame(connection, account.id, frame_id)
        await owned_scan(connection, account.id, saved["scan_id"], lock=True)
        if (await owned_frame(connection, account.id, frame_id))["flag"] != "flagged":
            raise ApiError(409, "not_flagged")
        await connection.execute("UPDATE frames SET flag = 'accepted' WHERE id = $1", frame_id)
        ctx, frame = await _context_of_frame(connection, account.id, frame_id)
        return respond(frame_response(ctx, frame))

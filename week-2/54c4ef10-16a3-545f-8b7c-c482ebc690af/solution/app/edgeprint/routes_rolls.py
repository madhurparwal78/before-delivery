"""Rolls, shooting-log entries, the contact sheet and the curve of a roll."""

import uuid
from typing import Any

import asyncpg
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from . import curves
from .context import brackets, curve_for, load_context, owned_entry, owned_roll
from .errors import ApiError
from .http import parse_id, read_json, require_account, respond
from .validation import ENTRY_DEFAULTS, ENTRY_RULES, REQUIRED, ROLL_DEFAULTS, ROLL_RULES, Form
from .views import curve_body, entry_view, frames_view, roll_view


async def _curve_roll(connection: asyncpg.Connection, account_id: uuid.UUID, value: Any) -> tuple[uuid.UUID | None, bool]:
    """(linked roll id, valid): an id that is not one of the account's rolls is not found, a roll that is not a test roll is invalid."""
    if value is None:
        return None, True
    if not isinstance(value, str):
        return None, False
    linked = await owned_roll(connection, account_id, parse_id(value))
    return linked["id"], linked["kind"] == "test"


async def list_rolls(request: Request) -> JSONResponse:
    account = await require_account(request)
    async with request.app.state.db.connection() as connection:
        rows = await connection.fetch("SELECT * FROM rolls WHERE account_id = $1 ORDER BY seq DESC", account.id)
        return respond({"rolls": [roll_view(await load_context(connection, row)) for row in rows]})


async def create_roll(request: Request) -> JSONResponse:
    account = await require_account(request)
    body = await read_json(request)
    async with request.app.state.db.connection() as connection:
        linked_id, linkable = await _curve_roll(connection, account.id, body.get("curve_roll_id"))
        form = Form(body)
        for name, rule in ROLL_RULES.items():
            form.field(name, rule, ROLL_DEFAULTS.get(name, REQUIRED))
        if not linkable or (linked_id is not None and form.values.get("kind") == "test"):
            form.fail("curve_roll_id")
        values = form.done()
        roll_id = uuid.uuid4()
        await connection.execute(
            "INSERT INTO rolls (id, account_id, name, stock, format, ei, push_pull, reciprocity_p, development_note,"
            " kind, curve_roll_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
            roll_id, account.id, values["name"], values["stock"], values["format"], values["ei"], values["push_pull"],
            values["reciprocity_p"], values["development_note"], values["kind"], linked_id)
        roll = await owned_roll(connection, account.id, roll_id)
        return respond(roll_view(await load_context(connection, roll)), 201)


async def get_roll(request: Request) -> JSONResponse:
    account = await require_account(request)
    async with request.app.state.db.connection() as connection:
        roll = await owned_roll(connection, account.id, parse_id(request.path_params["roll_id"]))
        return respond(roll_view(await load_context(connection, roll)))


async def update_roll(request: Request) -> JSONResponse:
    account = await require_account(request)
    roll_id = parse_id(request.path_params["roll_id"])
    async with request.app.state.db.connection() as connection:
        roll = await owned_roll(connection, account.id, roll_id)
        body = await read_json(request)
        linked_id, linkable = await _curve_roll(connection, account.id, body.get("curve_roll_id"))
        form = Form(body)
        for name in ("name", "stock", "ei", "push_pull", "reciprocity_p", "development_note"):
            form.optional(name, ROLL_RULES[name])
        for name in ("format", "kind"):
            if name in body and body[name] != roll[name]:
                form.fail(name, "format_kind_change")
        if "curve_roll_id" in body and (not linkable or (linked_id is not None and roll["kind"] == "test")):
            form.fail("curve_roll_id")
        values = form.done()
        if "curve_roll_id" in body:
            values["curve_roll_id"] = linked_id
        if values:
            names = list(values)
            assignments = ", ".join(f"{name} = ${index}" for index, name in enumerate(names, start=2))
            await connection.execute(f"UPDATE rolls SET {assignments} WHERE id = $1", roll_id, *values.values())
        roll = await owned_roll(connection, account.id, roll_id)
        return respond(roll_view(await load_context(connection, roll)))


async def list_entries(request: Request) -> JSONResponse:
    account = await require_account(request)
    async with request.app.state.db.connection() as connection:
        roll = await owned_roll(connection, account.id, parse_id(request.path_params["roll_id"]))
        ctx = await load_context(connection, roll)
        return respond({"entries": [entry_view(ctx, entry) for entry in ctx.entries]})


async def _check_counter_free(connection: asyncpg.Connection, roll_id: uuid.UUID, counter: int,
                              own_id: uuid.UUID | None) -> None:
    taken = await connection.fetchval("SELECT id FROM entries WHERE roll_id = $1 AND counter = $2", roll_id, counter)
    if taken is not None and taken != own_id:
        raise ApiError(409, "counter_taken")


async def create_entry(request: Request) -> JSONResponse:
    account = await require_account(request)
    roll_id = parse_id(request.path_params["roll_id"])
    async with request.app.state.db.connection() as connection:
        roll = await owned_roll(connection, account.id, roll_id)
        body = await read_json(request)
        form = Form(body)
        for name, rule in ENTRY_RULES.items():
            form.field(name, rule, ENTRY_DEFAULTS.get(name, REQUIRED))
        if "counter" not in form.errors:
            await _check_counter_free(connection, roll["id"], form.values["counter"], None)
        values = form.done()
        entry_id = uuid.uuid4()
        try:
            await connection.execute(
                "INSERT INTO entries (id, roll_id, counter, aperture, shutter, metered_ev, note, misfire)"
                " VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", entry_id, roll_id, values["counter"], values["aperture"],
                values["shutter"], values["metered_ev"], values["note"], values["misfire"])
        except asyncpg.UniqueViolationError as error:
            raise ApiError(409, "counter_taken") from error
        ctx = await load_context(connection, roll)
        return respond(entry_view(ctx, next(e for e in ctx.entries if e["id"] == entry_id)), 201)


async def update_entry(request: Request) -> JSONResponse:
    account = await require_account(request)
    async with request.app.state.db.connection() as connection:
        entry = await owned_entry(connection, account.id, parse_id(request.path_params["entry_id"]))
        body = await read_json(request)
        form = Form(body)
        for name, rule in ENTRY_RULES.items():
            form.optional(name, rule)
        if "counter" in form.values:
            await _check_counter_free(connection, entry["roll_id"], form.values["counter"], entry["id"])
        values = form.done()
        if values:
            names = list(values)
            assignments = ", ".join(f"{name} = ${index}" for index, name in enumerate(names, start=2))
            try:
                await connection.execute(f"UPDATE entries SET {assignments} WHERE id = $1", entry["id"], *values.values())
            except asyncpg.UniqueViolationError as error:
                raise ApiError(409, "counter_taken") from error
        roll = await owned_roll(connection, account.id, entry["roll_id"])
        ctx = await load_context(connection, roll)
        return respond(entry_view(ctx, next(e for e in ctx.entries if e["id"] == entry["id"])))


async def delete_entry(request: Request) -> Response:
    account = await require_account(request)
    async with request.app.state.db.transaction() as connection:
        entry = await owned_entry(connection, account.id, parse_id(request.path_params["entry_id"]))
        await connection.execute("UPDATE rolls SET alignment_slip = NULL WHERE id = $1 AND alignment_slip = $2",
                                 entry["roll_id"], entry["counter"])
        await connection.execute("DELETE FROM entries WHERE id = $1", entry["id"])
    return Response(status_code=204)


async def contact_sheet(request: Request) -> JSONResponse:
    account = await require_account(request)
    async with request.app.state.db.connection() as connection:
        roll = await owned_roll(connection, account.id, parse_id(request.path_params["roll_id"]))
        ctx = await load_context(connection, roll)
        frames = [frame for scan in ctx.scans for frame in frames_view(ctx, scan["id"])]
        return respond({"counters": ctx.counters, "frames": sorted(frames, key=lambda f: f["number"]),
                        "entries": [entry_view(ctx, entry) for entry in ctx.entries]})


async def roll_curve(request: Request) -> JSONResponse:
    account = await require_account(request)
    async with request.app.state.db.connection() as connection:
        roll = await owned_roll(connection, account.id, parse_id(request.path_params["roll_id"]))
        ctx = await load_context(connection, roll)
        curve_roll_id, curve = await curve_for(connection, ctx)
        bias = None
        if roll["kind"] == "normal" and curve is not None and curve.ready:
            bias = curves.meter_bias(curve, brackets(ctx, skip_unexposed=True))
        return respond(curve_body(curve, curve_roll_id, bias))

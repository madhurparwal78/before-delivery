"""The roll's alignment: the proposal, the saved offset, slip and overrides, and the versioned save."""

import uuid
from typing import Any

import asyncpg
from starlette.requests import Request
from starlette.responses import JSONResponse

from . import alignment
from .alignment import OFFSET_RANGE
from .context import RollContext, frame_rows, load_context, note_rows, owned_roll
from .errors import ApiError, not_found, validation_failed
from .http import parse_id, read_json, require_account, respond
from .views import proposal_body
from .validation import MESSAGES


def alignment_body(ctx: RollContext) -> dict[str, Any]:
    roll = ctx.roll
    counter_of = {str(e["id"]): e["counter"] for e in ctx.entries}
    overrides = sorted(ctx.overrides.items(), key=lambda item: counter_of[item[0]])
    return {"version": roll["alignment_version"], "offset": roll["alignment_offset"],
            "slip_after": roll["alignment_slip"], "source": roll["alignment_source"],
            "overrides": [{"entry_id": entry_id, "frame_id": frame_id} for entry_id, frame_id in overrides],
            "proposal": roll["proposal"], "counters": ctx.counters}


async def get_alignment(request: Request) -> JSONResponse:
    account = await require_account(request)
    async with request.app.state.db.connection() as connection:
        roll = await owned_roll(connection, account.id, parse_id(request.path_params["roll_id"]))
        return respond(alignment_body(await load_context(connection, roll)))


async def propose_alignment(request: Request) -> JSONResponse:
    account = await require_account(request)
    roll_id = parse_id(request.path_params["roll_id"])
    async with request.app.state.db.connection() as connection:
        roll = await owned_roll(connection, account.id, roll_id)
        await read_json(request)
        ctx = await load_context(connection, roll)
        if not ctx.frames:
            raise ApiError(409, "no_frames")
        body = proposal_body(alignment.propose(note_rows(ctx), frame_rows(ctx)))
        await connection.execute("UPDATE rolls SET proposal = $2 WHERE id = $1", roll_id, body)
        return respond(body)


async def _checked_overrides(connection: asyncpg.Connection, account_id: uuid.UUID, ctx: RollContext,
                             raw: Any) -> list[tuple[uuid.UUID, uuid.UUID | None]] | None:
    """Overrides from the body. Ids that are not the account's are not found; ids from another roll or repeated
    ones make the list invalid (None)."""
    if not isinstance(raw, list):
        return None
    pairs, valid = [], True
    for item in raw:
        if not isinstance(item, dict) or not isinstance(item.get("entry_id"), str):
            return None
        entry_id = parse_id(item["entry_id"])
        row = await connection.fetchrow("SELECT e.roll_id FROM entries e JOIN rolls r ON r.id = e.roll_id"
                                        " WHERE e.id = $1 AND r.account_id = $2", entry_id, account_id)
        frame_id = item.get("frame_id")
        frame_row = None
        if frame_id is not None:
            if not isinstance(frame_id, str):
                return None
            frame_id = parse_id(frame_id)
            frame_row = await connection.fetchrow(
                "SELECT s.roll_id FROM frames f JOIN scans s ON s.id = f.scan_id JOIN rolls r ON r.id = s.roll_id"
                " WHERE f.id = $1 AND r.account_id = $2", frame_id, account_id)
            if frame_row is None:
                raise not_found()
            valid = valid and frame_row["roll_id"] == ctx.roll["id"]
        if row is None:
            raise not_found()
        valid = valid and row["roll_id"] == ctx.roll["id"]
        pairs.append((entry_id, frame_id))
    entries = [e for e, _ in pairs]
    frames = [f for _, f in pairs if f is not None]
    if not valid or len(set(entries)) != len(entries) or len(set(frames)) != len(frames):
        return None
    return pairs


async def save_alignment(request: Request) -> JSONResponse:
    """Save offset, slip and overrides naming the version they were based on. The roll row is locked, so of
    simultaneous saves on one version exactly one succeeds and the rest see the stale-alignment refusal."""
    account = await require_account(request)
    roll_id = parse_id(request.path_params["roll_id"])
    db = request.app.state.db
    async with db.connection() as connection:
        roll = await owned_roll(connection, account.id, roll_id)
    body = await read_json(request)
    version = body.get("version")
    if isinstance(version, bool) or not isinstance(version, int):
        raise validation_failed({"version": MESSAGES["version"]})
    async with db.transaction() as connection:
        await connection.execute("SELECT id FROM rolls WHERE id = $1 FOR UPDATE", roll_id)
        roll = await owned_roll(connection, account.id, roll_id)
        ctx = await load_context(connection, roll)
        overrides = await _checked_overrides(connection, account.id, ctx, body.get("overrides", []))
        if roll["alignment_version"] != version:
            raise ApiError(412, "stale_alignment", version=roll["alignment_version"])
        if not ctx.frames:
            raise ApiError(409, "no_frames")
        if any(s["state"] in ("stored", "calibrated") for s in ctx.scans):
            raise ApiError(409, "unframed_scans")
        if any(f["flag"] == "flagged" for f in ctx.frames):
            raise ApiError(409, "flagged_frames")
        errors = {}
        offset, slip = body.get("offset"), body.get("slip_after")
        if isinstance(offset, bool) or not isinstance(offset, int) or not OFFSET_RANGE[0] <= offset <= OFFSET_RANGE[1]:
            errors["offset"] = MESSAGES["offset"]
        counters = {e["counter"] for e in ctx.entries}
        if slip is not None and (isinstance(slip, bool) or slip not in counters):
            errors["slip_after"] = MESSAGES["slip_after"]
        if overrides is None:
            errors["overrides"] = MESSAGES["overrides"]
        if errors:
            raise validation_failed(errors)
        proposal = roll["proposal"]
        source = "proposed" if proposal and (proposal["proposed_offset"], proposal["proposed_slip_after"]) == (offset, slip) \
            else "manual"
        await connection.execute(
            "UPDATE rolls SET alignment_version = alignment_version + 1, alignment_offset = $2, alignment_slip = $3,"
            " alignment_source = $4, alignment_saved_at = now() WHERE id = $1", roll_id, offset, slip, source)
        await connection.execute("DELETE FROM overrides WHERE roll_id = $1", roll_id)
        for entry_id, frame_id in overrides:
            await connection.execute("INSERT INTO overrides (entry_id, roll_id, frame_id) VALUES ($1, $2, $3)",
                                     entry_id, roll_id, frame_id)
        await connection.execute(
            "UPDATE scans SET state = 'aligned' WHERE roll_id = $1 AND state = 'framed'", roll_id)
        roll = await owned_roll(connection, account.id, roll_id)
        return respond(alignment_body(await load_context(connection, roll)))

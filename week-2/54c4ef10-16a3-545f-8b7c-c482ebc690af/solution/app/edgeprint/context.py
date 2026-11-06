"""Everything derived about a roll on each read: owned lookups, stops, matches, counters, state, curve, meter bias."""

import uuid
from dataclasses import dataclass
from typing import Any

import asyncpg

from . import alignment, curves
from .alignment import FrameRow, NoteRow, Saved
from .errors import not_found
from .exposure import parse_shutter, relative_stops


async def owned_roll(connection: asyncpg.Connection, account_id: uuid.UUID, roll_id: uuid.UUID) -> asyncpg.Record:
    row = await connection.fetchrow("SELECT * FROM rolls WHERE id = $1 AND account_id = $2", roll_id, account_id)
    if row is None:
        raise not_found()
    return row


async def owned_entry(connection: asyncpg.Connection, account_id: uuid.UUID, entry_id: uuid.UUID) -> asyncpg.Record:
    row = await connection.fetchrow(
        "SELECT e.* FROM entries e JOIN rolls r ON r.id = e.roll_id WHERE e.id = $1 AND r.account_id = $2",
        entry_id, account_id)
    if row is None:
        raise not_found()
    return row


async def owned_scan(connection: asyncpg.Connection, account_id: uuid.UUID, scan_id: uuid.UUID,
                     lock: bool = False) -> asyncpg.Record:
    row = await connection.fetchrow(
        "SELECT s.* FROM scans s JOIN rolls r ON r.id = s.roll_id WHERE s.id = $1 AND r.account_id = $2"
        + (" FOR UPDATE OF s" if lock else ""), scan_id, account_id)
    if row is None:
        raise not_found()
    return row


async def owned_frame(connection: asyncpg.Connection, account_id: uuid.UUID, frame_id: uuid.UUID) -> asyncpg.Record:
    row = await connection.fetchrow(
        "SELECT f.* FROM frames f JOIN scans s ON s.id = f.scan_id JOIN rolls r ON r.id = s.roll_id"
        " WHERE f.id = $1 AND r.account_id = $2", frame_id, account_id)
    if row is None:
        raise not_found()
    return row


def stops_of(roll: asyncpg.Record, entry: asyncpg.Record) -> float:
    """Unrounded relative stops of an entry under its roll's current EI and reciprocity exponent."""
    seconds = parse_shutter(entry["shutter"])
    return relative_stops(entry["metered_ev"], roll["ei"], entry["aperture"], seconds, float(roll["reciprocity_p"]))


@dataclass(slots=True)
class RollContext:
    roll: asyncpg.Record
    entries: list[asyncpg.Record]
    scans: list[asyncpg.Record]
    frames: list[asyncpg.Record]
    overrides: dict[str, str | None]
    matched: dict[str, tuple[str | None, str]]

    @property
    def counters(self) -> dict[str, int]:
        return alignment.counters([_frame_row(f) for f in self.frames], self.matched)

    def frame_by_id(self) -> dict[str, asyncpg.Record]:
        return {str(frame["id"]): frame for frame in self.frames}


def _frame_row(frame: asyncpg.Record) -> FrameRow:
    return FrameRow(str(frame["id"]), frame["number"], frame["net_density"], frame["unexposed"])


async def load_context(connection: asyncpg.Connection, roll: asyncpg.Record) -> RollContext:
    entries = await connection.fetch("SELECT * FROM entries WHERE roll_id = $1 ORDER BY counter", roll["id"])
    scans = await connection.fetch("SELECT * FROM scans WHERE roll_id = $1 ORDER BY position", roll["id"])
    frames = await connection.fetch(
        "SELECT f.*, s.position AS scan_position FROM frames f JOIN scans s ON s.id = f.scan_id"
        " WHERE s.roll_id = $1 ORDER BY f.number", roll["id"])
    override_rows = await connection.fetch("SELECT entry_id, frame_id FROM overrides WHERE roll_id = $1", roll["id"])
    overrides = {str(row["entry_id"]): str(row["frame_id"]) if row["frame_id"] else None for row in override_rows}
    saved = Saved(roll["alignment_offset"], roll["alignment_slip"], overrides)
    notes = [NoteRow(str(e["id"]), e["counter"], stops_of(roll, e), e["misfire"]) for e in entries]
    matched = alignment.match(notes, [_frame_row(f) for f in frames], saved)
    return RollContext(roll, list(entries), list(scans), list(frames), overrides, matched)


def note_rows(ctx: RollContext) -> list[NoteRow]:
    return [NoteRow(str(e["id"]), e["counter"], stops_of(ctx.roll, e), e["misfire"]) for e in ctx.entries]


def frame_rows(ctx: RollContext) -> list[FrameRow]:
    return [_frame_row(f) for f in ctx.frames]


def brackets(ctx: RollContext, skip_unexposed: bool = False) -> list[curves.Bracket]:
    """Matched, non-misfire notes with their frame's net density."""
    by_frame = ctx.frame_by_id()
    result = []
    for entry in ctx.entries:
        frame_id = ctx.matched[str(entry["id"])][0]
        if entry["misfire"] or frame_id is None:
            continue
        frame = by_frame[frame_id]
        if skip_unexposed and frame["unexposed"]:
            continue
        result.append(curves.Bracket(stops_of(ctx.roll, entry), frame["net_density"]))
    return result


def curve_of_test_roll(ctx: RollContext) -> curves.Curve:
    base_fogs = [s["base_fog"] for s in ctx.scans if s["base_fog"] is not None]
    return curves.build_curve(brackets(ctx), base_fogs)


async def curve_for(connection: asyncpg.Connection, ctx: RollContext) -> tuple[uuid.UUID | None, curves.Curve | None]:
    """(curve roll id, the curve) that applies to the roll: its own when a test roll, else its linked test roll's."""
    if ctx.roll["kind"] == "test":
        return ctx.roll["id"], curve_of_test_roll(ctx)
    linked_id = ctx.roll["curve_roll_id"]
    if linked_id is None:
        return None, None
    linked = await connection.fetchrow("SELECT * FROM rolls WHERE id = $1", linked_id)
    return linked_id, curve_of_test_roll(await load_context(connection, linked))


def roll_state(ctx: RollContext, own_curve: curves.Curve | None) -> str:
    if ctx.roll["kind"] == "test":
        return "curve-ready" if own_curve is not None and own_curve.ready else "logging"
    if ctx.roll["alignment_version"] > 0 and ctx.entries and all(
            frame_id is not None or kind == "unmatched" for frame_id, kind in ctx.matched.values()):
        return "aligned"
    return "developed" if ctx.scans else "logging"


def strongest_frame_id(ctx: RollContext) -> str | None:
    best = None
    for frame in ctx.frames:
        if best is None or frame["net_density"] > best["net_density"]:
            best = frame
    return str(best["id"]) if best else None


async def latest_aligned_frame(connection: asyncpg.Connection, account_id: uuid.UUID) -> dict[str, Any] | None:
    """The lowest-numbered matched frame in the account's most recently saved alignment."""
    roll = await connection.fetchrow(
        "SELECT * FROM rolls WHERE account_id = $1 AND alignment_version > 0 ORDER BY alignment_saved_at DESC LIMIT 1",
        account_id)
    if roll is None:
        return None
    ctx = await load_context(connection, roll)
    by_frame = ctx.frame_by_id()
    matched = [by_frame[frame_id] for frame_id, _ in ctx.matched.values() if frame_id is not None]
    if not matched:
        return None
    frame = min(matched, key=lambda f: f["number"])
    return {"frame_id": str(frame["id"]), "scan_id": str(frame["scan_id"]), "x0": frame["x0"], "x1": frame["x1"]}

"""Analyst writes on a window: meter pull, gap repair, substitution, spread, merit order, exclusion,
allocation, holdings sync, submission and resume. Each is one transaction under the window's row lock
that raises the revision once; provider calls happen outside the transaction."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta
from typing import TypeVar

import asyncpg

from .allocation import Lot
from .clock import format_hour, format_instant, parse_hour
from .config import parse_instant
from .desk import MAX_REASON, MAX_WH, Desk, User, field_errors, is_whole, text_ok
from .errors import ApiError
from .jsontypes import JsonObject
from .providers import ProviderDown
from .repository import Window, movement, record_ledger
from .rules import (
    UnreadableReading,
    allocation_digest,
    consecutive,
    draw_sample,
    repair_gaps,
    spread_shares,
    watt_hours,
)
from .timeutil import HOUR, cancel_by, months_touched, utc_month
from .views import line_json, lot_json, sorted_lines, window_json

ANALYST = ("analyst",)
RECONCILING = ("Reconciling",)
HUB_DOWN = "METER HUB IS DOWN. NO READINGS CHANGED."
REGISTRY_DOWN_ON_SYNC = "REGISTRY IS DOWN. HOLDINGS ARE UNCHANGED."
MAX_SPREAD_HOURS = 168
INTERVALS = (60, 30, 15)
T = TypeVar("T")


Change = Callable[[asyncpg.Connection, Window], Awaitable[T]]


async def _write(
    desk: Desk,
    user: User,
    window_id: str,
    states: tuple[str, ...],
    body: JsonObject,
    apply: Change[T],
    *,
    state: str | None = None,
) -> T:
    """Lock the window, apply a change, raise the revision once and recompute the allocation."""
    async with desk.pool.acquire() as connection:
        async with connection.transaction():
            window = await desk.locked_window(connection, user, window_id, roles=ANALYST, states=states)
            desk.check_revision(window, body)
            result = await apply(connection, window)
            await desk.settle_write(connection, window_id, user, **({"state": state} if state else {}))
    return result


# ---- meter pull ---------------------------------------------------------------------------------------------


def parse_readings(runs: list[object], first: datetime, end: datetime) -> dict[datetime, int]:
    """Complete hourly watt-hours from the hub's runs; a line that is not a whole watt-hour refuses the pull."""
    readings: dict[datetime, tuple[int, int]] = {}
    for number, run in enumerate(runs, start=1):
        if (
            not isinstance(run, dict)
            or not is_whole(run.get("interval_minutes"))
            or not is_whole(run.get("count"))
            or run["interval_minutes"] not in INTERVALS
            or run["count"] < 0
            or not isinstance(run.get("start"), str)
        ):
            raise ProviderDown
        try:
            start = parse_instant(run["start"])
            wh = watt_hours(run.get("unit"), run.get("value"))
        except (ValueError, UnreadableReading) as error:
            raise ProviderDown from error
        if wh is None:
            raise ApiError("NOT_WHOLE_WATT_HOUR", f"Line {number} is not a whole watt-hour.")
        step = timedelta(minutes=run["interval_minutes"])
        lowest = max(0, -int((start - first) / step) - 1)
        for index in range(lowest, min(run["count"], int((end - start) / step) + 1)):
            moment = start + step * index
            if first <= moment < end:
                readings[moment] = (run["interval_minutes"], wh)
    hours: dict[datetime, int] = {}
    hour = first
    while hour < end:
        for interval in INTERVALS:
            parts = [readings.get(hour + timedelta(minutes=interval * k)) for k in range(60 // interval)]
            if all(part is not None and part[0] == interval for part in parts):
                hours[hour] = sum(part[1] for part in parts if part is not None)
                break
        hour += HOUR
    return hours


async def pull_meters(desk: Desk, user: User, window_id: str, body: JsonObject) -> JsonObject:
    states = ("Awaiting meters", "Reconciling")
    async with desk.pool.acquire() as connection:
        async with connection.transaction():
            window = await desk.locked_window(connection, user, window_id, roles=ANALYST, states=states)
            desk.check_revision(window, body)
            if desk.now() < window.opens_at:
                raise ApiError("WINDOW_NOT_OPEN", f"This window opens at {format_instant(window.opens_at)}.")
            field_errors(revision=is_whole(body.get("revision")))
            first, end = window.bounds
            meter = window.columns["meter_id"]
    try:
        runs = await desk.hub.readings(meter, first, end)
        hours = parse_readings(runs, first, end)
    except ProviderDown as error:
        raise ApiError("METER_HUB_UNAVAILABLE", HUB_DOWN) from error

    async def apply(connection: asyncpg.Connection, window: Window) -> int:
        stored = {row.hour: row for row in window.hours}
        changes = [(window_id, hour, wh) for hour, wh in hours.items() if stored[hour].version == 0]
        await connection.executemany(
            "UPDATE hours SET consumed_wh = $3, quality = 'Actual', reason = NULL WHERE window_id = $1 AND hour_utc = $2",
            changes,
        )
        return len(hours)

    read = await _write(desk, user, window_id, states, body, apply, state="Reconciling")
    return {**await desk.window_view(window_id), "hours_read": read}


# ---- repair, substitution, spread ---------------------------------------------------------------------------


async def repair(desk: Desk, user: User, window_id: str, body: JsonObject) -> JsonObject:
    outcome: dict[str, list[datetime]] = {}

    async def apply(connection: asyncpg.Connection, window: Window) -> None:
        field_errors(revision=is_whole(body.get("revision")))
        filled = repair_gaps(window.hours, window.time_zone)
        await connection.executemany(
            "UPDATE hours SET consumed_wh = $3, quality = 'Estimated', reason = NULL WHERE window_id = $1 AND hour_utc = $2",
            [(window_id, hour, wh) for hour, wh in filled.items()],
        )
        outcome["filled"] = sorted(filled)
        outcome["unfilled"] = [row.hour for row in window.hours if row.quality == "Missing" and row.hour not in filled]

    await _write(desk, user, window_id, RECONCILING, body, apply)
    return {
        "filled": [format_hour(hour) for hour in outcome["filled"]],
        "unfilled": [format_hour(hour) for hour in outcome["unfilled"]],
        "window": await desk.window_view(window_id),
    }


async def substitute(desk: Desk, user: User, window_id: str, hour_text: str, body: JsonObject) -> JsonObject:
    hour = parse_hour(hour_text)

    async def apply(connection: asyncpg.Connection, window: Window) -> None:
        if hour is None or hour not in window.rows:
            raise ApiError("NOT_FOUND")
        if window.rows[hour].quality == "Actual":
            raise ApiError("HOUR_IS_ACTUAL")
        value = body.get("value_wh")
        field_errors(
            revision=is_whole(body.get("revision")),
            value_wh=is_whole(value) and 0 <= value <= MAX_WH,
            reason=text_ok(body.get("reason"), MAX_REASON),
        )
        await connection.execute(
            "UPDATE hours SET consumed_wh = $3, quality = 'Substituted', reason = $4 WHERE window_id = $1 AND hour_utc = $2",
            window_id,
            hour,
            value,
            body["reason"],
        )

    await _write(desk, user, window_id, RECONCILING, body, apply)
    return await desk.window_view(window_id)


def _spread_hours(raw: object) -> list[datetime] | None:
    if not isinstance(raw, list):
        return None
    parsed = [parse_hour(text) for text in raw]
    return None if any(hour is None for hour in parsed) else [hour for hour in parsed if hour is not None]


async def spread(desk: Desk, user: User, window_id: str, body: JsonObject) -> JsonObject:
    hours = _spread_hours(body.get("hours"))

    async def apply(connection: asyncpg.Connection, window: Window) -> None:
        shape_ok = hours is not None and 2 <= len(hours) <= MAX_SPREAD_HOURS and consecutive(hours)
        if hours is not None:
            if any(hour not in window.rows for hour in hours):
                raise ApiError("NOT_FOUND")
            if shape_ok and any(window.rows[hour].quality not in ("Missing", "Estimated") for hour in hours):
                raise ApiError("HOUR_NOT_SPREADABLE")
        total = body.get("total_wh")
        field_errors(
            revision=is_whole(body.get("revision")),
            hours=shape_ok,
            total_wh=is_whole(total) and 0 <= total <= MAX_WH,
            reason=text_ok(body.get("reason"), MAX_REASON),
        )
        assert hours is not None
        shares = spread_shares(hours, total, window.rows, window.time_zone)
        await connection.executemany(
            "UPDATE hours SET consumed_wh = $3, quality = 'Substituted', reason = $4 WHERE window_id = $1 AND hour_utc = $2",
            [(window_id, hour, share, body["reason"]) for hour, share in zip(hours, shares, strict=False)],
        )

    await _write(desk, user, window_id, RECONCILING, body, apply)
    return await desk.window_view(window_id)


# ---- merit order, exclusion, allocation ---------------------------------------------------------------------


async def lots_payload(desk: Desk, window_id: str) -> JsonObject:
    window = await desk.settled_window(window_id)
    ctx = desk.context()
    return {"lots": lot_json(window, window.allocation(ctx.now), ctx), "window": window_json(window, ctx)}


async def reorder(desk: Desk, user: User, window_id: str, body: JsonObject) -> JsonObject:
    async def apply(connection: asyncpg.Connection, window: Window) -> None:
        wanted = body.get("lot_ids")
        ids = [lot.id for lot in window.lots]
        if isinstance(wanted, list) and any(isinstance(lot_id, str) and lot_id not in ids for lot_id in wanted):
            raise ApiError("NOT_FOUND")
        valid = (
            isinstance(wanted, list)
            and all(isinstance(lot_id, str) for lot_id in wanted)
            and len(wanted) == len(ids)
            and set(wanted) == set(ids)
        )
        field_errors(revision=is_whole(body.get("revision")), lot_ids=valid)
        await connection.executemany(
            "UPDATE lots SET rank = $3 WHERE window_id = $1 AND id = $2",
            [(window_id, lot_id, rank) for rank, lot_id in enumerate(wanted, start=1)],
        )

    await _write(desk, user, window_id, RECONCILING, body, apply)
    return await lots_payload(desk, window_id)


async def set_exclusion(desk: Desk, user: User, window_id: str, lot_id: str, body: JsonObject) -> JsonObject:
    async def apply(connection: asyncpg.Connection, window: Window) -> None:
        if lot_id not in {lot.id for lot in window.lots}:
            raise ApiError("NOT_FOUND")
        excluded = body.get("excluded")
        field_errors(revision=is_whole(body.get("revision")), excluded=isinstance(excluded, bool))
        await connection.execute(
            "UPDATE lots SET excluded = $3 WHERE window_id = $1 AND id = $2", window_id, lot_id, excluded
        )

    await _write(desk, user, window_id, RECONCILING, body, apply)
    payload = await lots_payload(desk, window_id)
    return {"lot": next(lot for lot in payload["lots"] if lot["id"] == lot_id), "window": payload["window"]}


async def rerun(desk: Desk, user: User, window_id: str, body: JsonObject) -> JsonObject:
    async def apply(connection: asyncpg.Connection, window: Window) -> None:
        field_errors(revision=is_whole(body.get("revision")))

    await _write(desk, user, window_id, RECONCILING, body, apply)
    window = await desk.settled_window(window_id)
    lines = [line for line in sorted_lines(window.lines) if line.status != "Rejected"]
    return {
        "lines": [line_json(line) for line in lines],
        "allocation_digest": allocation_digest(lines),
        "window": window_json(window, desk.context()),
    }


# ---- holdings sync ------------------------------------------------------------------------------------------


def _registry_bundle(raw: object) -> JsonObject:
    """A holdings bundle with every field checked; anything else is an unreadable registry answer."""
    texts = ("bundle_id", "lot_ref", "lot_name", "technology", "zone")
    if not isinstance(raw, dict) or not all(isinstance(raw.get(key), str) and raw[key] for key in texts):
        raise ProviderDown
    production, discharge = parse_hour(raw.get("production_hour")), parse_hour(raw.get("discharge_hour"))
    if (
        production is None
        or (raw.get("discharge_hour") is not None and discharge is None)
        or not isinstance(raw.get("battery_shifted"), bool)
        or not is_whole(raw.get("range_start_wh"))
        or not is_whole(raw.get("range_end_wh"))
        or not 0 <= raw["range_start_wh"] < raw["range_end_wh"]
    ):
        raise ProviderDown
    return {
        **{key: raw[key] for key in texts},
        "production_hour": production,
        "discharge_hour": discharge,
        "battery_shifted": raw["battery_shifted"],
        "start": raw["range_start_wh"],
        "end": raw["range_end_wh"],
    }


SYNC_LOCK = 7340002


async def sync_holdings(desk: Desk, user: User, window_id: str, body: JsonObject) -> JsonObject:
    async with desk.pool.acquire() as connection:
        async with connection.transaction():
            window = await desk.locked_window(connection, user, window_id, roles=ANALYST, states=RECONCILING)
            desk.check_revision(window, body)
            field_errors(revision=is_whole(body.get("revision")))
            months = months_touched(window.hour_list)
    found: dict[str, JsonObject] = {}
    try:
        for month in months:
            for raw in await desk.registry.holdings(month):
                bundle = _registry_bundle(raw)
                found.setdefault(bundle["bundle_id"], bundle)
    except ProviderDown as error:
        raise ApiError("REGISTRY_UNAVAILABLE", REGISTRY_DOWN_ON_SYNC) from error
    outcome: JsonObject = {"held_elsewhere": []}

    async def apply(connection: asyncpg.Connection, window: Window) -> None:
        await connection.execute("SELECT pg_advisory_xact_lock($1)", SYNC_LOCK)
        held = {bundle.id for bundle in window.bundles}
        lots = {lot.id: lot for lot in window.lots}
        next_rank = max((lot.rank for lot in window.lots), default=0)
        movements = []
        added = 0
        for bundle_id in sorted(found):
            bundle = found[bundle_id]
            if bundle_id in held:
                continue
            if bundle["zone"] == window.zone:
                claimed = await connection.fetchrow(
                    "INSERT INTO claims (bundle_id, base_id, window_id) VALUES ($1, $2, $3) "
                    "ON CONFLICT DO NOTHING RETURNING bundle_id",
                    bundle_id,
                    window.columns["base_id"],
                    window_id,
                )
                if claimed is None:
                    claim = await connection.fetchrow(
                        "SELECT base_id, window_id FROM claims WHERE bundle_id = $1", bundle_id
                    )
                    if claim["base_id"] != window.columns["base_id"]:
                        outcome["held_elsewhere"].append({"bundle_id": bundle_id, "window_id": claim["window_id"]})
                        continue
            lot_id = bundle["lot_ref"]
            if lot_id not in lots:
                next_rank += 1
                await connection.execute(
                    "INSERT INTO lots (window_id, id, name, technology, zone, rank, excluded, battery_shifted, "
                    "production_month) VALUES ($1,$2,$3,$4,$5,$6,false,$7,$8)",
                    window_id,
                    lot_id,
                    bundle["lot_name"],
                    bundle["technology"],
                    bundle["zone"],
                    next_rank,
                    bundle["battery_shifted"],
                    utc_month(bundle["production_hour"]),
                )
                lots[lot_id] = _new_lot(lot_id, bundle, next_rank)
            await connection.execute(
                "INSERT INTO bundles (window_id, id, lot_id, production_hour, discharge_hour, battery_shifted, "
                "range_start, range_end) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
                window_id,
                bundle_id,
                lot_id,
                bundle["production_hour"],
                bundle["discharge_hour"],
                bundle["battery_shifted"],
                bundle["start"],
                bundle["end"],
            )
            movements.append(
                movement(
                    "deposit",
                    "registry",
                    "holdings",
                    bundle["end"] - bundle["start"],
                    window_id,
                    f"Deposit {lots[lot_id].name}",
                    lot_id=lot_id,
                    bundle_id=bundle_id,
                )
            )
            added += 1
        await record_ledger(connection, movements, desk.now())
        outcome["added"] = added

    await _write(desk, user, window_id, RECONCILING, body, apply)
    window = await desk.settled_window(window_id)
    return {
        "added": outcome["added"],
        "opening_wh": sum(bundle.gross for bundle in window.bundles),
        "held_elsewhere": outcome["held_elsewhere"],
        "window": window_json(window, desk.context()),
    }


def _new_lot(lot_id: str, bundle: JsonObject, rank: int) -> Lot:
    return Lot(
        lot_id,
        bundle["lot_name"],
        bundle["technology"],
        bundle["zone"],
        rank,
        False,
        bundle["battery_shifted"],
        utc_month(bundle["production_hour"]),
    )


# ---- submission and resume ----------------------------------------------------------------------------------


async def submit(desk: Desk, user: User, window_id: str, body: JsonObject) -> JsonObject:
    async with desk.pool.acquire() as connection:
        async with connection.transaction():
            window = await desk.locked_window(connection, user, window_id, roles=ANALYST, states=RECONCILING)
            desk.check_revision(window, body)
            if window.columns["firm_id"] is None:
                raise ApiError("NO_VERIFIER")
            missing = sum(1 for row in window.hours if row.quality == "Missing")
            if missing:
                raise ApiError("HOURS_MISSING", f"{missing} hours are still Missing. Fix them first.")
            field_errors(revision=is_whole(body.get("revision")))
            now = desk.now()
            digest = allocation_digest(window.lines)
            if window.columns["sample_digest"] != digest:
                await connection.execute("DELETE FROM samples WHERE window_id = $1", window_id)
                drawn = draw_sample(window_id, digest, [row.hour for row in window.hours if (row.consumed or 0) > 0])
                await connection.executemany(
                    "INSERT INTO samples (window_id, hour_utc, position) VALUES ($1,$2,$3)",
                    [(window_id, hour, position) for position, hour in enumerate(drawn)],
                )
            unsent = {line.lot_id for line in window.lines if line.status == "Unsubmitted"}
            limits = [cancel_by(lot.production_month) for lot in window.lots if lot.id in unsent]
            deadline = min([now + timedelta(seconds=desk.settings.review_seconds), *limits])
            await desk.bump(
                connection,
                window_id,
                user,
                state="In review",
                submitted_at=now,
                sample_digest=digest,
                review_deadline=deadline,
            )
    return await desk.window_view(window_id)


async def resume(desk: Desk, user: User, window_id: str, body: JsonObject) -> JsonObject:
    async with desk.pool.acquire() as connection:
        async with connection.transaction():
            window = await desk.locked_window(connection, user, window_id, roles=ANALYST, states=("Returned",))
            desk.check_revision(window, body)
            field_errors(revision=is_whole(body.get("revision")))
            await desk.bump(connection, window_id, user, state="Reconciling", returned_reason=None)
    return await desk.window_view(window_id)

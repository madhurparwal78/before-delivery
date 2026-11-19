"""Late meter corrections: versioned, applied in place while Reconciling, and a Sealed window becomes
Restated with exactly one successor that keeps the base window id."""

from __future__ import annotations

from datetime import datetime

import asyncpg

from .clock import format_hour, parse_hour
from .desk import Desk, User, is_whole
from .errors import ApiError
from .jsontypes import JsonObject
from .providers import ProviderDown
from .repository import Window, apply_allocation, load_window, load_windows, movement, record_ledger
from .rules import UnreadableReading, watt_hours

CORRECTION_LOCK = 7340004
HUB_DOWN = "METER HUB IS DOWN. NO READINGS CHANGED."


def parse_corrections(raw: list[object]) -> list[JsonObject]:
    """Corrections with exact watt-hours; the lowest-numbered bad line refuses the whole pull."""
    lines: list[JsonObject] = []
    seen: dict[tuple[datetime, int], int] = {}
    for number, correction in enumerate(raw, start=1):
        if (
            not isinstance(correction, dict)
            or parse_hour(correction.get("hour_utc")) is None
            or not is_whole(correction.get("version"))
            or correction["version"] < 1
        ):
            raise ProviderDown
        try:
            wh = watt_hours(correction.get("unit"), correction.get("value"))
        except UnreadableReading as error:
            raise ProviderDown from error
        if wh is None:
            raise ApiError("NOT_WHOLE_WATT_HOUR", f"Line {number} is not a whole watt-hour.")
        hour, version = parse_hour(correction["hour_utc"]), correction["version"]
        if seen.setdefault((hour, version), wh) != wh:
            raise ApiError("CONFLICTING_CORRECTION", f"Line {number} conflicts with an earlier line.")
        lines.append({"hour": hour, "version": version, "wh": wh})
    return lines


async def create_successor(
    desk: Desk, connection: asyncpg.Connection, old: Window, user: User, corrections: list[JsonObject]
) -> str:
    """A Reconciling successor with the predecessor's hours, lots, bundles and Confirmed lines."""
    index = old.columns["chain_index"] + 1
    new_id = f"{old.columns['base_id']}-r{index}"
    await connection.execute(
        "INSERT INTO windows (id, site_id, month, base_id, chain_index, state, revision, firm_id, predecessor_id) "
        "VALUES ($1,$2,$3,$4,$5,'Reconciling',1,$6,$7)",
        new_id,
        old.columns["site_id"],
        old.columns["month"],
        old.columns["base_id"],
        index,
        old.columns["firm_id"],
        old.id,
    )
    await connection.execute(
        "INSERT INTO hours SELECT $1, hour_utc, consumed_wh, quality, version, reason FROM hours WHERE window_id = $2",
        new_id,
        old.id,
    )
    await connection.executemany(
        "UPDATE hours SET consumed_wh = $3, quality = 'Actual', version = $4, reason = NULL "
        "WHERE window_id = $1 AND hour_utc = $2",
        [(new_id, correction["hour"], correction["wh"], correction["version"]) for correction in corrections],
    )
    await connection.execute(
        "INSERT INTO lots SELECT $1, id, name, technology, zone, rank, excluded, battery_shifted, "
        "production_month FROM lots WHERE window_id = $2",
        new_id,
        old.id,
    )
    await connection.execute(
        "INSERT INTO bundles SELECT $1, id, lot_id, production_hour, discharge_hour, battery_shifted, range_start, "
        "range_end, loss_wh FROM bundles WHERE window_id = $2",
        new_id,
        old.id,
    )
    await connection.execute(
        "INSERT INTO lines SELECT $1, $1 || '_' || bundle_id || '_' || range_start::text, hour_utc, lot_id, bundle_id, "
        "range_start, range_end, status, reason FROM lines WHERE window_id = $2 AND status = 'Confirmed'",
        new_id,
        old.id,
    )
    names = {lot.id: lot.name for lot in old.lots}
    movements = []
    for bundle in old.bundles:
        movements.append(
            movement(
                "deposit",
                "registry",
                "holdings",
                bundle.gross,
                new_id,
                f"Deposit {names[bundle.lot_id]}",
                lot_id=bundle.lot_id,
                bundle_id=bundle.id,
            )
        )
        if bundle.loss_wh:
            movements.append(
                movement(
                    "battery_loss",
                    "holdings",
                    "loss",
                    bundle.loss_wh,
                    new_id,
                    f"Battery loss {names[bundle.lot_id]}",
                    lot_id=bundle.lot_id,
                    bundle_id=bundle.id,
                )
            )
    for line in old.lines:
        if line.status == "Confirmed":
            line_id = f"{new_id}_{line.bundle_id}_{line.start}"
            for kind, debit, credit, label in (
                ("allocate", "holdings", "allocated", "Allocate"),
                ("cancel", "allocated", "cancelled", "Cancel"),
            ):
                movements.append(
                    movement(
                        kind,
                        debit,
                        credit,
                        line.wh,
                        new_id,
                        f"{label} {line.lot_name}",
                        lot_id=line.lot_id,
                        bundle_id=line.bundle_id,
                        line_id=line_id,
                    )
                )
    await record_ledger(connection, movements, desk.now())
    fresh = await load_window(connection, new_id)
    assert fresh is not None
    await apply_allocation(connection, fresh, desk.now())
    await desk.bump(connection, old.id, user, state="Restated", successor_id=new_id)
    return new_id


async def pull_corrections(desk: Desk, user: User, site_id: str) -> JsonObject:
    site = await desk.pool.fetchrow("SELECT * FROM sites WHERE id = $1", site_id)
    if site is None:
        raise ApiError("NOT_FOUND")
    if user.role != "analyst":
        raise ApiError("FORBIDDEN")
    async with desk.pool.acquire() as connection:
        existing = [window for window in await load_windows(connection) if window.columns["site_id"] == site_id]
    try:
        raw = await desk.hub.corrections(site["meter_id"], min(window.bounds[0] for window in existing))
        corrections = parse_corrections(raw)
    except ProviderDown as error:
        raise ApiError("METER_HUB_UNAVAILABLE", HUB_DOWN) from error
    best: dict[datetime, int] = {}
    for index, correction in enumerate(corrections):
        if correction["hour"] not in best or correction["version"] > corrections[best[correction["hour"]]]["version"]:
            best[correction["hour"]] = index
    applied: list[dict[str, str]] = []
    restated: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    async with desk.pool.acquire() as connection:
        async with connection.transaction():
            await connection.execute("SELECT pg_advisory_xact_lock($1)", CORRECTION_LOCK)
            await desk.settle_reviews(connection)
            windows = await load_windows(connection, [window.id for window in existing], lock=True)
            pending: dict[str, list[JsonObject]] = {}
            newest: dict[datetime, Window] = {}
            for window in windows:
                for hour in window.hour_list:
                    if hour not in newest or newest[hour].columns["chain_index"] < window.columns["chain_index"]:
                        newest[hour] = window
            for index, correction in enumerate(corrections):
                target = newest.get(correction["hour"])
                if target is None:
                    continue
                if (
                    best[correction["hour"]] != index
                    or correction["version"] <= target.rows[correction["hour"]].version
                ):
                    skipped.append({"hour_utc": format_hour(correction["hour"]), "state": "Superseded"})
                elif target.state in ("Reconciling", "Sealed"):
                    pending.setdefault(target.id, []).append(correction)
                else:
                    skipped.append({"hour_utc": format_hour(correction["hour"]), "state": target.state})
            for window in windows:
                applying = pending.get(window.id)
                if not applying:
                    continue
                if window.state == "Reconciling":
                    await connection.executemany(
                        "UPDATE hours SET consumed_wh = $3, quality = 'Actual', version = $4, reason = NULL "
                        "WHERE window_id = $1 AND hour_utc = $2",
                        [
                            (window.id, correction["hour"], correction["wh"], correction["version"])
                            for correction in applying
                        ],
                    )
                    await desk.settle_write(connection, window.id, user)
                    applied += [
                        {"window_id": window.id, "hour_utc": format_hour(correction["hour"])} for correction in applying
                    ]
                elif any(window.rows[correction["hour"]].consumed != correction["wh"] for correction in applying):
                    successor = await create_successor(desk, connection, window, user, applying)
                    restated.append({"window_id": window.id, "successor_id": successor})
                    applied += [
                        {"window_id": successor, "hour_utc": format_hour(correction["hour"])} for correction in applying
                    ]
                else:
                    await connection.executemany(
                        "UPDATE hours SET version = $3 WHERE window_id = $1 AND hour_utc = $2",
                        [(window.id, correction["hour"], correction["version"]) for correction in applying],
                    )
    for window in windows:
        if window.id in pending:
            await desk.settled_window(window.id)
    return {"applied": applied, "restated": restated, "skipped": skipped}

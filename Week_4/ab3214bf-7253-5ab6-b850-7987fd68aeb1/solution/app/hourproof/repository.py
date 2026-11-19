"""Loading a window with everything its figures are computed from, and the shared write helpers."""

from __future__ import annotations

from datetime import datetime, timedelta
from functools import cached_property

import asyncpg

from .allocation import Allocation, Bundle, Line, Lot, allocate
from .jsontypes import JsonObject
from .rules import HourRow
from .scoring import Grains
from .timeutil import month_bounds

OPENING_DELAY = timedelta(hours=48)
WINDOW_COLUMNS = """
    w.*, s.name AS site_name, s.code AS site_code, s.zone, s.time_zone, s.meter_id,
    s.target_grain AS site_target_grain, s.target_bp AS site_target_bp, f.name AS firm_name"""


class Window:
    """One window with its hours, lots, bundles, lines and stored grid factors."""

    def __init__(
        self,
        window_row: asyncpg.Record,
        hours: list[HourRow],
        lots: list[Lot],
        bundles: list[Bundle],
        lines: list[Line],
        factors: dict[datetime, int],
        sample_exception: bool,
    ) -> None:
        self.columns = window_row
        self.hours = hours
        self.lots = sorted(lots, key=lambda lot: lot.rank)
        self.bundles = bundles
        self.lines = lines
        self.factors = factors
        self.sample_exception = sample_exception

    @property
    def id(self) -> str:
        return self.columns["id"]

    @property
    def state(self) -> str:
        return self.columns["state"]

    @property
    def zone(self) -> str:
        return self.columns["zone"]

    @property
    def time_zone(self) -> str:
        return self.columns["time_zone"]

    @cached_property
    def bounds(self) -> tuple[datetime, datetime]:
        return month_bounds(self.time_zone, self.columns["month"])

    @property
    def opens_at(self) -> datetime:
        return self.bounds[1] + OPENING_DELAY

    @cached_property
    def hour_list(self) -> list[datetime]:
        return [row.hour for row in self.hours]

    @cached_property
    def rows(self) -> dict[datetime, HourRow]:
        return {row.hour: row for row in self.hours}

    @cached_property
    def consumption(self) -> dict[datetime, int]:
        return {row.hour: row.consumed or 0 for row in self.hours}

    def allocation(self, now: datetime) -> Allocation:
        return allocate(self.id, self.hour_list, self.consumption, self.lots, self.bundles, self.lines, self.zone, now)

    def grains(self, now: datetime) -> Grains:
        qualities = {row.hour: row.quality for row in self.hours}
        return Grains(self.time_zone, self.hour_list, self.consumption, qualities, self.allocation(now))

    @property
    def review_deadline(self) -> datetime | None:
        return self.columns["review_deadline"] if self.state == "In review" else None


def _lot(row: asyncpg.Record) -> Lot:
    return Lot(
        row["id"],
        row["name"],
        row["technology"],
        row["zone"],
        row["rank"],
        row["excluded"],
        row["battery_shifted"],
        row["production_month"],
    )


def _bundle(row: asyncpg.Record) -> Bundle:
    return Bundle(
        row["id"],
        row["lot_id"],
        row["production_hour"],
        row["discharge_hour"],
        row["battery_shifted"],
        row["range_start"],
        row["range_end"],
        row["loss_wh"],
    )


async def load_windows(
    connection: asyncpg.Connection, ids: list[str] | None = None, *, lock: bool = False
) -> list[Window]:
    """The listed windows (all of them when ids is None), each with the rows its figures need."""
    suffix = " FOR UPDATE OF w" if lock else ""
    if ids is None:
        window_rows = await connection.fetch(
            f"SELECT {WINDOW_COLUMNS} FROM windows w JOIN sites s ON s.id = w.site_id "
            f"LEFT JOIN firms f ON f.id = w.firm_id ORDER BY w.id{suffix}"
        )
    else:
        window_rows = await connection.fetch(
            f"SELECT {WINDOW_COLUMNS} FROM windows w JOIN sites s ON s.id = w.site_id "
            f"LEFT JOIN firms f ON f.id = w.firm_id WHERE w.id = ANY($1) ORDER BY w.id{suffix}",
            ids,
        )
    window_ids = [window_row["id"] for window_row in window_rows]
    hour_rows = await connection.fetch(
        "SELECT window_id, hour_utc, consumed_wh, quality, version, reason FROM hours WHERE window_id = ANY($1) "
        "ORDER BY window_id, hour_utc",
        window_ids,
    )
    lot_rows = await connection.fetch("SELECT * FROM lots WHERE window_id = ANY($1)", window_ids)
    bundle_rows = await connection.fetch("SELECT * FROM bundles WHERE window_id = ANY($1)", window_ids)
    line_rows = await connection.fetch(
        "SELECT l.*, o.name AS lot_name FROM lines l JOIN lots o ON o.window_id = l.window_id AND o.id = l.lot_id "
        "WHERE l.window_id = ANY($1)",
        window_ids,
    )
    factor_rows = await connection.fetch("SELECT zone, hour_utc, g_per_kwh_e4 FROM grid_factors")
    exceptions = {
        row["window_id"]
        for row in await connection.fetch(
            "SELECT DISTINCT window_id FROM samples WHERE result = 'exception' AND window_id = ANY($1)", window_ids
        )
    }
    hours: dict[str, list[HourRow]] = {}
    for row in hour_rows:
        hours.setdefault(row["window_id"], []).append(
            HourRow(row["hour_utc"], row["consumed_wh"], row["quality"], row["version"], row["reason"])
        )
    lots: dict[str, list[Lot]] = {}
    for row in lot_rows:
        lots.setdefault(row["window_id"], []).append(_lot(row))
    bundles: dict[str, list[Bundle]] = {}
    for row in bundle_rows:
        bundles.setdefault(row["window_id"], []).append(_bundle(row))
    lines: dict[str, list[Line]] = {}
    for row in line_rows:
        lines.setdefault(row["window_id"], []).append(
            Line(
                row["id"],
                row["hour_utc"],
                row["lot_id"],
                row["lot_name"],
                row["bundle_id"],
                row["range_start"],
                row["range_end"],
                row["status"],
                row["reason"],
            )
        )
    zone_factors: dict[str, dict[datetime, int]] = {}
    for row in factor_rows:
        zone_factors.setdefault(row["zone"], {})[row["hour_utc"]] = row["g_per_kwh_e4"]
    return [
        Window(
            window_row,
            hours.get(window_row["id"], []),
            lots.get(window_row["id"], []),
            bundles.get(window_row["id"], []),
            lines.get(window_row["id"], []),
            zone_factors.get(window_row["zone"], {}),
            window_row["id"] in exceptions,
        )
        for window_row in window_rows
    ]


async def load_window(connection: asyncpg.Connection, window_id: str, *, lock: bool = False) -> Window | None:
    found = await load_windows(connection, [window_id], lock=lock)
    return found[0] if found else None


async def record_ledger(connection: asyncpg.Connection, movements: list[JsonObject], at: datetime) -> None:
    """Each movement is one equal pair of rows: a debit (negative) then a credit (positive)."""
    if not movements:
        return
    ids = await connection.fetch("SELECT nextval('movement_seq') AS n FROM generate_series(1, $1)", len(movements))
    rows = []
    for movement, identity in zip(movements, ids, strict=False):
        movement_id = f"M{identity['n']:012d}"
        for account, sign in ((movement["debit"], -1), (movement["credit"], 1)):
            rows.append(
                (
                    movement_id,
                    movement["kind"],
                    account,
                    sign * movement["wh"],
                    movement["window_id"],
                    movement.get("lot_id"),
                    movement.get("bundle_id"),
                    movement.get("line_id"),
                    movement["label"],
                    at,
                )
            )
    await connection.executemany(
        "INSERT INTO ledger_entries (movement_id, kind, account, wh, window_id, lot_id, bundle_id, line_id, label, at) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        rows,
    )


def movement(
    kind: str,
    debit: str,
    credit: str,
    wh: int,
    window_id: str,
    label: str,
    *,
    lot_id: str | None = None,
    bundle_id: str | None = None,
    line_id: str | None = None,
) -> JsonObject:
    return {
        "kind": kind,
        "debit": debit,
        "credit": credit,
        "wh": wh,
        "window_id": window_id,
        "label": label,
        "lot_id": lot_id,
        "bundle_id": bundle_id,
        "line_id": line_id,
    }


async def apply_allocation(connection: asyncpg.Connection, window: Window, now: datetime) -> Allocation:
    """Recompute the allocation and write the difference: new lines posted, vanished unfixed lines reversed."""
    allocation = window.allocation(now)
    wanted = {line.key: line for line in allocation.lines if line.status == "Unsubmitted"}
    standing = {line.key: line for line in window.lines if line.status == "Unsubmitted"}
    movements: list[JsonObject] = []
    gone = [line for key, line in standing.items() if key not in wanted]
    added = [line for key, line in wanted.items() if key not in standing]
    if gone:
        await connection.execute(
            "DELETE FROM lines WHERE window_id = $1 AND id = ANY($2)", window.id, [line.id for line in gone]
        )
    for line in gone:
        movements.append(
            movement(
                "return",
                "allocated",
                "holdings",
                line.wh,
                window.id,
                f"Return {line.lot_name}",
                lot_id=line.lot_id,
                bundle_id=line.bundle_id,
                line_id=line.id,
            )
        )
    if added:
        await connection.executemany(
            "INSERT INTO lines (window_id, id, hour_utc, lot_id, bundle_id, range_start, range_end, status) "
            "VALUES ($1,$2,$3,$4,$5,$6,$7,'Unsubmitted')",
            [(window.id, line.id, line.hour, line.lot_id, line.bundle_id, line.start, line.end) for line in added],
        )
    for line in added:
        movements.append(
            movement(
                "allocate",
                "holdings",
                "allocated",
                line.wh,
                window.id,
                f"Allocate {line.lot_name}",
                lot_id=line.lot_id,
                bundle_id=line.bundle_id,
                line_id=line.id,
            )
        )
    lot_names = {lot.id: lot.name for lot in window.lots}
    for bundle in window.bundles:
        loss = allocation.losses.get(bundle.id, 0)
        if loss == bundle.loss_wh:
            continue
        label = f"Battery loss {lot_names[bundle.lot_id]}"
        if loss > bundle.loss_wh:
            movements.append(
                movement(
                    "battery_loss",
                    "holdings",
                    "loss",
                    loss - bundle.loss_wh,
                    window.id,
                    label,
                    lot_id=bundle.lot_id,
                    bundle_id=bundle.id,
                )
            )
        else:
            movements.append(
                movement(
                    "return",
                    "loss",
                    "holdings",
                    bundle.loss_wh - loss,
                    window.id,
                    label,
                    lot_id=bundle.lot_id,
                    bundle_id=bundle.id,
                )
            )
        await connection.execute(
            "UPDATE bundles SET loss_wh = $3 WHERE window_id = $1 AND id = $2", window.id, bundle.id, loss
        )
    await record_ledger(connection, movements, now)
    return allocation

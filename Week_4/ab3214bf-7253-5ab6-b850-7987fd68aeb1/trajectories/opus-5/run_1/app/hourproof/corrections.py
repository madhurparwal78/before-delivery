"""Late meter corrections, and the restatement chain they open."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from . import clock, engine, store
from .db import Cursor
from .domain import lots as lot_rules, states
from .domain.allocation import line_id as build_line_id
from .domain.model import ACTUAL, CONFIRMED, Hour, Site, WindowRecord
from .domain.units import NotWholeWattHour, to_watt_hours
from .errors import conflicting_correction, meter_hub_unavailable, not_whole_watt_hour
from .services import meterhub
from .services.http import ProviderUnavailable

SUPERSEDED = "Superseded"


@dataclass
class Correction:
    line_number: int
    hour_utc: datetime
    value_wh: int
    version: int


@dataclass
class PullResult:
    applied: list[dict[str, str]]
    restated: list[dict[str, str]]
    skipped: list[dict[str, str]]


def pull(cursor: Cursor, site: Site, writer_name: str) -> PullResult:
    windows = _site_windows(cursor, site)
    if not windows:
        return PullResult([], [], [])
    since = min(window.start_utc for window in windows)
    try:
        rows = meterhub.corrections(site.meter_id, clock.instant(since))
    except ProviderUnavailable:
        raise meter_hub_unavailable() from None
    corrections, superseded = _read_corrections(rows)
    applied: list[dict[str, str]] = []
    restated: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = [
        {"hour_utc": clock.hour(hour_utc), "state": SUPERSEDED}
        for hour_utc in superseded
    ]
    successors: dict[str, WindowRecord] = {}
    touched: set[str] = set()
    for correction in sorted(corrections, key=lambda row: row.hour_utc):
        target = _newest_in_chain(cursor, windows, correction.hour_utc)
        if target is None:
            continue
        hour = next(
            (row for row in target.hours if row.hour_utc == correction.hour_utc), None
        )
        if hour is None:
            continue
        if hour.correction_version >= correction.version:
            skipped.append(
                {"hour_utc": clock.hour(correction.hour_utc), "state": SUPERSEDED}
            )
            continue
        if hour.consumed_wh == correction.value_wh:
            _store_version(cursor, target, hour, correction.version)
            continue
        if target.state == states.RECONCILING:
            _write_correction(cursor, target, hour, correction)
            applied.append(
                {
                    "window_id": target.id,
                    "hour_utc": clock.hour(correction.hour_utc),
                }
            )
            touched.add(target.id)
            continue
        if target.state == states.SEALED:
            successor = successors.get(target.id)
            if successor is None:
                successor = _open_successor(cursor, target)
                successors[target.id] = successor
                restated.append({"window_id": target.id, "successor_id": successor.id})
                windows.append(successor)
            successor_hour = next(
                row for row in successor.hours if row.hour_utc == correction.hour_utc
            )
            _write_correction(cursor, successor, successor_hour, correction)
            applied.append(
                {
                    "window_id": successor.id,
                    "hour_utc": clock.hour(correction.hour_utc),
                }
            )
            touched.add(successor.id)
            continue
        skipped.append(
            {"hour_utc": clock.hour(correction.hour_utc), "state": target.state}
        )
    for window_id in sorted(touched):
        window = store.load_window(cursor, window_id)
        assert window is not None
        store.bump_revision(cursor, window, writer_name)
        engine.recompute(cursor, window)
    return PullResult(applied, restated, skipped)


def _site_windows(cursor: Cursor, site: Site) -> list[WindowRecord]:
    rows = cursor.all("SELECT id FROM windows WHERE site_id = %s", (site.id,))
    return store.load_windows(cursor, [row["id"] for row in rows])


def _read_corrections(
    rows: list[dict[str, Any]]
) -> tuple[list[Correction], list[datetime]]:
    """Read every line, refusing the whole pull on the lowest-numbered bad line."""
    parsed: list[Correction] = []
    seen: dict[tuple[datetime, int], int] = {}
    problems: list[tuple[int, int]] = []
    for number, row in enumerate(rows, start=1):
        try:
            value_wh = to_watt_hours(str(row["value"]), str(row["unit"]))
        except NotWholeWattHour:
            problems.append((number, 0))
            continue
        hour_utc = clock.parse_hour(str(row["hour_utc"]))
        version = int(row["version"])
        key = (hour_utc, version)
        if key in seen and seen[key] != value_wh:
            problems.append((number, 1))
            continue
        seen[key] = value_wh
        parsed.append(Correction(number, hour_utc, value_wh, version))
    if problems:
        problems.sort()
        number, kind = problems[0]
        raise not_whole_watt_hour(number) if kind == 0 else conflicting_correction(number)
    highest: dict[datetime, int] = {}
    for correction in parsed:
        highest[correction.hour_utc] = max(
            highest.get(correction.hour_utc, 0), correction.version
        )
    applying: list[Correction] = []
    superseded: list[datetime] = []
    taken: set[datetime] = set()
    for correction in parsed:
        if correction.version == highest[correction.hour_utc] and (
            correction.hour_utc not in taken
        ):
            taken.add(correction.hour_utc)
            applying.append(correction)
        else:
            superseded.append(correction.hour_utc)
    return applying, superseded


def _newest_in_chain(
    cursor: Cursor, windows: list[WindowRecord], hour_utc: datetime
) -> WindowRecord | None:
    holders = [
        window
        for window in windows
        if window.start_utc <= hour_utc < window.end_utc
        and window.state != states.RESTATED
    ]
    if not holders:
        return None
    holders.sort(key=_chain_position)
    return holders[-1]


def _chain_position(window: WindowRecord) -> int:
    suffix = window.id[len(window.base_id) :]
    return int(suffix[2:]) if suffix.startswith("-r") else 1


def _store_version(
    cursor: Cursor, window: WindowRecord, hour: Hour, version: int
) -> None:
    store.write_hour(
        cursor,
        window,
        Hour(
            hour_utc=hour.hour_utc,
            consumed_wh=hour.consumed_wh,
            quality=hour.quality,
            substitution_reason=hour.substitution_reason,
            correction_version=version,
        ),
    )


def _write_correction(
    cursor: Cursor, window: WindowRecord, hour: Hour, correction: Correction
) -> None:
    store.write_hour(
        cursor,
        window,
        Hour(
            hour_utc=hour.hour_utc,
            consumed_wh=correction.value_wh,
            quality=ACTUAL,
            substitution_reason=None,
            correction_version=correction.version,
        ),
    )


def _open_successor(cursor: Cursor, window: WindowRecord) -> WindowRecord:
    """Restate a Sealed window and copy it forward into exactly one successor."""
    chain = int(
        cursor.value(
            "SELECT COUNT(*) FROM windows WHERE base_id = %s", (window.base_id,)
        )
    )
    successor_id = f"{window.base_id}-r{chain + 1}"
    cursor.execute(
        "INSERT INTO windows (id, base_id, site_id, month, state, revision, opens_at,"
        " start_utc, end_utc, verifier_firm_id, registry_reachable, predecessor_id,"
        " created_at) VALUES (%s, %s, %s, %s, %s, 1, %s, %s, %s, %s, true, %s, %s)",
        (
            successor_id,
            window.base_id,
            window.site.id,
            window.month,
            states.RECONCILING,
            window.opens_at,
            window.start_utc,
            window.end_utc,
            window.verifier_firm_id,
            window.id,
            clock.now(),
        ),
    )
    cursor.many(
        "INSERT INTO window_hours (window_id, hour_utc, consumed_wh, quality,"
        " substitution_reason, correction_version) VALUES (%s, %s, %s, %s, %s, %s)",
        [
            (
                successor_id,
                hour.hour_utc,
                hour.consumed_wh,
                hour.quality,
                hour.substitution_reason,
                hour.correction_version,
            )
            for hour in window.hours
        ],
    )
    cursor.many(
        "INSERT INTO lots (window_id, lot_id, name, technology, zone, rank, excluded,"
        " battery_shifted, production_month, cancel_by)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        [
            (
                successor_id,
                lot.lot_id,
                lot.name,
                lot.technology,
                lot.zone,
                lot.rank,
                lot.excluded,
                lot.battery_shifted,
                lot.production_month,
                lot.cancel_by,
            )
            for lot in window.lots
        ],
    )
    cursor.many(
        "INSERT INTO bundles (window_id, bundle_id, lot_id, battery_shifted,"
        " production_hour, discharge_hour, range_start_wh, range_end_wh)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
        [
            (
                successor_id,
                bundle.bundle_id,
                bundle.lot_id,
                bundle.battery_shifted,
                bundle.production_hour,
                bundle.discharge_hour,
                bundle.range_start_wh,
                bundle.range_end_wh,
            )
            for bundle in window.bundles
        ],
    )
    for bundle in window.bundles:
        store.movement(
            cursor,
            "deposit",
            "registry",
            "holdings",
            bundle.gross_wh,
            successor_id,
            bundle.lot_id,
            bundle.bundle_id,
        )
    standing_loss = store.bundle_loss_standing(cursor, window.id)
    for bundle in window.bundles:
        if bundle.bundle_id in standing_loss:
            store.movement(
                cursor,
                "battery_loss",
                "holdings",
                "loss",
                lot_rules.loss_wh(bundle),
                successor_id,
                bundle.lot_id,
                bundle.bundle_id,
            )
    for line in window.lines:
        if line.status != CONFIRMED:
            continue
        copied_id = build_line_id(successor_id, line.bundle_id, line.range_start_wh)
        cursor.execute(
            "INSERT INTO lines (line_id, window_id, hour_utc, lot_id, bundle_id,"
            " range_start_wh, range_end_wh, wh, status, confirmed_at)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (
                copied_id,
                successor_id,
                line.hour_utc,
                line.lot_id,
                line.bundle_id,
                line.range_start_wh,
                line.range_end_wh,
                line.wh,
                CONFIRMED,
                clock.now(),
            ),
        )
        store.movement(
            cursor,
            "allocate",
            "holdings",
            "allocated",
            line.wh,
            successor_id,
            line.lot_id,
            line.bundle_id,
            copied_id,
        )
        store.movement(
            cursor,
            "cancel",
            "allocated",
            "cancelled",
            line.wh,
            successor_id,
            line.lot_id,
            line.bundle_id,
            copied_id,
        )
    store.set_state(cursor, window, states.RESTATED)
    store.set_field(cursor, window, "successor_id", successor_id)
    store.bump_revision(cursor, window, None)
    successor = store.load_window(cursor, successor_id)
    assert successor is not None
    return successor

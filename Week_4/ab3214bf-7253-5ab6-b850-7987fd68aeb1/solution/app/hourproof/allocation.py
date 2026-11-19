"""Greedy hourly allocation of certificate bundles to metered consumption, and the lot statuses it rests on."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from .timeutil import cancel_by

BATTERY_NUMERATOR = 88
BATTERY_DENOMINATOR = 100
FIXED = ("Pending", "Confirmed")


@dataclass(frozen=True, slots=True)
class Lot:
    id: str
    name: str
    technology: str
    zone: str
    rank: int
    excluded: bool
    battery_shifted: bool
    production_month: str


@dataclass(frozen=True, slots=True)
class Bundle:
    id: str
    lot_id: str
    production_hour: datetime
    discharge_hour: datetime | None
    battery_shifted: bool
    start: int
    end: int
    loss_wh: int

    @property
    def gross(self) -> int:
        return self.end - self.start


@dataclass(frozen=True, slots=True)
class Line:
    id: str
    hour: datetime
    lot_id: str
    lot_name: str
    bundle_id: str
    start: int
    end: int
    status: str
    reason: str | None

    @property
    def wh(self) -> int:
        return self.end - self.start

    @property
    def key(self) -> tuple[datetime, str, int, int]:
        return (self.hour, self.bundle_id, self.start, self.end)


@dataclass(slots=True)
class Allocation:
    lines: list[Line]
    eligible: dict[datetime, int]
    statuses: dict[str, str]
    losses: dict[str, int]


def lot_status(lot: Lot, lines: list[Line], site_zone: str, now: datetime) -> str:
    if lot.zone != site_zone:
        return "Out of zone"
    if lines and all(line.status == "Confirmed" for line in lines):
        return "Cancelled"
    if now >= cancel_by(lot.production_month):
        return "Expired"
    if lot.excluded:
        return "Excluded"
    if any(line.status == "Pending" for line in lines):
        return "Cancelling"
    return "Available"


def leaves_allocation(lot: Lot, status: str) -> bool:
    """Whether the lot's watt-hours that carry no line are out of allocation."""
    return status == "Out of zone" or lot.excluded or status == "Expired"


def battery_amounts(bundle: Bundle) -> tuple[datetime, int, int] | None:
    """The hour a bundle matches on, its available watt-hours and its loss; None when it can never allocate."""
    if not bundle.battery_shifted:
        return bundle.production_hour, bundle.gross, 0
    discharge = bundle.discharge_hour
    if discharge is None or discharge <= bundle.production_hour:
        return None
    available = bundle.gross * BATTERY_NUMERATOR // BATTERY_DENOMINATOR
    return discharge, available, bundle.gross - available


def _free_intervals(bundle: Bundle, available: int, used: list[tuple[int, int]]) -> list[tuple[int, int]]:
    free: list[tuple[int, int]] = []
    cursor, limit = bundle.start, bundle.start + available
    for start, end in sorted(used):
        if start > cursor:
            free.append((cursor, min(start, limit)))
        cursor = max(cursor, end)
    if cursor < limit:
        free.append((cursor, limit))
    return [(start, end) for start, end in free if end > start]


def allocate(
    window_id: str,
    hours: list[datetime],
    consumption: dict[datetime, int],
    lots: list[Lot],
    bundles: list[Bundle],
    lines: list[Line],
    site_zone: str,
    now: datetime,
) -> Allocation:
    """Greedy by lot rank then bundle id. Pending and Confirmed lines are fixed; Rejected ranges are never reused."""
    lines_by_lot: dict[str, list[Line]] = {}
    for line in lines:
        lines_by_lot.setdefault(line.lot_id, []).append(line)
    statuses = {lot.id: lot_status(lot, lines_by_lot.get(lot.id, []), site_zone, now) for lot in lots}
    lots_by_id = {lot.id: lot for lot in lots}
    in_window = set(hours)
    fixed_by_hour: dict[datetime, int] = {}
    fixed_by_bundle: dict[str, int] = {}
    used: dict[str, list[tuple[int, int]]] = {}
    for line in lines:
        if line.status == "Unsubmitted":
            continue
        used.setdefault(line.bundle_id, []).append((line.start, line.end))
        if line.status in FIXED:
            fixed_by_hour[line.hour] = fixed_by_hour.get(line.hour, 0) + line.wh
            fixed_by_bundle[line.bundle_id] = fixed_by_bundle.get(line.bundle_id, 0) + line.wh
    by_hour: dict[datetime, list[tuple[int, str, Bundle, int, int]]] = {}
    for bundle in bundles:
        amounts = battery_amounts(bundle)
        lot = lots_by_id.get(bundle.lot_id)
        if amounts is None or lot is None or amounts[0] not in in_window:
            continue
        by_hour.setdefault(amounts[0], []).append((lot.rank, bundle.id, bundle, amounts[1], amounts[2]))
    eligible: dict[datetime, int] = {}
    new_lines: list[Line] = [line for line in lines if line.status in FIXED]
    yielding: set[str] = {line.bundle_id for line in new_lines}
    for hour in hours:
        remaining = max(0, consumption.get(hour, 0) - fixed_by_hour.get(hour, 0))
        total = 0
        for _, _, bundle, available, _ in sorted(by_hour.get(hour, []), key=lambda candidate: (candidate[0], candidate[1])):
            lot = lots_by_id[bundle.lot_id]
            total += fixed_by_bundle.get(bundle.id, 0)
            if leaves_allocation(lot, statuses[lot.id]):
                continue
            for start, end in _free_intervals(bundle, available, used.get(bundle.id, [])):
                total += end - start
                draw = min(remaining, end - start)
                if draw:
                    remaining -= draw
                    new_lines.append(
                        Line(
                            f"{window_id}_{bundle.id}_{start}",
                            hour,
                            lot.id,
                            lot.name,
                            bundle.id,
                            start,
                            start + draw,
                            "Unsubmitted",
                            None,
                        )
                    )
                    yielding.add(bundle.id)
        eligible[hour] = total
    losses: dict[str, int] = {}
    for bundle in bundles:
        amounts = battery_amounts(bundle)
        if bundle.id in yielding and amounts is not None and amounts[2] > 0:
            losses[bundle.id] = amounts[2]
    new_lines.sort(key=lambda line: (line.hour, line.bundle_id, line.start))
    return Allocation(new_lines, eligible, statuses, losses)

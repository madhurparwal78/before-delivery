"""Greedy allocation by lot rank, the watt-hour ranges it draws and its digest."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime

from . import lots as lot_rules
from .model import FIXED_STATUSES, REJECTED, UNSUBMITTED, Bundle, Line, WindowRecord


def line_id(window_id: str, bundle_id: str, range_start_wh: int) -> str:
    return f"{window_id}_{bundle_id}_{range_start_wh}"


@dataclass
class BundleSpace:
    """One bundle's deliverable range, with the pieces that are already spoken for."""

    bundle: Bundle
    lot_status: str
    hour_utc: datetime | None
    cap: int
    blocked: list[tuple[int, int]] = field(default_factory=list)
    fixed_wh: int = 0
    rejected_wh: int = 0

    @property
    def gaps(self) -> list[tuple[int, int]]:
        cursor = self.bundle.range_start_wh
        gaps: list[tuple[int, int]] = []
        for start, end in sorted(self.blocked):
            if start > cursor:
                gaps.append((cursor, start))
            cursor = max(cursor, end)
        if cursor < self.cap:
            gaps.append((cursor, self.cap))
        return gaps

    @property
    def deliverable_wh(self) -> int:
        """The watt-hours this bundle counts as eligible for its hour."""
        if self.hour_utc is None or self.lot_status == lot_rules.OUT_OF_ZONE:
            return 0
        if not lot_rules.free_watt_hours_count(self.lot_status):
            return self.fixed_wh
        return self.cap - self.bundle.range_start_wh - self.rejected_wh


def bundle_spaces(window: WindowRecord, now: datetime) -> dict[str, BundleSpace]:
    hours = {hour.hour_utc for hour in window.hours}
    statuses = {
        lot.lot_id: lot_rules.status_of(lot, window.site.zone, window.lines, now)
        for lot in window.lots
    }
    spaces: dict[str, BundleSpace] = {}
    for bundle in window.bundles:
        delivery = lot_rules.delivery_hour(bundle)
        if delivery not in hours:
            delivery = None
        space = BundleSpace(
            bundle=bundle,
            lot_status=statuses[bundle.lot_id],
            hour_utc=delivery,
            cap=bundle.range_end_wh - lot_rules.loss_wh(bundle),
        )
        spaces[bundle.bundle_id] = space
    for line in window.lines:
        space = spaces.get(line.bundle_id)
        if space is None:
            continue
        if line.status == REJECTED:
            space.blocked.append((line.range_start_wh, line.range_end_wh))
            space.rejected_wh += line.wh
        elif line.status in FIXED_STATUSES:
            space.blocked.append((line.range_start_wh, line.range_end_wh))
            space.fixed_wh += line.wh
    return spaces


def eligible_by_hour(window: WindowRecord, now: datetime) -> dict[datetime, int]:
    eligible: dict[datetime, int] = {hour.hour_utc: 0 for hour in window.hours}
    for space in bundle_spaces(window, now).values():
        if space.hour_utc is not None:
            eligible[space.hour_utc] += space.deliverable_wh
    return eligible


def allocate(window: WindowRecord, now: datetime) -> list[Line]:
    """The lines this window's inputs produce: fixed lines first, then greedy draws."""
    spaces = bundle_spaces(window, now)
    fixed = [line for line in window.lines if line.status in FIXED_STATUSES]
    drawing = {
        lot.lot_id
        for lot in window.lots
        if lot_rules.takes_new_draws(lot, window.site.zone, now)
    }
    by_hour: dict[datetime, list[BundleSpace]] = {}
    for space in spaces.values():
        if space.hour_utc is not None and space.bundle.lot_id in drawing:
            by_hour.setdefault(space.hour_utc, []).append(space)
    ranks = {lot.lot_id: lot.rank for lot in window.lots}
    fixed_by_hour: dict[datetime, int] = {}
    for line in fixed:
        fixed_by_hour[line.hour_utc] = fixed_by_hour.get(line.hour_utc, 0) + line.wh

    consumption = {hour.hour_utc: hour.consumed_wh or 0 for hour in window.hours}
    drawn: list[Line] = []
    for hour in sorted(consumption):
        remaining = max(0, consumption[hour] - fixed_by_hour.get(hour, 0))
        if remaining == 0:
            continue
        candidates = sorted(
            by_hour.get(hour, []),
            key=lambda space: (ranks[space.bundle.lot_id], space.bundle.bundle_id),
        )
        for space in candidates:
            gaps = space.gaps
            if not gaps:
                continue
            start, end = gaps[0]
            draw = min(remaining, end - start)
            if draw <= 0:
                continue
            drawn.append(
                Line(
                    line_id=line_id(window.id, space.bundle.bundle_id, start),
                    hour_utc=hour,
                    lot_id=space.bundle.lot_id,
                    bundle_id=space.bundle.bundle_id,
                    range_start_wh=start,
                    range_end_wh=start + draw,
                    wh=draw,
                    status=UNSUBMITTED,
                )
            )
            remaining -= draw
            if remaining == 0:
                break
    return fixed + drawn


def digest(lines: list[Line]) -> str:
    rows = sorted(
        (line for line in lines if line.status != REJECTED),
        key=lambda line: (line.hour_utc, line.bundle_id),
    )
    text = "\n".join(
        f"{line.hour_utc.strftime('%Y-%m-%dT%H:00:00Z')}|{line.bundle_id}"
        f"|{line.range_start_wh}|{line.range_end_wh}"
        for line in rows
    )
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

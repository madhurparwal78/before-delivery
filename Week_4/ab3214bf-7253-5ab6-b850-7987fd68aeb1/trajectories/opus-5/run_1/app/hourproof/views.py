"""The JSON shapes the API publishes."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from . import clock, engine, store
from .db import Cursor
from .domain import allocation, lots as lot_rules, opinion as opinion_rules, states
from .domain.model import ACTUAL, CONFIRMED, REJECTED, Line, Lot, WindowRecord
from .domain.numbers import basis_points
from .domain.scores import GRAINS, Figures
from .domain.timeline import local_hour


def window_json(cursor: Cursor, window: WindowRecord) -> dict[str, Any]:
    figs = engine.figures(window)
    live = store.live_lines(window)
    sample = store.sample_rows(cursor, window.id)
    exceptions = sum(1 for row in sample if row["result"] == "exception")
    non_actual_wh = sum(
        hour.consumed_wh for hour in figs.hours if hour.quality != ACTUAL
    )
    decided = window.frozen_opinion or opinion_rules.decide(
        non_actual_wh, figs.consumed_wh, exceptions
    )
    scores = figs.scores()
    target_bp = window.target_bp
    target_grain = window.target_grain
    signature = store.signature_for(cursor, window.id)
    deadline = engine.review_deadline(window)
    return {
        "id": window.id,
        "site": {
            "id": window.site.id,
            "name": window.site.name,
            "zone": window.site.zone,
            "time_zone": window.site.time_zone,
            "meter_id": window.site.meter_id,
        },
        "month": window.month,
        "state": window.state,
        "revision": window.revision,
        "hour_count": len(window.hours),
        "opens_at": clock.instant(window.opens_at),
        "opens_seconds_left": clock.seconds_left(window.opens_at),
        "review_seconds_left": (
            clock.seconds_left(deadline) if window.state == states.IN_REVIEW else None
        ),
        "scores": scores,
        "consumed_wh": figs.consumed_wh,
        "unmatched_wh": figs.unmatched_wh,
        "unmatched_hours": figs.unmatched_hours,
        "missing_hours": figs.missing_hours,
        "non_actual_bp": figs.non_actual_bp,
        "residual_emissions_g": engine.residual_grams(cursor, window, figs),
        "opinion": decided,
        "target": {
            "grain": target_grain,
            "bp": target_bp,
            "met": scores[f"{target_grain.lower()}_bp"] >= target_bp,
        },
        "verifier_firm": store.firm(cursor, window.verifier_firm_id),
        "returned_reason": window.returned_reason,
        "registry_reachable": window.registry_reachable,
        "seal_status": window.seal_status,
        "statement_code": signature["statement_code"] if signature else None,
        "allocation_digest": allocation.digest(live),
        "predecessor_id": window.predecessor_id,
        "successor_id": window.successor_id,
        "last_writer_name": window.last_writer_name,
        "lines_confirmed": sum(1 for line in live if line.status == CONFIRMED),
        "lines_total": len(live),
    }


def lot_json(window: WindowRecord, lot: Lot, now: datetime) -> dict[str, Any]:
    own = [
        line
        for line in window.lines
        if line.lot_id == lot.lot_id and line.status != REJECTED
    ]
    bundles = [
        bundle for bundle in window.bundles if bundle.lot_id == lot.lot_id
    ]
    return {
        "id": lot.lot_id,
        "name": lot.name,
        "technology": lot.technology,
        "zone": lot.zone,
        "rank": lot.rank,
        "status": lot_rules.status_of(lot, window.site.zone, window.lines, now),
        "excluded": lot.excluded,
        "battery_shifted": lot.battery_shifted,
        "production_month": lot.production_month,
        "cancel_by": clock.instant(lot.cancel_by),
        "cancel_seconds_left": clock.seconds_left(lot.cancel_by),
        "opening_wh": sum(bundle.gross_wh for bundle in bundles),
        "bundle_count": len(bundles),
        "lines_confirmed": sum(1 for line in own if line.status == CONFIRMED),
        "lines_total": len(own),
    }


def lots_json(window: WindowRecord) -> list[dict[str, Any]]:
    now = clock.now()
    return [
        lot_json(window, lot, now)
        for lot in sorted(window.lots, key=lambda lot: lot.rank)
    ]


def line_json(window: WindowRecord, line: Line) -> dict[str, Any]:
    names = {lot.lot_id: lot.name for lot in window.lots}
    return {
        "line_id": line.line_id,
        "hour_utc": clock.hour(line.hour_utc),
        "lot_id": line.lot_id,
        "lot_name": names.get(line.lot_id, line.lot_id),
        "bundle_id": line.bundle_id,
        "range_start_wh": str(line.range_start_wh),
        "range_end_wh": str(line.range_end_wh),
        "wh": line.wh,
        "status": line.status,
        "reason": line.reason,
    }


def lines_json(window: WindowRecord, lines: list[Line]) -> list[dict[str, Any]]:
    ordered = sorted(lines, key=lambda line: (line.hour_utc, line.bundle_id))
    return [line_json(window, line) for line in ordered]


def grain_json(window: WindowRecord, grain: str, figs: Figures) -> dict[str, Any]:
    buckets = figs.buckets(grain)
    rows = []
    for bucket in buckets:
        row: dict[str, Any] = {
            "key": bucket.key,
            "start_utc": clock.hour(bucket.start_utc),
            "end_utc": clock.hour(bucket.end_utc),
            "consumed_wh": bucket.consumed_wh,
            "eligible_wh": bucket.eligible_wh,
            "matched_wh": bucket.matched_wh,
            "surplus_wh": bucket.surplus_wh,
        }
        if grain == "hour":
            row["quality"] = bucket.quality
        else:
            row["worst"] = [
                {"key": key, "unmatched_wh": unmatched}
                for key, unmatched in figs.worst(grain, bucket)
            ]
        rows.append(row)
    return {
        "grain": grain,
        "revision": window.revision,
        "score_bp": figs.score_bp(grain),
        "buckets": rows,
        "falls": [
            {"parent_key": parent, "detached_wh": detached}
            for parent, detached in figs.falls(grain)
        ],
    }


def hour_json(
    window: WindowRecord, hour_utc: datetime, figs: Figures
) -> dict[str, Any] | None:
    for hour in window.hours:
        if hour.hour_utc != hour_utc:
            continue
        matched = next(
            figure.matched_wh for figure in figs.hours if figure.hour_utc == hour_utc
        )
        lines = [
            line
            for line in window.lines
            if line.hour_utc == hour_utc and line.status != REJECTED
        ]
        return {
            "hour_utc": clock.hour(hour_utc),
            "local_label": local_hour(hour_utc, window.site.time_zone).label,
            "consumed_wh": hour.consumed_wh,
            "matched_wh": matched,
            "quality": hour.quality,
            "substitution_reason": hour.substitution_reason,
            "lines": lines_json(window, lines),
        }
    return None


def group_rollups(
    cursor: Cursor, windows: list[WindowRecord]
) -> list[dict[str, Any]]:
    """Each month's totals: summed matched over summed consumed at every grain."""
    counted = [
        window for window in windows if window.state != states.RESTATED
    ]
    months: dict[str, list[WindowRecord]] = {}
    for window in counted:
        months.setdefault(window.month, []).append(window)
    rollups = []
    for month in sorted(months, reverse=True):
        members = months[month]
        consumed = 0
        matched = {grain: 0 for grain in GRAINS}
        residual_total: int | None = 0
        for window in members:
            figs = engine.figures(window)
            consumed += figs.consumed_wh
            for grain in GRAINS:
                matched[grain] += sum(
                    bucket.matched_wh for bucket in figs.buckets(grain)
                )
            grams = engine.residual_grams(cursor, window, figs)
            if grams is None or residual_total is None:
                residual_total = None
            else:
                residual_total += grams
        rollups.append(
            {
                "month": month,
                "window_count": len(members),
                "consumed_wh": consumed,
                "scores": {
                    f"{grain}_bp": basis_points(matched[grain], consumed)
                    for grain in GRAINS
                },
                "residual_emissions_g": residual_total,
            }
        )
    return rollups

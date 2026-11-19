"""The JSON shapes of the API: Window, Lot, Line, grain replies and hour detail."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from .allocation import Allocation, Line
from .clock import format_hour, format_instant, seconds_left
from .jsontypes import JsonObject
from .repository import Window
from .rules import allocation_digest
from .scoring import Grains, residual_emissions, round_half_up
from .timeutil import cancel_by, local_label

TIMED_OUT = "REVIEW TIME RAN OUT. SENT BACK TO THE ANALYST."
NON_ACTUAL_LIMIT_PERCENT = 5


@dataclass(frozen=True, slots=True)
class Context:
    now: datetime
    registry_reachable: bool


def line_json(line: Line) -> JsonObject:
    return {
        "line_id": line.id,
        "hour_utc": format_hour(line.hour),
        "lot_id": line.lot_id,
        "lot_name": line.lot_name,
        "bundle_id": line.bundle_id,
        "range_start_wh": str(line.start),
        "range_end_wh": str(line.end),
        "wh": line.wh,
        "status": line.status,
        "reason": line.reason if line.status == "Rejected" else None,
    }


def sorted_lines(lines: list[Line]) -> list[Line]:
    return sorted(lines, key=lambda line: (line.hour, line.bundle_id, line.start))


def totals(window: Window, grains: Grains) -> dict[str, int]:
    hourly = grains.by_grain["hour"]
    consumed = sum(bucket.consumed for bucket in hourly)
    matched = sum(bucket.matched for bucket in hourly)
    non_actual = sum(bucket.consumed for bucket in hourly if bucket.quality != "Actual")
    return {
        "consumed": consumed,
        "matched": matched,
        "non_actual": non_actual,
        "missing": sum(1 for bucket in hourly if bucket.quality == "Missing"),
        "unmatched_hours": sum(
            1 for bucket in hourly if bucket.quality != "Missing" and bucket.consumed > bucket.matched
        ),
    }


def opinion_of(window: Window, figures: dict[str, int]) -> str:
    if window.columns["frozen_opinion"]:
        return window.columns["frozen_opinion"]
    over = figures["non_actual"] * 100 > figures["consumed"] * NON_ACTUAL_LIMIT_PERCENT
    return "Qualified" if over or window.sample_exception else "Unqualified"


def window_json(window: Window, ctx: Context, grains: Grains | None = None) -> JsonObject:
    grains = grains or window.grains(ctx.now)
    figures = totals(window, grains)
    scores = grains.scores()
    columns = window.columns
    target_grain = columns["frozen_grain"] or columns["site_target_grain"]
    target_bp = columns["frozen_bp"] if columns["frozen_grain"] else columns["site_target_bp"]
    deadline = window.review_deadline
    non_actual_bp = round_half_up(figures["non_actual"] * 10000, figures["consumed"]) if figures["consumed"] else 0
    lines_total = len(window.lines)
    return {
        "id": window.id,
        "site": {
            "id": columns["site_id"],
            "name": columns["site_name"],
            "zone": columns["zone"],
            "time_zone": columns["time_zone"],
            "meter_id": columns["meter_id"],
        },
        "month": columns["month"],
        "state": window.state,
        "revision": columns["revision"],
        "hour_count": len(window.hours),
        "opens_at": format_instant(window.opens_at),
        "opens_seconds_left": seconds_left(window.opens_at, ctx.now),
        "review_seconds_left": seconds_left(deadline, ctx.now) if deadline else None,
        "scores": scores,
        "consumed_wh": figures["consumed"],
        "unmatched_wh": figures["consumed"] - figures["matched"],
        "unmatched_hours": figures["unmatched_hours"],
        "missing_hours": figures["missing"],
        "non_actual_bp": non_actual_bp,
        "residual_emissions_g": residual_emissions(grains.by_grain["hour"], window.factors),
        "opinion": opinion_of(window, figures),
        "target": {"grain": target_grain, "bp": target_bp, "met": scores[f"{target_grain.lower()}_bp"] >= target_bp},
        "verifier_firm": {"id": columns["firm_id"], "name": columns["firm_name"]} if columns["firm_id"] else None,
        "returned_reason": columns["returned_reason"],
        "registry_reachable": ctx.registry_reachable,
        "seal_status": columns["seal_status"],
        "statement_code": columns["statement_code"],
        "allocation_digest": allocation_digest(window.lines),
        "predecessor_id": columns["predecessor_id"],
        "successor_id": columns["successor_id"],
        "last_writer_name": columns["last_writer_name"],
        "last_write_revision": columns["last_write_revision"],
        "lines_confirmed": sum(1 for line in window.lines if line.status == "Confirmed"),
        "lines_total": lines_total,
        "lines_open": sum(1 for line in window.lines if line.status in ("Unsubmitted", "Pending")),
    }


def lot_json(window: Window, allocation: Allocation, ctx: Context) -> list[JsonObject]:
    result = []
    for lot in window.lots:
        lines = [line for line in window.lines if line.lot_id == lot.id]
        bundles = [bundle for bundle in window.bundles if bundle.lot_id == lot.id]
        limit = cancel_by(lot.production_month)
        result.append(
            {
                "id": lot.id,
                "name": lot.name,
                "technology": lot.technology,
                "zone": lot.zone,
                "rank": lot.rank,
                "status": allocation.statuses[lot.id],
                "excluded": lot.excluded,
                "battery_shifted": lot.battery_shifted,
                "production_month": lot.production_month,
                "cancel_by": format_instant(limit),
                "cancel_seconds_left": seconds_left(limit, ctx.now),
                "opening_wh": sum(b.gross for b in bundles),
                "bundle_count": len(bundles),
                "lines_confirmed": sum(1 for line in lines if line.status == "Confirmed"),
                "lines_total": len(lines),
            }
        )
    return result


def grain_json(window: Window, grain: str, ctx: Context) -> JsonObject:
    grains = window.grains(ctx.now)
    worst = grains.worst(grain) if grain != "hour" else {}
    buckets = []
    for bucket in grains.by_grain[grain]:
        entry: JsonObject = {
            "key": bucket.key,
            "start_utc": format_hour(bucket.start),
            "end_utc": format_hour(bucket.end),
            "consumed_wh": bucket.consumed,
            "eligible_wh": bucket.eligible,
            "matched_wh": bucket.matched,
            "surplus_wh": bucket.surplus,
        }
        if grain == "hour":
            entry["quality"] = bucket.quality
        else:
            entry["worst"] = [{"key": finer.key, "unmatched_wh": finer.unmatched} for finer in worst[bucket.key]]
        buckets.append(entry)
    return {
        "grain": grain,
        "revision": window.columns["revision"],
        "score_bp": grains.score(grain),
        "buckets": buckets,
        "falls": [{"parent_key": fall.parent_key, "detached_wh": fall.detached} for fall in grains.falls(grain)],
    }


def hour_json(window: Window, hour: datetime, ctx: Context) -> JsonObject:
    grains = window.grains(ctx.now)
    bucket = next(hourly for hourly in grains.by_grain["hour"] if hourly.start == hour)
    row = window.rows[hour]
    lines = [line for line in window.lines if line.hour == hour]
    return {
        "hour_utc": format_hour(hour),
        "local_label": local_label(hour, window.time_zone),
        "consumed_wh": bucket.consumed,
        "matched_wh": bucket.matched,
        "quality": row.quality,
        "substitution_reason": row.reason if row.quality == "Substituted" else None,
        "lines": [line_json(line) for line in sorted_lines(lines)],
    }

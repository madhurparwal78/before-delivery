"""Allocation, scores, grains, digest, ledger and repair — every domain rule
that decides figures, in one place.

All arithmetic is integer. Bundle ranges are decimal digit strings and never
pass through a binary floating point number.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from .exact import basis_points, round_half_up_int
from .states import (
    AWAITING_METERS, CANCELLING, RECONCILING, SEALED, SIGNED,
)
from .timeline import (
    format_hour, is_repeated_hour, local_date, month_key, month_hours_utc, parse_hour,
    tz_info, week_key,
)

BATTERY_NUM = 88
BATTERY_DEN = 100


# --- Bundle drawing ------------------------------------------------------
class BundleView:
    """One registry bundle as this app sees it."""

    def __init__(self, bundle_id: str, lot_id: str, production_hour: datetime | None,
                 discharge_hour: datetime | None, range_start: int, range_end: int,
                 battery: bool) -> None:
        self.bundle_id = bundle_id
        self.lot_id = lot_id
        self.production_hour = production_hour
        self.discharge_hour = discharge_hour
        self.range_start = range_start
        self.range_end = range_end
        self.battery = battery

    @property
    def gross(self) -> int:
        return self.range_end - self.range_start

    @property
    def usable(self) -> int:
        if not self.battery:
            return self.gross
        return (self.gross * BATTERY_NUM) // BATTERY_DEN

    @property
    def loss(self) -> int:
        if not self.battery:
            return 0
        return self.gross - self.usable

    def match_hour(self) -> datetime | None:
        return self.discharge_hour if self.battery else self.production_hour

    def deposited(self) -> bool:
        """A battery bundle with an unusable discharge hour is deposited and never allocates."""
        if not self.battery:
            return False
        return self.discharge_hour is None or (
            self.production_hour is not None and self.discharge_hour <= self.production_hour
        )


def allocation_key(bundle: BundleView) -> str:
    return bundle.bundle_id


# --- Lot status ----------------------------------------------------------
def lot_status(zone_site: str, lot_zone: str, has_lines: bool, all_confirmed: bool,
               cancel_by: datetime, now: datetime, excluded: bool,
               any_pending: bool) -> str:
    if lot_zone != zone_site:
        return "Out of zone"
    if has_lines and all_confirmed:
        return "Cancelled"
    if now >= cancel_by:
        return "Expired"
    if excluded:
        return "Excluded"
    if any_pending:
        return "Cancelling"
    return "Available"


def cancel_by_for(production_month: str) -> datetime:
    year, mon = int(production_month.split("-")[0]), int(production_month.split("-")[1])
    m = mon + 3
    y = year
    if m > 12:
        m -= 12
        y += 1
    return datetime(y, m, 1, tzinfo=timezone.utc)


# --- Allocation ----------------------------------------------------------
def compute_allocation(
    window_id: str,
    hours: list[dict[str, Any]],
    lots: list[dict[str, Any]],
    bundles: list[dict[str, Any]],
    lines: list[dict[str, Any]],
    now: datetime,
    site_zone: str,
) -> list[dict[str, Any]]:
    """Return the full line set for this window at this moment.

    Fixed Confirmed and Pending lines keep their place; Rejected ranges are
    never allocated again; every other bundle watt-hour is drawn greedily by
    lot rank, bundle id ascending, hour ascending.
    """
    hours_sorted = sorted(hours, key=lambda h: h["hour_utc"])
    by_lot = {lot["id"]: lot for lot in lots}
    fixed: dict[str, dict[str, Any]] = {}
    rejected_ranges: dict[str, list[tuple[int, int]]] = {}
    for line in lines:
        if line["status"] in ("Confirmed", "Pending"):
            fixed[line["line_id"]] = line
        elif line["status"] == "Rejected":
            rejected_ranges.setdefault(line["bundle_id"], []).append(
                (int(line["range_start_wh"]), int(line["range_end_wh"]))
            )

    ordered_lots = sorted(lots, key=lambda l: (l["rank"], l["id"]))
    allocatable_lot_ids: set[str] = set()
    for lot in ordered_lots:
        if lot["computed_status"] in ("Available", "Cancelling"):
            allocatable_lot_ids.add(lot["id"])

    bundle_views: list[BundleView] = []
    for b in bundles:
        bv = BundleView(
            b["bundle_id"], b["lot_id"],
            b["production_hour"], b["discharge_hour"],
            int(b["range_start_wh"]), int(b["range_end_wh"]),
            by_lot[b["lot_id"]]["battery_shifted"],
        )
        bundle_views.append(bv)
    by_lot_bundles: dict[str, list[BundleView]] = {}
    for bv in bundle_views:
        by_lot_bundles.setdefault(bv.lot_id, []).append(bv)
    for lst in by_lot_bundles.values():
        lst.sort(key=lambda b: (b.bundle_id, b.range_start))

    used: dict[str, list[tuple[int, int]]] = {}
    for line in fixed.values():
        used.setdefault(line["bundle_id"], []).append(
            (int(line["range_start_wh"]), int(line["range_end_wh"]))
        )
    for bid, ranges in used.items():
        ranges.sort()

    def lowest_free(bv: BundleView, need: int) -> tuple[int, int] | None:
        taken = list(used.get(bv.bundle_id, [])) + list(rejected_ranges.get(bv.bundle_id, []))
        taken.sort()
        cursor = bv.range_start
        for start, end in taken:
            if cursor + need <= start:
                break
            cursor = max(cursor, end)
        if cursor + need > bv.range_end:
            return None
        return cursor, cursor + need

    new_lines: list[dict[str, Any]] = list(fixed.values())
    fixed_line_ids = set(fixed.keys())

    for hour in hours_sorted:
        remaining = hour["consumed_wh"] or 0
        if remaining <= 0:
            continue
        for lot in ordered_lots:
            if lot["id"] not in allocatable_lot_ids:
                continue
            for bv in by_lot_bundles.get(lot["id"], []):
                if remaining <= 0:
                    break
                if bv.deposited():
                    continue
                if bv.match_hour() != hour["hour_utc"]:
                    continue
                avail = bv.usable
                while remaining > 0:
                    slot = lowest_free(bv, avail)
                    if slot is None:
                        break
                    start, end = slot
                    line_id = f"{window_id}_{bv.bundle_id}_{start}"
                    if line_id in fixed_line_ids:
                        break
                    draw = min(remaining, end - start)
                    taken = used.setdefault(bv.bundle_id, [])
                    taken.append((start, start + draw))
                    taken.sort()
                    new_lines.append({
                        "line_id": line_id,
                        "window_id": window_id,
                        "hour_utc": hour["hour_utc"],
                        "lot_id": lot["id"],
                        "bundle_id": bv.bundle_id,
                        "range_start_wh": str(start),
                        "range_end_wh": str(start + draw),
                        "wh": draw,
                        "status": "Unsubmitted",
                        "reason": None,
                    })
                    remaining -= draw
                if remaining <= 0:
                    break
    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for line in new_lines:
        if line["line_id"] in seen:
            continue
        seen.add(line["line_id"])
        result.append(line)
    result.sort(key=lambda l: (l["hour_utc"], l["bundle_id"], int(l["range_start_wh"])))
    return result


def lines_digest(lines: list[dict[str, Any]]) -> str:
    rows = []
    for line in sorted(lines, key=lambda l: (l["hour_utc"], l["bundle_id"])):
        rows.append(
            f"{format_hour(line['hour_utc'])}|{line['bundle_id']}|"
            f"{line['range_start_wh']}|{line['range_end_wh']}"
        )
    joined = "\n".join(rows)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


def hour_matched(lines: list[dict[str, Any]]) -> dict[datetime, int]:
    matched: dict[datetime, int] = {}
    for line in lines:
        if line["status"] == "Rejected":
            continue
        matched[line["hour_utc"]] = matched.get(line["hour_utc"], 0) + line["wh"]
    return matched


# --- Scores and grains ---------------------------------------------------
GRAINS = ("month", "week", "day", "hour")
GRAIN_LABELS = {"month": "Month", "week": "Week", "day": "Day", "hour": "Hour"}


def bucket_key(hour: datetime, grain: str, window_month: str, tz: ZoneInfo) -> str:
    """A bucket's key. The month grain keys the window's own month so its one
    bucket holds every hour; week and day key the local Monday and local date."""
    if grain == "week":
        return week_key(hour, tz)
    if grain == "day":
        return local_date(hour, tz)
    if grain == "month":
        return window_month
    return format_hour(hour)


def hours_in_buckets(hours: list[dict[str, Any]], grain: str, window_month: str,
                     tz: ZoneInfo) -> dict[str, list[dict[str, Any]]]:
    buckets: dict[str, list[dict[str, Any]]] = {}
    for hour in hours:
        key = bucket_key(hour["hour_utc"], grain, window_month, tz)
        buckets.setdefault(key, []).append(hour)
    return buckets


def eligible_wh_for(
    lots: list[dict[str, Any]],
    bundles: list[dict[str, Any]],
    lines: list[dict[str, Any]],
    bucket_hours: list[datetime],
) -> int:
    """Watt-hours an allocatable lot could deliver on these hours, excluding Rejected ranges."""
    rejected: dict[str, list[tuple[int, int]]] = {}
    for line in lines:
        if line["status"] == "Rejected":
            rejected.setdefault(line["bundle_id"], []).append(
                (int(line["range_start_wh"]), int(line["range_end_wh"]))
            )
    allocatable = set()
    lot_battery = {lot["id"]: lot["battery_shifted"] for lot in lots}
    for lot in lots:
        if lot["computed_status"] in ("Available", "Cancelling", "Cancelled"):
            allocatable.add(lot["id"])
    total = 0
    hour_set = set(bucket_hours)
    for b in bundles:
        if b["lot_id"] not in allocatable:
            continue
        bv = BundleView(
            b["bundle_id"], b["lot_id"], b["production_hour"], b["discharge_hour"],
            int(b["range_start_wh"]), int(b["range_end_wh"]),
            lot_battery.get(b["lot_id"], False),
        )
        if bv.deposited():
            continue
        if bv.match_hour() not in hour_set:
            continue
        taken = rejected.get(bv.bundle_id, [])
        cursor = bv.range_start
        amount = bv.usable
        for start, end in sorted(taken):
            if cursor + amount <= start:
                break
            cursor = max(cursor, end)
        if cursor + amount > bv.range_end:
            amount = bv.range_end - cursor
            if amount < 0:
                amount = 0
        total += amount
    return total


def score_for_grain(
    hours: list[dict[str, Any]], grain: str, window_month: str, tz: ZoneInfo,
    lots: list[dict[str, Any]], bundles: list[dict[str, Any]],
    lines: list[dict[str, Any]],
) -> dict[str, Any]:
    """One grain's buckets and score.

    A bucket's matched_wh is min(consumed, eligible): the certificates its
    allocatable lots could deliver there, whether or not the greedy hourly
    draw reached them. Surplus stays in the bucket and never crosses hours.
    """
    buckets_data: dict[str, dict[str, Any]] = {}
    total_consumed = 0
    total_matched = 0
    for key, bucket_hours in hours_in_buckets(hours, grain, window_month, tz).items():
        consumed = sum((h["consumed_wh"] or 0) for h in bucket_hours)
        eligible = eligible_wh_for(lots, bundles, lines, [h["hour_utc"] for h in bucket_hours])
        matched = min(consumed, eligible)
        buckets_data[key] = {
            "key": key,
            "start_utc": format_hour(bucket_hours[0]["hour_utc"]),
            "end_utc": format_hour(bucket_hours[-1]["hour_utc"] + timedelta(hours=1)),
            "consumed_wh": consumed,
            "eligible_wh": eligible,
            "matched_wh": matched,
            "surplus_wh": eligible - matched,
        }
        total_consumed += consumed
        total_matched += matched
    score = basis_points(total_matched, total_consumed)
    return {"score_bp": score, "buckets": buckets_data,
            "consumed_wh": total_consumed, "matched_wh": total_matched}


def falls_for_coarser(
    finer: dict[str, dict[str, Any]], coarser: dict[str, dict[str, Any]],
    finer_keys_by_parent: dict[str, list[str]],
) -> list[dict[str, Any]]:
    falls = []
    for parent_key, children in finer_keys_by_parent.items():
        parent = coarser[parent_key]
        child_matched = sum(finer[c]["matched_wh"] for c in children)
        detached = parent["matched_wh"] - child_matched
        falls.append({"parent_key": parent_key, "detached_wh": detached})
    return falls


def parent_map(hours: list[dict[str, Any]], finer: str, coarser: str, tz: ZoneInfo) -> dict[str, str]:
    result: dict[str, str] = {}
    for hour in hours:
        fine = bucket_key(hour["hour_utc"], finer, tz)
        coarse = bucket_key(hour["hour_utc"], coarser, tz)
        result.setdefault(fine, coarse)
    return result


# --- Sample --------------------------------------------------------------
def draw_sample(window_id: str, allocation_digest: str, hour_list: list[datetime]) -> list[datetime]:
    """The published hash draw: 25 distinct hours, nobody can choose or swap them."""
    eligible = sorted(set(hour_list))
    n = len(eligible)
    if n == 0:
        return []
    drawn: list[datetime] = []
    drawn_set: set[datetime] = set()
    i = 0
    while len(drawn) < min(25, n):
        payload = f"{window_id}|{allocation_digest}|{i}"
        digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
        value = int(digest[:16], 16)
        pick = eligible[value % n]
        i += 1
        if pick in drawn_set:
            continue
        drawn.append(pick)
        drawn_set.add(pick)
    return drawn


# --- Gap repair ----------------------------------------------------------
def repair_gaps(
    hours: list[dict[str, Any]], tz: ZoneInfo,
) -> tuple[list[datetime], list[datetime]]:
    """Fill Missing hours in place. Returns (filled, unfilled) as UTC hour instants.

    Estimates written by this repair are never sources for another estimate.
    """
    ordered = sorted(hours, key=lambda h: h["hour_utc"])
    index = {h["hour_utc"]: h for h in ordered}
    filled: list[datetime] = []
    unfilled: list[datetime] = []
    missing = [h for h in ordered if h["quality"] == "Missing"]
    if not missing:
        return filled, unfilled
    runs: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    prev: datetime | None = None
    for h in missing:
        if prev is not None and (h["hour_utc"] - prev) == timedelta(hours=1):
            current.append(h)
        else:
            if current:
                runs.append(current)
            current = [h]
        prev = h["hour_utc"]
    if current:
        runs.append(current)

    def usable_source(h: dict[str, Any] | None) -> dict[str, Any] | None:
        """An Actual or Substituted source with a positive reading; never an Estimate."""
        if h is None or h["quality"] not in ("Actual", "Substituted"):
            return None
        if (h["consumed_wh"] or 0) <= 0:
            return None
        return h

    for run in runs:
        before = usable_source(index.get(run[0]["hour_utc"] - timedelta(hours=1)))
        after = usable_source(index.get(run[-1]["hour_utc"] + timedelta(hours=1)))
        if len(run) <= 2 and before is not None and after is not None:
            b = before["consumed_wh"] or 0
            a = after["consumed_wh"] or 0
            n = len(run)
            for i, h in enumerate(run):
                num = b * (n - i) + a * (i + 1)
                den = n + 1
                h["consumed_wh"] = round_half_up_int(num, den)
                h["quality"] = "Estimated"
                filled.append(h["hour_utc"])
            continue
        if len(run) <= 2:
            for h in run:
                unfilled.append(h["hour_utc"])
            continue
        # week-earlier copy, keyed on the local clock hour
        for h in run:
            local = h["hour_utc"].astimezone(tz)
            week_earlier_local = local - timedelta(days=7)
            source_local_dt = week_earlier_local.replace(minute=0, second=0, microsecond=0)
            source_utc = source_local_dt.astimezone(timezone.utc)
            if is_repeated_hour(source_utc, tz) and index.get(source_utc) is None:
                source_utc = source_utc - timedelta(hours=1)
            source = usable_source(index.get(source_utc))
            if source is None:
                unfilled.append(h["hour_utc"])
                continue
            h["consumed_wh"] = source["consumed_wh"]
            h["quality"] = "Estimated"
            filled.append(h["hour_utc"])
    return filled, unfilled


def spread_total(
    hours: list[dict[str, Any]], tz: ZoneInfo, target_hours: list[datetime], total_wh: int,
) -> dict[datetime, int]:
    """Weights by the same local clock hour a week earlier; remainder to largest remainders.

    Only an Actual or Substituted source in this window counts.
    """
    index = {h["hour_utc"]: h for h in hours}
    weights: dict[datetime, int] = {}
    for hour in target_hours:
        local = hour.astimezone(tz)
        source_local_dt = (local - timedelta(days=7)).replace(minute=0, second=0, microsecond=0)
        source_utc = source_local_dt.astimezone(timezone.utc)
        if is_repeated_hour(source_utc, tz) and index.get(source_utc) is None:
            source_utc = source_utc - timedelta(hours=1)
        source = index.get(source_utc)
        if source is None or source["quality"] not in ("Actual", "Substituted"):
            weights[hour] = 0
        else:
            weights[hour] = source["consumed_wh"] or 0
    if any(w == 0 for w in weights.values()) or sum(weights.values()) == 0:
        weights = {hour: 1 for hour in weights}
    W = sum(weights.values())
    shares: dict[datetime, int] = {}
    remainders: list[tuple[int, datetime]] = []
    assigned = 0
    for hour in sorted(target_hours):
        w = weights[hour]
        share = (total_wh * w) // W
        shares[hour] = share
        assigned += share
        remainders.append(((total_wh * w) % W, hour))
    leftover = total_wh - assigned
    remainders.sort(key=lambda pair: (-pair[0], pair[1]))
    for i in range(leftover):
        shares[remainders[i][1]] += 1
    return shares

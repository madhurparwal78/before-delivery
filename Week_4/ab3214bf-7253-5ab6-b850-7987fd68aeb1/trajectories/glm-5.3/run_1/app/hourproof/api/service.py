"""The window service: loading a window, recomputing allocation, writing the
ledger, and publishing the API view. Every figure rule goes through here.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import asyncpg

from .. import clock
from ..domain import rules
from ..domain.exact import grams_for, round_half_up_int
from ..domain.states import IN_REVIEW
from ..domain.timeline import (
    format_hour, format_instant, local_label, month_hours_utc, is_repeated_hour,
)


async def load_window(conn: asyncpg.Connection, window_id: str) -> dict[str, Any] | None:
    row = await conn.fetchrow("SELECT * FROM windows WHERE id = $1", window_id)
    return dict(row) if row else None


async def load_site(conn: asyncpg.Connection, site_id: str) -> dict[str, Any] | None:
    row = await conn.fetchrow("SELECT * FROM sites WHERE id = $1", site_id)
    return dict(row) if row else None


async def load_hours(conn: asyncpg.Connection, window_id: str) -> list[dict[str, Any]]:
    rows = await conn.fetch("SELECT * FROM hours WHERE window_id = $1 ORDER BY hour_utc", window_id)
    return [dict(r) for r in rows]


async def load_lots(conn: asyncpg.Connection, window_id: str) -> list[dict[str, Any]]:
    rows = await conn.fetch("SELECT * FROM lots WHERE window_id = $1 ORDER BY rank", window_id)
    return [dict(r) for r in rows]


async def load_bundles(conn: asyncpg.Connection, window_id: str) -> list[dict[str, Any]]:
    rows = await conn.fetch("SELECT * FROM bundles WHERE window_id = $1", window_id)
    return [dict(r) for r in rows]


async def load_lines(conn: asyncpg.Connection, window_id: str) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        "SELECT * FROM lines WHERE window_id = $1 ORDER BY hour_utc, bundle_id", window_id
    )
    return [dict(r) for r in rows]


def tz_for(site: dict[str, Any]) -> ZoneInfo:
    return ZoneInfo(site["time_zone"])


# --- lot status ------------------------------------------------------------
def computed_lot_statuses(site: dict[str, Any], lots: list[dict[str, Any]],
                          lines: list[dict[str, Any]], now: datetime) -> dict[str, str]:
    statuses: dict[str, str] = {}
    for lot in lots:
        lot_lines = [l for l in lines if l["lot_id"] == lot["id"]]
        has_lines = bool(lot_lines)
        all_confirmed = has_lines and all(l["status"] == "Confirmed" for l in lot_lines)
        any_pending = any(l["status"] == "Pending" for l in lot_lines)
        statuses[lot["id"]] = rules.lot_status(
            site["zone"], lot["zone"], has_lines, all_confirmed, lot["cancel_by"],
            now, lot["excluded"], any_pending,
        )
    return statuses


def decorate_lots(site: dict[str, Any], lots: list[dict[str, Any]],
                  lines: list[dict[str, Any]], now: datetime) -> None:
    statuses = computed_lot_statuses(site, lots, lines, now)
    for lot in lots:
        lot["computed_status"] = statuses[lot["id"]]


# --- allocation -----------------------------------------------------------
async def recompute_allocation(conn: asyncpg.Connection, window: dict[str, Any],
                               site: dict[str, Any]) -> tuple[list[dict[str, Any]], str]:
    """Compute this window's lines, write the ledger diff, store the digest."""
    window_id = window["id"]
    hours = await load_hours(conn, window_id)
    lots = await load_lots(conn, window_id)
    bundles = await load_bundles(conn, window_id)
    lines = await load_lines(conn, window_id)
    now = clock.now()
    decorate_lots(site, lots, lines, now)
    new_lines = rules.compute_allocation(window_id, hours, lots, bundles, lines, now, site["zone"])
    digest = rules.lines_digest(new_lines)
    standing_unfixed = {l["line_id"] for l in lines if l["status"] == "Unsubmitted"}
    new_unfixed = {l["line_id"] for l in new_lines if l["status"] == "Unsubmitted"}
    if standing_unfixed != new_unfixed:
        await _write_ledger_diff(conn, window, site, lots, bundles, lines, new_lines, now)
        await conn.execute(
            "DELETE FROM lines WHERE window_id = $1 AND status = 'Unsubmitted'", window_id
        )
        for line in new_lines:
            if line["status"] != "Unsubmitted":
                continue
            await conn.execute(
                "INSERT INTO lines (line_id, window_id, hour_utc, lot_id, bundle_id,"
                " range_start_wh, range_end_wh, wh, status, reason, created_at)"
                " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Unsubmitted',$9,$10)"
                " ON CONFLICT (line_id) DO NOTHING",
                line["line_id"], window_id, line["hour_utc"], line["lot_id"],
                line["bundle_id"], line["range_start_wh"], line["range_end_wh"],
                line["wh"], None, now,
            )
    await conn.execute(
        "UPDATE windows SET allocation_digest = $1 WHERE id = $2", digest, window_id
    )
    window["allocation_digest"] = digest
    return new_lines, digest


async def _write_ledger_diff(conn: asyncpg.Connection, window: dict[str, Any],
                             site: dict[str, Any], lots: list[dict[str, Any]],
                             bundles: list[dict[str, Any]], old_lines: list[dict[str, Any]],
                             new_lines: list[dict[str, Any]], now: datetime) -> None:
    window_id = window["id"]
    lot_names = {lot["id"]: lot["name"] for lot in lots}
    lot_battery = {lot["id"]: lot["battery_shifted"] for lot in lots}
    movement_base = uuid.uuid4().hex[:12]
    counter = 0

    async def movement(kind: str, from_acct: str, to_acct: str, wh: int, lot_id: str,
                       bundle_id: str, line_id: str | None, label: str) -> None:
        nonlocal counter
        counter += 1
        mid = f"{movement_base}-{counter:04d}"
        for account, amount in ((from_acct, -wh), (to_acct, wh)):
            await conn.execute(
                "INSERT INTO ledger_entries (movement_id, kind, account, wh, window_id,"
                " lot_id, bundle_id, line_id, label, at)"
                " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
                mid, kind, account, amount, window_id, lot_id, bundle_id, line_id, label, now,
            )

    for line in old_lines:
        if line["status"] != "Unsubmitted":
            continue
        await movement("return", "allocated", "holdings", line["wh"], line["lot_id"],
                       line["bundle_id"], line["line_id"],
                       f"Return {lot_names.get(line['lot_id'], '')}")
    for line in new_lines:
        if line["status"] != "Unsubmitted":
            continue
        await movement("allocate", "holdings", "allocated", line["wh"], line["lot_id"],
                       line["bundle_id"], line["line_id"],
                       f"Allocate {lot_names.get(line['lot_id'], '')}")
        bundle = next((b for b in bundles if b["bundle_id"] == line["bundle_id"]), None)
        if bundle is not None and lot_battery.get(bundle["lot_id"], False):
            bv = rules.BundleView(
                bundle["bundle_id"], bundle["lot_id"], bundle["production_hour"],
                bundle["discharge_hour"], int(bundle["range_start_wh"]),
                int(bundle["range_end_wh"]), True,
            )
            if bv.loss > 0:
                await movement("battery_loss", "holdings", "loss", bv.loss, line["lot_id"],
                               line["bundle_id"], None,
                               f"Battery loss {lot_names.get(line['lot_id'], '')}")


# --- balances ---------------------------------------------------------------
async def balances_for(conn: asyncpg.Connection, window_id: str) -> dict[str, Any]:
    rows = await conn.fetch(
        "SELECT account, SUM(wh) AS total FROM ledger_entries WHERE window_id = $1"
        " GROUP BY account", window_id,
    )
    by_account = {r["account"]: r["total"] or 0 for r in rows}
    opening_row = await conn.fetchrow(
        "SELECT SUM(wh) AS total FROM ledger_entries WHERE window_id = $1 AND kind = 'deposit'",
        window_id,
    )
    opening = opening_row["total"] or 0
    return {
        "opening_wh": opening,
        "holdings_wh": by_account.get("holdings", 0),
        "allocated_wh": by_account.get("allocated", 0),
        "cancelled_wh": by_account.get("cancelled", 0),
        "loss_wh": by_account.get("loss", 0),
    }


# --- scores -------------------------------------------------------------------
def consumed_of(hours: list[dict[str, Any]]) -> int:
    return sum(h["consumed_wh"] or 0 for h in hours)


def matched_total(lines: list[dict[str, Any]], hours: list[dict[str, Any]]) -> int:
    matched_map = rules.hour_matched(lines)
    return sum(min(h["consumed_wh"] or 0, matched_map.get(h["hour_utc"], 0)) for h in hours)


def unmatched_hours_count(hours: list[dict[str, Any]], lines: list[dict[str, Any]]) -> int:
    matched_map = rules.hour_matched(lines)
    count = 0
    for h in hours:
        consumed = h["consumed_wh"] or 0
        if consumed > 0 and matched_map.get(h["hour_utc"], 0) < consumed:
            count += 1
    return count


def non_actual_bp(hours: list[dict[str, Any]]) -> int:
    consumed = consumed_of(hours)
    if consumed == 0:
        return 0
    non_actual = sum(h["consumed_wh"] or 0 for h in hours if h["quality"] != "Actual")
    return round_half_up_int(non_actual * 10000, consumed)


def grain_scores(hours: list[dict[str, Any]], window_month: str, tz: ZoneInfo,
                 lots: list[dict[str, Any]], bundles: list[dict[str, Any]],
                 lines: list[dict[str, Any]]) -> dict[str, int]:
    scores: dict[str, int] = {}
    for grain in rules.GRAINS:
        scores[grain] = rules.score_for_grain(hours, grain, window_month, tz, lots, bundles, lines)["score_bp"]
    return scores


def residual_emissions(hours: list[dict[str, Any]], lines: list[dict[str, Any]]) -> int | None:
    matched_map = rules.hour_matched(lines)
    total = 0
    missing_factor = False
    for h in hours:
        consumed = h["consumed_wh"] or 0
        unmatched = consumed - matched_map.get(h["hour_utc"], 0)
        if unmatched > 0:
            factor = h["grid_g_per_kwh"]
            if factor is None:
                missing_factor = True
                continue
            total += grams_for(unmatched, factor)
    return None if missing_factor else total


# --- revision -------------------------------------------------------------------
async def bump_revision(conn: asyncpg.Connection, window: dict[str, Any],
                        writer_name: str) -> None:
    now = clock.now()
    await conn.execute(
        "UPDATE windows SET revision = revision + 1, last_writer_name = $1, wrote_at = $2"
        " WHERE id = $3", writer_name, now, window["id"],
    )
    window["revision"] = window["revision"] + 1
    window["last_writer_name"] = writer_name
    window["wrote_at"] = now


# --- window JSON view -------------------------------------------------------------
async def window_json(conn: asyncpg.Connection, window: dict[str, Any]) -> dict[str, Any]:
    site = await load_site(conn, window["site_id"])
    now = clock.now()
    hours = await load_hours(conn, window["id"])
    lots = await load_lots(conn, window["id"])
    bundles = await load_bundles(conn, window["id"])
    lines = await load_lines(conn, window["id"])
    decorate_lots(site, lots, lines, now)
    tz = tz_for(site)
    scores = grain_scores(hours, window["month"], tz, lots, bundles, lines)
    consumed = consumed_of(hours)
    matched = matched_total(lines, hours)
    missing = sum(1 for h in hours if h["quality"] == "Missing")
    non_actual = sum(h["consumed_wh"] or 0 for h in hours if h["quality"] != "Actual")
    na_bp = round_half_up_int(non_actual * 10000, consumed) if consumed else 0
    residual = residual_emissions(hours, lines)
    opens_seconds = None
    if now < window["opens_at"]:
        opens_seconds = max(1, int((window["opens_at"] - now).total_seconds()))
    review_seconds = None
    if window["state"] == IN_REVIEW and window["review_deadline"] is not None:
        left = (window["review_deadline"] - now).total_seconds()
        review_seconds = max(1, int(left + 0.999999)) if left > 0 else None
    firm = None
    if window["verifier_firm_id"]:
        row = await conn.fetchrow("SELECT id, name FROM firms WHERE id = $1", window["verifier_firm_id"])
        firm = {"id": row["id"], "name": row["name"]} if row else None
    if window["target_grain"] is not None:
        target = {"grain": window["target_grain"], "bp": window["target_bp"]}
    else:
        target = {"grain": site["target_grain"], "bp": site["target_bp"]}
    grain_map = {"MONTH": "month", "WEEK": "week", "DAY": "day", "HOUR": "hour"}
    target_met = scores[grain_map[target["grain"]]] >= target["bp"]
    exceptions = await conn.fetchval(
        "SELECT COUNT(*) FROM sample_hours WHERE window_id = $1 AND result = 'exception'",
        window["id"],
    )
    opinion = "Qualified" if (non_actual * 100 > consumed * 5 or exceptions > 0) else "Unqualified"
    confirmed = sum(1 for l in lines if l["status"] == "Confirmed")
    return {
        "id": window["id"],
        "site": {"id": site["id"], "name": site["name"], "zone": site["zone"],
                 "time_zone": site["time_zone"], "meter_id": site["meter_id"]},
        "month": window["month"],
        "state": window["state"],
        "revision": window["revision"],
        "hour_count": len(hours),
        "opens_at": format_instant(window["opens_at"]),
        "opens_seconds_left": opens_seconds,
        "review_seconds_left": review_seconds,
        "scores": {"month_bp": scores["month"], "week_bp": scores["week"],
                   "day_bp": scores["day"], "hour_bp": scores["hour"]},
        "consumed_wh": consumed,
        "unmatched_wh": consumed - matched,
        "unmatched_hours": unmatched_hours_count(hours, lines),
        "missing_hours": missing,
        "non_actual_bp": na_bp,
        "residual_emissions_g": residual,
        "opinion": opinion,
        "target": {"grain": target["grain"], "bp": target["bp"], "met": target_met},
        "verifier_firm": firm,
        "returned_reason": window["returned_reason"],
        "registry_reachable": window["registry_reachable"],
        "seal_status": window["seal_status"],
        "statement_code": window["statement_code"],
        "allocation_digest": window["allocation_digest"],
        "predecessor_id": window["predecessor_id"],
        "successor_id": window["successor_id"],
        "last_writer_name": window["last_writer_name"],
        "lines_confirmed": confirmed,
        "lines_total": len(lines),
    }

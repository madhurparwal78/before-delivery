"""The analyst's desk: meters, gaps, lots, allocation, holdings and submission."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from flask import Blueprint, request

from .. import clock, db, engine, store, views
from ..db import Cursor
from ..domain import allocation, repair, spread, states
from ..domain import lots as lot_rules
from ..domain.model import ACTUAL, ESTIMATED, SUBSTITUTED, Hour, Lot, WindowRecord
from ..domain.sample import draw
from ..domain.units import READINGS_PER_HOUR, NotWholeWattHour, to_watt_hours
from ..errors import (
    field_error,
    hour_is_actual,
    hour_not_spreadable,
    hours_missing,
    no_verifier,
    not_found,
    not_whole_watt_hour,
    meter_hub_unavailable,
    registry_unavailable_holdings,
    window_not_open,
)
from ..services import meterhub, registry
from ..services.http import ProviderUnavailable
from . import (
    ANALYST,
    LEAD,
    Account,
    envelope,
    read_body,
    readable_window,
    readable_windows,
    require_account,
    require_revision,
    require_role,
    require_state,
    text_field,
    whole_number,
)

desk = Blueprint("desk", __name__)

WATT_HOUR_LIMIT = 1000000000000
REASON_LIMIT = 500


def _reload(cursor: Cursor, window_id: str) -> WindowRecord:
    window = store.load_window(cursor, window_id)
    assert window is not None
    return window


def _window_body(cursor: Cursor, window_id: str, extra: dict[str, Any] | None = None):
    body = views.window_json(cursor, _reload(cursor, window_id))
    body.update(extra or {})
    return envelope(body)


def _begin_write(
    cursor: Cursor, window_id: str, action: str, body: dict[str, Any]
) -> tuple[Account, WindowRecord]:
    """Every analyst write in the published refusal order."""
    account = require_account(cursor)
    window = readable_window(cursor, account, window_id, lock=True)
    require_role(account, ANALYST)
    require_state(window, action)
    require_revision(body, window)
    return account, window


@desk.get("/windows")
def list_windows():
    with db.tx() as cursor:
        account = require_account(cursor)
        windows = readable_windows(cursor, account)
        wanted = request.args.get("state")
        if wanted in states.ALL:
            windows = [window for window in windows if window.state == wanted]
        return envelope(
            {"windows": [views.window_json(cursor, window) for window in windows]}
        )


@desk.get("/windows/<window_id>")
def read_window(window_id: str):
    with db.tx() as cursor:
        account = require_account(cursor)
        window = readable_window(cursor, account, window_id)
        return envelope(views.window_json(cursor, window))


@desk.get("/windows/<window_id>/grains/<grain>")
def read_grain(window_id: str, grain: str):
    with db.tx() as cursor:
        account = require_account(cursor)
        window = readable_window(cursor, account, window_id)
        if grain not in ("month", "week", "day", "hour"):
            raise not_found()
        return envelope(views.grain_json(window, grain, engine.figures(window)))


@desk.get("/windows/<window_id>/hours/<hour>")
def read_hour(window_id: str, hour: str):
    with db.tx() as cursor:
        account = require_account(cursor)
        window = readable_window(cursor, account, window_id)
        body = views.hour_json(window, _hour_instant(hour), engine.figures(window))
        if body is None:
            raise not_found()
        return envelope(body)


def _hour_instant(text: str) -> datetime:
    try:
        return clock.parse_hour(text)
    except ValueError:
        raise not_found() from None


@desk.post("/windows/<window_id>/meters/pull")
def pull_meters(window_id: str):
    body = read_body()
    with db.tx() as cursor:
        account, window = _begin_write(cursor, window_id, "meter_pull", body)
        if clock.now() < window.opens_at:
            raise window_not_open(clock.instant(window.opens_at))
        readings = _read_meters(window)
        hours_read = 0
        for hour in sorted(window.hours, key=lambda row: row.hour_utc):
            value = readings.get(hour.hour_utc)
            if value is None:
                continue
            hours_read += 1
            if hour.correction_version > 0:
                continue
            store.write_hour(
                cursor,
                window,
                Hour(
                    hour_utc=hour.hour_utc,
                    consumed_wh=value,
                    quality=ACTUAL,
                    substitution_reason=None,
                    correction_version=hour.correction_version,
                ),
            )
        store.set_state(cursor, window, states.after_meter_pull(window.state))
        store.bump_revision(cursor, window, account.name)
        engine.recompute(cursor, window)
        return _window_body(cursor, window_id, {"hours_read": hours_read})


def _read_meters(window: WindowRecord) -> dict[datetime, int]:
    """Complete hours only: a missing interval leaves its hour as it was."""
    try:
        runs = meterhub.readings(
            window.site.meter_id,
            clock.hour(window.start_utc),
            clock.instant(window.end_utc),
        )
    except ProviderUnavailable:
        raise meter_hub_unavailable() from None
    collected: dict[datetime, dict[int, list[int]]] = {}
    for number, run in enumerate(runs, start=1):
        interval = int(run["interval_minutes"])
        if interval not in READINGS_PER_HOUR:
            raise not_whole_watt_hour(number)
        try:
            value = to_watt_hours(run["value"], run["unit"])
        except NotWholeWattHour:
            raise not_whole_watt_hour(number) from None
        start = clock.parse_instant(run["start"])
        for index in range(int(run["count"])):
            at = start + timedelta(minutes=interval * index)
            hour_utc = at.replace(minute=0, second=0, microsecond=0)
            collected.setdefault(hour_utc, {}).setdefault(interval, []).append(value)
    complete: dict[datetime, int] = {}
    for hour_utc, by_interval in collected.items():
        for interval, values in by_interval.items():
            if len(values) == READINGS_PER_HOUR[interval]:
                complete[hour_utc] = sum(values)
    return complete


@desk.post("/windows/<window_id>/gaps/repair")
def repair_gaps(window_id: str):
    body = read_body()
    with db.tx() as cursor:
        account, window = _begin_write(cursor, window_id, "repair", body)
        filled, unfilled = repair.repair_gaps(window.hours, window.site.time_zone)
        for hour_utc, value in filled:
            store.write_hour(
                cursor,
                window,
                Hour(
                    hour_utc=hour_utc,
                    consumed_wh=value,
                    quality=ESTIMATED,
                    substitution_reason=None,
                    correction_version=0,
                ),
            )
        store.bump_revision(cursor, window, account.name)
        engine.recompute(cursor, window)
        return envelope(
            {
                "filled": [clock.hour(hour_utc) for hour_utc, _ in filled],
                "unfilled": [clock.hour(hour_utc) for hour_utc in unfilled],
                "window": views.window_json(cursor, _reload(cursor, window_id)),
            }
        )


@desk.put("/windows/<window_id>/hours/<hour>/substitution")
def substitute_hour(window_id: str, hour: str):
    body = read_body()
    hour_utc = _hour_instant(hour)
    with db.tx() as cursor:
        account = require_account(cursor)
        window = readable_window(cursor, account, window_id, lock=True)
        existing = next(
            (row for row in window.hours if row.hour_utc == hour_utc), None
        )
        if existing is None:
            raise not_found()
        require_role(account, ANALYST)
        require_state(window, "substitution")
        require_revision(body, window)
        if not repair.may_substitute(existing.quality):
            raise hour_is_actual()
        value_wh = whole_number(body, "value_wh", 0, WATT_HOUR_LIMIT)
        reason = text_field(body, "reason", REASON_LIMIT)
        store.write_hour(
            cursor,
            window,
            Hour(
                hour_utc=hour_utc,
                consumed_wh=value_wh,
                quality=SUBSTITUTED,
                substitution_reason=reason,
                correction_version=existing.correction_version,
            ),
        )
        store.bump_revision(cursor, window, account.name)
        engine.recompute(cursor, window)
        return _window_body(cursor, window_id)


@desk.post("/windows/<window_id>/hours/spread")
def spread_total(window_id: str):
    body = read_body()
    with db.tx() as cursor:
        account = require_account(cursor)
        window = readable_window(cursor, account, window_id, lock=True)
        require_role(account, ANALYST)
        chosen = _spread_hours(body)
        by_hour = {row.hour_utc: row for row in window.hours}
        if any(hour_utc not in by_hour for hour_utc in chosen):
            raise not_found()
        require_state(window, "spread")
        require_revision(body, window)
        if any(not repair.may_spread(by_hour[hour].quality) for hour in chosen):
            raise hour_not_spreadable()
        total_wh = whole_number(body, "total_wh", 0, WATT_HOUR_LIMIT)
        reason = text_field(body, "reason", REASON_LIMIT)
        weights = spread.weights(window.hours, chosen, window.site.time_zone)
        for hour_utc, share in zip(chosen, spread.shares(total_wh, weights)):
            store.write_hour(
                cursor,
                window,
                Hour(
                    hour_utc=hour_utc,
                    consumed_wh=share,
                    quality=SUBSTITUTED,
                    substitution_reason=reason,
                    correction_version=by_hour[hour_utc].correction_version,
                ),
            )
        store.bump_revision(cursor, window, account.name)
        engine.recompute(cursor, window)
        return _window_body(cursor, window_id)


def _spread_hours(body: dict[str, Any]) -> list[datetime]:
    sent = body.get("hours")
    if not isinstance(sent, list) or not spread.MINIMUM_HOURS <= len(sent) <= spread.MAXIMUM_HOURS:
        raise field_error("hours")
    hours: list[datetime] = []
    for entry in sent:
        if not isinstance(entry, str):
            raise field_error("hours")
        try:
            hours.append(clock.parse_hour(entry))
        except ValueError:
            raise field_error("hours") from None
    for earlier, later in zip(hours, hours[1:]):
        if later - earlier != timedelta(hours=1):
            raise field_error("hours")
    return hours


@desk.post("/windows/<window_id>/allocation")
def rerun_allocation(window_id: str):
    body = read_body()
    with db.tx() as cursor:
        account, window = _begin_write(cursor, window_id, "allocation", body)
        store.bump_revision(cursor, window, account.name)
        engine.recompute(cursor, window)
        fresh = _reload(cursor, window_id)
        live = store.live_lines(fresh)
        return envelope(
            {
                "lines": views.lines_json(fresh, live),
                "allocation_digest": allocation.digest(live),
                "window": views.window_json(cursor, fresh),
            }
        )


@desk.get("/windows/<window_id>/lots")
def read_lots(window_id: str):
    with db.tx() as cursor:
        account = require_account(cursor)
        window = readable_window(cursor, account, window_id)
        return envelope({"lots": views.lots_json(window)})


@desk.put("/windows/<window_id>/merit-order")
def set_merit_order(window_id: str):
    body = read_body()
    with db.tx() as cursor:
        account, window = _begin_write(cursor, window_id, "merit_order", body)
        sent = body.get("lot_ids")
        held = sorted(lot.lot_id for lot in window.lots)
        if (
            not isinstance(sent, list)
            or not all(isinstance(entry, str) for entry in sent)
            or sorted(sent) != held
        ):
            raise field_error("lot_ids")
        for rank, lot_id in enumerate(sent, start=1):
            cursor.execute(
                "UPDATE lots SET rank = %s WHERE window_id = %s AND lot_id = %s",
                (rank, window.id, lot_id),
            )
        store.bump_revision(cursor, window, account.name)
        fresh = _reload(cursor, window_id)
        engine.recompute(cursor, fresh)
        fresh = _reload(cursor, window_id)
        return envelope(
            {
                "lots": views.lots_json(fresh),
                "window": views.window_json(cursor, fresh),
            }
        )


@desk.put("/windows/<window_id>/lots/<lot_id>/exclusion")
def set_exclusion(window_id: str, lot_id: str):
    body = read_body()
    with db.tx() as cursor:
        account = require_account(cursor)
        window = readable_window(cursor, account, window_id, lock=True)
        lot = next((row for row in window.lots if row.lot_id == lot_id), None)
        if lot is None:
            raise not_found()
        require_role(account, ANALYST)
        require_state(window, "exclusion")
        require_revision(body, window)
        excluded = body.get("excluded")
        if not isinstance(excluded, bool):
            raise field_error("excluded")
        cursor.execute(
            "UPDATE lots SET excluded = %s WHERE window_id = %s AND lot_id = %s",
            (excluded, window.id, lot_id),
        )
        store.bump_revision(cursor, window, account.name)
        fresh = _reload(cursor, window_id)
        engine.recompute(cursor, fresh)
        fresh = _reload(cursor, window_id)
        now = clock.now()
        changed = next(row for row in fresh.lots if row.lot_id == lot_id)
        return envelope(
            {
                "lot": views.lot_json(fresh, changed, now),
                "window": views.window_json(cursor, fresh),
            }
        )


@desk.post("/windows/<window_id>/holdings/sync")
def sync_holdings(window_id: str):
    body = read_body()
    with db.tx() as cursor:
        account, window = _begin_write(cursor, window_id, "sync", body)
        added, held_elsewhere = _import_holdings(cursor, window)
        store.bump_revision(cursor, window, account.name)
        fresh = _reload(cursor, window_id)
        engine.recompute(cursor, fresh)
        balances = store.account_balances(cursor, window.id)
        return envelope(
            {
                "added": added,
                "opening_wh": -balances.get("registry", 0),
                "held_elsewhere": held_elsewhere,
                "window": views.window_json(cursor, _reload(cursor, window_id)),
            }
        )


def _touched_months(window: WindowRecord) -> list[str]:
    months = sorted({hour.hour_utc.strftime("%Y-%m") for hour in window.hours})
    return months


def _import_holdings(
    cursor: Cursor, window: WindowRecord
) -> tuple[int, list[dict[str, str]]]:
    offered: dict[str, dict[str, Any]] = {}
    for month in _touched_months(window):
        try:
            bundles = registry.holdings(month)
        except ProviderUnavailable:
            store.set_field(cursor, window, "registry_reachable", False)
            raise registry_unavailable_holdings() from None
        for bundle in bundles:
            offered.setdefault(bundle["bundle_id"], bundle)
    store.set_field(cursor, window, "registry_reachable", True)
    held = {bundle.bundle_id for bundle in window.bundles}
    added = 0
    held_elsewhere: list[dict[str, str]] = []
    for bundle_id, bundle in offered.items():
        if bundle_id in held:
            continue
        same_zone = bundle["zone"] == window.site.zone
        if same_zone:
            claim = cursor.one(
                "SELECT base_id, window_id FROM bundle_claims WHERE bundle_id = %s"
                " FOR UPDATE",
                (bundle_id,),
            )
            if claim is not None and claim["base_id"] != window.base_id:
                held_elsewhere.append(
                    {"bundle_id": bundle_id, "window_id": claim["window_id"]}
                )
                continue
            if claim is None:
                cursor.execute(
                    "INSERT INTO bundle_claims (bundle_id, base_id, window_id)"
                    " VALUES (%s, %s, %s)",
                    (bundle_id, window.base_id, window.id),
                )
        _import_bundle(cursor, window, bundle)
        added += 1
    return added, held_elsewhere


def _import_bundle(cursor: Cursor, window: WindowRecord, bundle: dict[str, Any]) -> None:
    lot_id = bundle["lot_ref"]
    production_hour = clock.parse_instant(bundle["production_hour"])
    discharge_hour = (
        clock.parse_instant(bundle["discharge_hour"])
        if bundle.get("discharge_hour")
        else None
    )
    known = {lot.lot_id for lot in window.lots}
    if lot_id not in known:
        production_month = production_hour.strftime("%Y-%m")
        rank = max((lot.rank for lot in window.lots), default=0) + 1
        cursor.execute(
            "INSERT INTO lots (window_id, lot_id, name, technology, zone, rank,"
            " excluded, battery_shifted, production_month, cancel_by)"
            " VALUES (%s, %s, %s, %s, %s, %s, false, %s, %s, %s)",
            (
                window.id,
                lot_id,
                bundle["lot_name"],
                bundle["technology"],
                bundle["zone"],
                rank,
                bool(bundle.get("battery_shifted")),
                production_month,
                lot_rules.cancel_by(production_month),
            ),
        )
        window.lots.append(
            Lot(
                lot_id=lot_id,
                name=bundle["lot_name"],
                technology=bundle["technology"],
                zone=bundle["zone"],
                rank=rank,
                excluded=False,
                battery_shifted=bool(bundle.get("battery_shifted")),
                production_month=production_month,
                cancel_by=lot_rules.cancel_by(production_month),
            )
        )
    cursor.execute(
        "INSERT INTO bundles (window_id, bundle_id, lot_id, battery_shifted,"
        " production_hour, discharge_hour, range_start_wh, range_end_wh)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
        (
            window.id,
            bundle["bundle_id"],
            lot_id,
            bool(bundle.get("battery_shifted")),
            production_hour,
            discharge_hour,
            int(bundle["range_start_wh"]),
            int(bundle["range_end_wh"]),
        ),
    )
    store.movement(
        cursor,
        "deposit",
        "registry",
        "holdings",
        int(bundle["range_end_wh"]) - int(bundle["range_start_wh"]),
        window.id,
        lot_id,
        bundle["bundle_id"],
    )


@desk.get("/windows/<window_id>/ledger")
def read_ledger(window_id: str):
    with db.tx() as cursor:
        account = require_account(cursor)
        require_role(account, ANALYST, LEAD)
        window = readable_window(cursor, account, window_id)
        page = max(1, int(request.args.get("page") or 1))
        total = int(
            cursor.value(
                "SELECT COUNT(*) FROM ledger_entries WHERE window_id = %s", (window.id,)
            )
        )
        rows = cursor.all(
            "SELECT * FROM ledger_entries WHERE window_id = %s"
            " ORDER BY at DESC, movement_id DESC, wh ASC LIMIT 200 OFFSET %s",
            (window.id, (page - 1) * 200),
        )
        names = {lot.lot_id: lot.name for lot in window.lots}
        balances = store.account_balances(cursor, window.id)
        return envelope(
            {
                "opening_wh": -balances.get("registry", 0),
                "balances": {
                    "holdings_wh": balances.get("holdings", 0),
                    "allocated_wh": balances.get("allocated", 0),
                    "cancelled_wh": balances.get("cancelled", 0),
                    "loss_wh": balances.get("loss", 0),
                },
                "entries": [
                    {
                        "movement_id": row["movement_id"],
                        "kind": row["kind"],
                        "account": row["account"],
                        "wh": int(row["wh"]),
                        "lot_id": row["lot_id"],
                        "bundle_id": row["bundle_id"],
                        "line_id": row["line_id"],
                        "label": _label(row["kind"], names.get(row["lot_id"])),
                        "at": clock.instant(row["at"]),
                    }
                    for row in rows
                ],
                "page": page,
                "page_count": max(1, (total + 199) // 200),
            }
        )


def _label(kind: str, lot_name: str | None) -> str:
    words = {
        "deposit": "Deposit",
        "allocate": "Allocate",
        "battery_loss": "Battery loss",
        "cancel": "Cancel",
        "return": "Return",
    }
    return f"{words[kind]} {lot_name}" if lot_name else words[kind]


@desk.post("/windows/<window_id>/submit")
def submit_window(window_id: str):
    body = read_body()
    with db.tx() as cursor:
        account, window = _begin_write(cursor, window_id, "submit", body)
        if window.verifier_firm_id is None:
            raise no_verifier()
        figs = engine.figures(window)
        if figs.missing_hours:
            raise hours_missing(figs.missing_hours)
        live = store.live_lines(window)
        digest = allocation.digest(live)
        existing = store.sample_rows(cursor, window.id)
        if not existing or existing[0]["allocation_digest"] != digest:
            hours = [
                hour.hour_utc
                for hour in sorted(window.hours, key=lambda row: row.hour_utc)
                if (hour.consumed_wh or 0) > 0
            ]
            store.write_sample(cursor, window.id, digest, draw(window.id, digest, hours))
        store.set_field(cursor, window, "submitted_at", clock.now())
        store.set_field(cursor, window, "returned_reason", None)
        store.set_state(cursor, window, states.IN_REVIEW)
        store.bump_revision(cursor, window, account.name)
        return _window_body(cursor, window_id)


@desk.post("/windows/<window_id>/resume")
def resume_window(window_id: str):
    body = read_body()
    with db.tx() as cursor:
        account, window = _begin_write(cursor, window_id, "resume", body)
        store.set_field(cursor, window, "returned_reason", None)
        store.set_state(cursor, window, states.RECONCILING)
        store.bump_revision(cursor, window, account.name)
        return _window_body(cursor, window_id)

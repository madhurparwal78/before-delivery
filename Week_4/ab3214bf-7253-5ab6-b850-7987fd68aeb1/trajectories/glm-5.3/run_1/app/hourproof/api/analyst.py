"""Analyst writes: meter pull, gap repair, substitution, spread, merit order,
exclusion, allocation rerun, holdings sync, submit, resume and cancellation.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from .. import clock, config
from ..copy import message_for
from ..domain import rules
from ..domain.exact import to_wh
from ..domain.states import (
    AWAITING_METERS, CANCELLING, CANCELLING as CANCELLING_STATE, IN_REVIEW, RECONCILING,
    RETURNED,
)
from ..domain.timeline import (
    format_hour, format_instant, month_hours_utc, parse_hour,
)
from ..providers.services import GRID_FEED, METER_HUB, REGISTRY, ProviderUnavailable
from . import errors
from .routes import (
    Ctx, analyst_window, apply_deadline_transitions, bool_field, check_revision,
    get_window_for, in_state, int_field, line_json, text_field,
)
from .service import (
    balances_for, bump_revision, decorate_lots, load_bundles, load_hours, load_lines,
    load_lots, load_site, load_window, recompute_allocation, tz_for, window_json,
)


async def pull_meters(ctx: Ctx, window_id: str) -> dict[str, Any]:
    user = ctx.require("analyst")
    window = await analyst_window(ctx, window_id)
    await check_revision(window, ctx.body.get("revision"))
    in_state(window, (AWAITING_METERS, RECONCILING))
    now = clock.now()
    if now < window["opens_at"]:
        raise errors.ApiError(
            409, "WINDOW_NOT_OPEN",
            message_for("WINDOW_NOT_OPEN", opens_at=format_instant(window["opens_at"])),
        )
    site = await load_site(ctx.conn, window["site_id"])
    tz = tz_for(site)
    hours = await load_hours(ctx.conn, window_id)
    first = format_hour(hours[0]["hour_utc"])
    last_end = format_instant(hours[-1]["hour_utc"] + timedelta(hours=1))
    try:
        runs = await METER_HUB.readings(site["meter_id"], first, last_end)
    except ProviderUnavailable:
        raise errors.dependency("METER_HUB_UNAVAILABLE")
    read: dict[str, int] = {}
    line_no = 1
    for run in runs:
        start = parse_hour(run.get("start"))
        interval = run.get("interval_minutes")
        count = run.get("count")
        unit = run.get("unit")
        value = run.get("value")
        if start is None or interval not in (15, 30, 60) or not isinstance(count, int):
            continue
        if unit not in ("kWh", "MWh") or not isinstance(value, str):
            continue
        for i in range(count):
            inst = start + timedelta(minutes=interval * i)
            wh = to_wh(value, unit)
            if wh is None:
                raise errors.ApiError(
                    422, "NOT_WHOLE_WATT_HOUR",
                    message_for("NOT_WHOLE_WATT_HOUR", n=line_no),
                )
            read[format_hour(inst)] = read.get(format_hour(inst), 0) + wh
            line_no += 1
    for row in hours:
        key = format_hour(row["hour_utc"])
        if key not in read:
            continue
        if row["correction_version"] > 0:
            continue
        value = read[key]
        if row["quality"] == "Missing" or row["consumed_wh"] != value:
            await ctx.conn.execute(
                "UPDATE hours SET consumed_wh = $1, quality = 'Actual'"
                " WHERE window_id = $2 AND hour_utc = $3",
                value, window_id, row["hour_utc"],
            )
    if window["state"] == AWAITING_METERS:
        await ctx.conn.execute(
            "UPDATE windows SET state = $1 WHERE id = $2", RECONCILING, window_id
        )
    await bump_revision(ctx.conn, window, user["name"])
    site = await load_site(ctx.conn, window["site_id"])
    await recompute_allocation(ctx.conn, window, site)
    await _refresh_grid_factors(ctx, site, hours)
    window = await load_window(ctx.conn, window_id)
    return await window_json(ctx.conn, window)


async def _refresh_grid_factors(ctx: Ctx, site: dict[str, Any],
                                hours: list[dict[str, Any]]) -> None:
    """Fetch factors for hours with none stored; the feed never changes a score."""
    missing = [h for h in hours if h["grid_g_per_kwh"] is None
               and (h["consumed_wh"] or 0) > 0]
    if not missing:
        return
    zone = site["zone"]
    first = format_hour(missing[0]["hour_utc"])
    last_end = format_instant(missing[-1]["hour_utc"] + timedelta(hours=1))
    try:
        runs = await GRID_FEED.factors(zone, first, last_end)
    except ProviderUnavailable:
        return
    for run in runs:
        try:
            start = parse_hour(run.get("start"))
            count = int(run.get("count"))
            g = str(run.get("g_per_kwh"))
        except Exception:
            continue
        if start is None:
            continue
        for i in range(count):
            hour = start + timedelta(hours=i)
            key = format_hour(hour)
            row = next((h for h in missing if format_hour(h["hour_utc"]) == key), None)
            if row is None:
                continue
            await ctx.conn.execute(
                "INSERT INTO grid_factors (zone, hour_utc, g_per_kwh) VALUES ($1,$2,$3)"
                " ON CONFLICT (zone, hour_utc) DO NOTHING",
                zone, hour, g,
            )
            await ctx.conn.execute(
                "UPDATE hours SET grid_g_per_kwh = $1 WHERE window_id = $2 AND hour_utc = $3",
                g, row["window_id"], row["hour_utc"],
            )


async def gaps_repair(ctx: Ctx, window_id: str) -> dict[str, Any]:
    user = ctx.require("analyst")
    window = await analyst_window(ctx, window_id)
    await check_revision(window, ctx.body.get("revision"))
    in_state(window, (RECONCILING,))
    site = await load_site(ctx.conn, window["site_id"])
    tz = tz_for(site)
    hours = await load_hours(ctx.conn, window_id)
    filled, unfilled = rules.repair_gaps(hours, tz)
    index = {h["hour_utc"]: h for h in hours}
    for hour in filled:
        row = index[hour]
        await ctx.conn.execute(
            "UPDATE hours SET consumed_wh = $1, quality = 'Estimated'"
            " WHERE window_id = $2 AND hour_utc = $3",
            row["consumed_wh"], window_id, hour,
        )
    await bump_revision(ctx.conn, window, user["name"])
    await recompute_allocation(ctx.conn, window, site)
    await _refresh_grid_factors(ctx, site, hours)
    window = await load_window(ctx.conn, window_id)
    return {
        "filled": [format_hour(h) for h in filled],
        "unfilled": [format_hour(h) for h in unfilled],
        "window": await window_json(ctx.conn, window),
    }


async def substitution_put(ctx: Ctx, window_id: str, hour_text: str) -> dict[str, Any]:
    user = ctx.require("analyst")
    window = await analyst_window(ctx, window_id)
    in_state(window, (RECONCILING,))
    hour = parse_hour(hour_text)
    if hour is None:
        raise errors.not_found()
    row = await ctx.conn.fetchrow(
        "SELECT * FROM hours WHERE window_id = $1 AND hour_utc = $2", window_id, hour
    )
    if row is None:
        raise errors.not_found()
    value = int_field(ctx, "value_wh", minimum=0, maximum=1_000_000_000_000)
    reason = text_field(ctx, "reason", minimum=1, maximum=500)
    if row["quality"] == "Actual":
        raise errors.ApiError(409, "HOUR_IS_ACTUAL", message_for("HOUR_IS_ACTUAL"))
    await check_revision(window, ctx.body.get("revision"))
    await ctx.conn.execute(
        "UPDATE hours SET consumed_wh = $1, quality = 'Substituted', substitution_reason = $2"
        " WHERE window_id = $3 AND hour_utc = $4",
        value, reason, window_id, hour,
    )
    site = await load_site(ctx.conn, window["site_id"])
    await bump_revision(ctx.conn, window, user["name"])
    await recompute_allocation(ctx.conn, window, site)
    window = await load_window(ctx.conn, window_id)
    return await window_json(ctx.conn, window)


async def hours_spread(ctx: Ctx, window_id: str) -> dict[str, Any]:
    user = ctx.require("analyst")
    window = await analyst_window(ctx, window_id)
    await check_revision(window, ctx.body.get("revision"))
    in_state(window, (RECONCILING,))
    hour_texts = ctx.body.get("hours")
    if not isinstance(hour_texts, list):
        raise errors.field_error("hours")
    hours = await load_hours(ctx.conn, window_id)
    window_hours = {h["hour_utc"]: h for h in hours}
    parsed: list[Any] = []
    for text in hour_texts:
        hour = parse_hour(text) if isinstance(text, str) else None
        if hour is None or hour not in window_hours:
            raise errors.not_found()
        parsed.append(hour)
    parsed.sort()
    if len(parsed) < 2 or len(parsed) > 168:
        raise errors.field_error("hours")
    for i in range(1, len(parsed)):
        if (parsed[i] - parsed[i - 1]) != timedelta(hours=1):
            raise errors.field_error("hours")
    for hour in parsed:
        if window_hours[hour]["quality"] not in ("Missing", "Estimated"):
            raise errors.ApiError(409, "HOUR_NOT_SPREADABLE", message_for("HOUR_NOT_SPREADABLE"))
    total = int_field(ctx, "total_wh", minimum=0, maximum=1_000_000_000_000)
    reason = text_field(ctx, "reason", minimum=1, maximum=500)
    site = await load_site(ctx.conn, window["site_id"])
    tz = tz_for(site)
    shares = rules.spread_total(hours, tz, parsed, total)
    for hour, share in shares.items():
        await ctx.conn.execute(
            "UPDATE hours SET consumed_wh = $1, quality = 'Substituted',"
            " substitution_reason = $2 WHERE window_id = $3 AND hour_utc = $4",
            share, reason, window_id, hour,
        )
    await bump_revision(ctx.conn, window, user["name"])
    await recompute_allocation(ctx.conn, window, site)
    window = await load_window(ctx.conn, window_id)
    return await window_json(ctx.conn, window)


async def merit_order_put(ctx: Ctx, window_id: str) -> dict[str, Any]:
    user = ctx.require("analyst")
    window = await analyst_window(ctx, window_id)
    await check_revision(window, ctx.body.get("revision"))
    in_state(window, (RECONCILING,))
    lot_ids = ctx.body.get("lot_ids")
    lots = await load_lots(ctx.conn, window_id)
    if not isinstance(lot_ids, list) or sorted(lot_ids) != sorted(l["id"] for l in lots):
        raise errors.field_error("lot_ids")
    for rank, lot_id in enumerate(lot_ids, start=1):
        await ctx.conn.execute("UPDATE lots SET rank = $1 WHERE id = $2", rank, lot_id)
    site = await load_site(ctx.conn, window["site_id"])
    await bump_revision(ctx.conn, window, user["name"])
    await recompute_allocation(ctx.conn, window, site)
    window = await load_window(ctx.conn, window_id)
    return await _lots_view(ctx, window)


async def _lots_view(ctx: Ctx, window: dict[str, Any]) -> dict[str, Any]:
    from .routes import lot_json
    site = await load_site(ctx.conn, window["site_id"])
    lots = await load_lots(ctx.conn, window["id"])
    bundles = await load_bundles(ctx.conn, window["id"])
    lines = await load_lines(ctx.conn, window["id"])
    now = clock.now()
    from .service import computed_lot_statuses
    statuses = computed_lot_statuses(site, lots, lines, now)
    views = []
    for lot in sorted(lots, key=lambda l: (l["rank"], l["id"])):
        lot_bundles = [b for b in bundles if b["lot_id"] == lot["id"]]
        opening = sum(int(b["range_end_wh"]) - int(b["range_start_wh"]) for b in lot_bundles)
        views.append(lot_json(lot, statuses[lot["id"]], lines, len(lot_bundles), opening, now))
    return {"lots": views, "window": await window_json(ctx.conn, window)}


async def exclusion_put(ctx: Ctx, window_id: str, lot_id: str) -> dict[str, Any]:
    user = ctx.require("analyst")
    window = await analyst_window(ctx, window_id)
    await check_revision(window, ctx.body.get("revision"))
    in_state(window, (RECONCILING,))
    lots = await load_lots(ctx.conn, window_id)
    target = next((l for l in lots if l["id"] == lot_id), None)
    if target is None:
        raise errors.not_found()
    excluded = bool_field(ctx, "excluded")
    await ctx.conn.execute(
        "UPDATE lots SET excluded = $1 WHERE id = $2", excluded, lot_id
    )
    site = await load_site(ctx.conn, window["site_id"])
    await bump_revision(ctx.conn, window, user["name"])
    await recompute_allocation(ctx.conn, window, site)
    window = await load_window(ctx.conn, window_id)
    view = await _lots_view(ctx, window)
    lot_view = next(l for l in view["lots"] if l["id"] == lot_id)
    return {"lot": lot_view, "window": view["window"]}


async def allocation_post(ctx: Ctx, window_id: str) -> dict[str, Any]:
    user = ctx.require("analyst")
    window = await analyst_window(ctx, window_id)
    await check_revision(window, ctx.body.get("revision"))
    in_state(window, (RECONCILING,))
    site = await load_site(ctx.conn, window["site_id"])
    await bump_revision(ctx.conn, window, user["name"])
    _, digest = await recompute_allocation(ctx.conn, window, site)
    window = await load_window(ctx.conn, window_id)
    lines = await load_lines(ctx.conn, window_id)
    lot_names = {l["id"]: l["name"] for l in await load_lots(ctx.conn, window_id)}
    return {
        "lines": [line_json(l, lot_names.get(l["lot_id"])) for l in lines],
        "allocation_digest": digest,
        "window": await window_json(ctx.conn, window),
    }


async def holdings_sync(ctx: Ctx, window_id: str) -> dict[str, Any]:
    user = ctx.require("analyst")
    window = await analyst_window(ctx, window_id)
    await check_revision(window, ctx.body.get("revision"))
    in_state(window, (RECONCILING,))
    site = await load_site(ctx.conn, window["site_id"])
    tz = tz_for(site)
    hours = await load_hours(ctx.conn, window_id)
    months = sorted({h["hour_utc"].strftime("%Y-%m") for h in hours})
    added: list[dict[str, Any]] = []
    held_elsewhere: list[dict[str, Any]] = []
    existing = {b["bundle_id"] for b in await load_bundles(ctx.conn, window_id)}
    now = clock.now()
    try:
        for month in months:
            bundles = await REGISTRY.holdings(month)
            for b in bundles:
                bundle_id = b.get("bundle_id")
                if not isinstance(bundle_id, str) or bundle_id in existing:
                    continue
                existing.add(bundle_id)
                imported = await _import_bundle(ctx, window, site, b, now, added)
                if imported and b.get("zone") == site["zone"]:
                    claim = await ctx.conn.fetchrow(
                        "SELECT window_id FROM bundle_claims WHERE bundle_id = $1", bundle_id
                    )
                    if claim is not None and claim["window_id"] != window_id:
                        held_elsewhere.append({
                            "bundle_id": bundle_id,
                            "window_id": claim["window_id"],
                        })
                    elif claim is None:
                        await ctx.conn.execute(
                            "INSERT INTO bundle_claims (bundle_id, window_id, created_at)"
                            " VALUES ($1,$2,$3) ON CONFLICT (bundle_id) DO NOTHING",
                            bundle_id, window_id, now,
                        )
    except ProviderUnavailable:
        raise errors.dependency("HOLDINGS_UNAVAILABLE")
    site = await load_site(ctx.conn, window["site_id"])
    await bump_revision(ctx.conn, window, user["name"])
    await recompute_allocation(ctx.conn, window, site)
    window = await load_window(ctx.conn, window_id)
    balances = await balances_for(ctx.conn, window_id)
    return {
        "added": added,
        "opening_wh": balances["opening_wh"],
        "held_elsewhere": held_elsewhere,
        "window": await window_json(ctx.conn, window),
    }


async def _import_bundle(ctx: Ctx, window: dict[str, Any], site: dict[str, Any],
                         b: dict[str, Any], now, added: list[dict[str, Any]]) -> bool:
    from ..domain.rules import cancel_by_for
    lot_ref = b.get("lot_ref")
    lot_name = b.get("lot_name")
    technology = b.get("technology")
    zone = b.get("zone")
    production_hour = b.get("production_hour")
    discharge_hour = b.get("discharge_hour")
    if not isinstance(lot_ref, str) or not isinstance(production_hour, str):
        return False
    prod = parse_hour(production_hour)
    if prod is None:
        return False
    dis = parse_hour(discharge_hour) if isinstance(discharge_hour, str) else None
    start, end = b.get("range_start_wh"), b.get("range_end_wh")
    if not isinstance(start, int) or not isinstance(end, int) or end <= start:
        return False
    battery = bool(b.get("battery_shifted"))
    lots = await load_lots(ctx.conn, window["id"])
    lot = next((l for l in lots if l["id"] == lot_ref), None)
    if lot is None:
        rank = max((l["rank"] for l in lots), default=0) + 1
        production_month = prod.strftime("%Y-%m")
        await ctx.conn.execute(
            "INSERT INTO lots (id, window_id, name, technology, zone, rank, excluded,"
            " battery_shifted, production_month, cancel_by, created_at)"
            " VALUES ($1,$2,$3,$4,$5,$6,false,$7,$8,$9,$10)",
            lot_ref, window["id"], lot_name or lot_ref, technology or "unknown", zone,
            rank, battery, production_month, cancel_by_for(production_month), now,
        )
    await ctx.conn.execute(
        "INSERT INTO bundles (id, window_id, lot_id, bundle_id, production_hour,"
        " discharge_hour, range_start_wh, range_end_wh)"
        " VALUES ($1,$2,$3,$4,$5,$6,$7,$8)"
        " ON CONFLICT (window_id, bundle_id) DO NOTHING",
        f"{window['id']}::{b['bundle_id']}", window["id"], lot_ref, b["bundle_id"],
        prod, dis, str(start), str(end),
    )
    gross = end - start
    mid = f"dep-{window['id']}-{b['bundle_id']}"
    for account, amount in (("registry", -gross), ("holdings", gross)):
        await ctx.conn.execute(
            "INSERT INTO ledger_entries (movement_id, kind, account, wh, window_id,"
            " lot_id, bundle_id, line_id, label, at)"
            " VALUES ($1,'deposit',$2,$3,$4,$5,$6,$7,$8,$9)",
            mid, account, amount, window["id"], lot_ref, b["bundle_id"], None,
            f"Deposit {lot_name or lot_ref}", now,
        )
    added.append({
        "bundle_id": b["bundle_id"],
        "lot_id": lot_ref,
        "range_start_wh": str(start),
        "range_end_wh": str(end),
    })
    return True


# --- submit, resume ---------------------------------------------------------
async def submit(ctx: Ctx, window_id: str) -> dict[str, Any]:
    user = ctx.require("analyst")
    window = await analyst_window(ctx, window_id)
    await check_revision(window, ctx.body.get("revision"))
    in_state(window, (RECONCILING,))
    if not window["verifier_firm_id"]:
        raise errors.ApiError(409, "NO_VERIFIER", message_for("NO_VERIFIER"))
    hours = await load_hours(ctx.conn, window_id)
    missing = [h for h in hours if h["quality"] == "Missing"]
    if missing:
        raise errors.ApiError(409, "HOURS_MISSING",
                              message_for("HOURS_MISSING", n=len(missing)))
    digest = window["allocation_digest"]
    eligible = [h["hour_utc"] for h in hours if (h["consumed_wh"] or 0) > 0]
    drawn = rules.draw_sample(window_id, digest, eligible)
    await ctx.conn.execute("DELETE FROM sample_hours WHERE window_id = $1", window_id)
    now = clock.now()
    deadline = now + timedelta(seconds=config.REVIEW_SECONDS)
    lines = await load_lines(ctx.conn, window_id)
    lots = await load_lots(ctx.conn, window_id)
    by_lot = {l["id"]: l for l in lots}
    earliest = None
    for line in lines:
        if line["status"] == "Unsubmitted":
            lot = by_lot.get(line["lot_id"])
            if lot is not None and (earliest is None or lot["cancel_by"] < earliest):
                earliest = lot["cancel_by"]
    if earliest is not None and earliest < deadline:
        deadline = earliest
    for index, hour in enumerate(drawn):
        await ctx.conn.execute(
            "INSERT INTO sample_hours (window_id, hour_utc, draw_index, result, note)"
            " VALUES ($1,$2,$3,$4,$5)",
            window_id, hour, index, None, None,
        )
    await ctx.conn.execute(
        "UPDATE windows SET state = $1, submitted_at = $2, review_deadline = $3,"
        " returned_reason = NULL WHERE id = $4",
        IN_REVIEW, now, deadline, window_id,
    )
    await bump_revision(ctx.conn, window, user["name"])
    window = await load_window(ctx.conn, window_id)
    return await window_json(ctx.conn, window)


async def resume(ctx: Ctx, window_id: str) -> dict[str, Any]:
    user = ctx.require("analyst")
    window = await analyst_window(ctx, window_id)
    await check_revision(window, ctx.body.get("revision"))
    in_state(window, (RETURNED,))
    await ctx.conn.execute(
        "UPDATE windows SET state = $1 WHERE id = $2", RECONCILING, window_id
    )
    await bump_revision(ctx.conn, window, user["name"])
    window = await load_window(ctx.conn, window_id)
    return await window_json(ctx.conn, window)


# --- cancellation -----------------------------------------------------------
async def cancellations_post(ctx: Ctx, window_id: str) -> dict[str, Any]:
    user = ctx.require("analyst")
    window = await analyst_window(ctx, window_id)
    in_state(window, (CANCELLING,))
    site = await load_site(ctx.conn, window["site_id"])
    lots = await load_lots(ctx.conn, window_id)
    lines = await load_lines(ctx.conn, window_id)
    by_lot = {l["id"]: l for l in lots}
    now = clock.now()
    unsubmitted = [l for l in lines if l["status"] == "Unsubmitted"]
    if any(by_lot[l["lot_id"]]["cancel_by"] <= now for l in unsubmitted):
        await ctx.conn.execute(
            "UPDATE windows SET state = $1 WHERE id = $2", RECONCILING, window_id
        )
        await bump_revision(ctx.conn, window, user["name"])
        raise errors.ApiError(409, "LOT_EXPIRED", message_for("LOT_EXPIRED"))
    submitted = 0
    for line in sorted(unsubmitted, key=lambda l: (l["hour_utc"], l["bundle_id"])):
        try:
            answer = await REGISTRY.cancel(
                line["line_id"], line["bundle_id"], line["range_start_wh"],
                line["range_end_wh"], format_hour(line["hour_utc"]), site["name"],
            )
        except ProviderUnavailable:
            await ctx.conn.execute(
                "UPDATE windows SET registry_reachable = false WHERE id = $1", window_id
            )
            raise errors.dependency("REGISTRY_UNAVAILABLE")
        await ctx.conn.execute(
            "UPDATE windows SET registry_reachable = true WHERE id = $1", window_id
        )
        if answer["status"] in ("PENDING", "ALREADY_RECEIVED"):
            await ctx.conn.execute(
                "UPDATE lines SET status = 'Pending' WHERE line_id = $1", line["line_id"]
            )
            if answer["status"] == "PENDING":
                submitted += 1
        else:
            await ctx.conn.execute(
                "UPDATE lines SET status = 'Rejected', reason = $1 WHERE line_id = $2",
                answer.get("reason"), line["line_id"],
            )
            await _reject_line(ctx, window, line, user["name"])
    lines = await load_lines(ctx.conn, window_id)
    window = await load_window(ctx.conn, window_id)
    lot_names = {l["id"]: l["name"] for l in await load_lots(ctx.conn, window_id)}
    return {
        "submitted": submitted,
        "lines": [line_json(l, lot_names.get(l["lot_id"])) for l in lines],
        "window": await window_json(ctx.conn, window),
    }


async def _reject_line(ctx: Ctx, window: dict[str, Any], line: dict[str, Any],
                       writer: str) -> None:
    """A rejected line becomes unmatched, returns its ledger movement, and the
    window goes back to Reconciling with the sample cleared."""
    conn = ctx.conn
    movement_id = f"ret-{line['line_id']}"
    existing = await conn.fetchval(
        "SELECT 1 FROM ledger_entries WHERE movement_id = $1", movement_id
    )
    if existing is None:
        now = clock.now()
        for account, amount in (("allocated", -line["wh"]), ("holdings", line["wh"])):
            await conn.execute(
                "INSERT INTO ledger_entries (movement_id, kind, account, wh, window_id,"
                " lot_id, bundle_id, line_id, label, at)"
                " VALUES ($1,'return',$2,$3,$4,$5,$6,$7,'Return',$8)",
                movement_id, account, amount, window["id"], line["lot_id"],
                line["bundle_id"], line["line_id"], now,
            )
    state = await conn.fetchval("SELECT state FROM windows WHERE id = $1", window["id"])
    if state in (IN_REVIEW, CANCELLING):
        await conn.execute(
            "UPDATE windows SET state = $1 WHERE id = $2", RECONCILING, window["id"]
        )
        await conn.execute("DELETE FROM sample_hours WHERE window_id = $1", window["id"])
    await conn.execute(
        "UPDATE windows SET revision = revision + 1 WHERE id = $1", window["id"]
    )


async def cancellations_get(ctx: Ctx, window_id: str) -> dict[str, Any]:
    await ctx.any_signed_in()
    window = await get_window_for(ctx, window_id)
    lines = await load_lines(ctx.conn, window_id)
    lines.sort(key=lambda l: (l["hour_utc"], l["bundle_id"]))
    lot_names = {l["id"]: l["name"] for l in await load_lots(ctx.conn, window_id)}
    return {"lines": [line_json(l, lot_names.get(l["lot_id"])) for l in lines]}

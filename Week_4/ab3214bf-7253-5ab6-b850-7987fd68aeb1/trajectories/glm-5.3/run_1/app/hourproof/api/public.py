"""Corrections pull, public statement, sealed scores and health.
"""
from __future__ import annotations

import base64
import json
from typing import Any

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from .. import clock
from ..copy import message_for
from ..domain import rules
from ..domain.exact import to_wh
from ..domain.states import RECONCILING, RESTATED, SEALED
from ..domain.timeline import (
    format_hour, format_instant, month_hours_utc, parse_hour,
)
from ..providers.services import METER_HUB, STORE, ProviderUnavailable
from . import errors
from .routes import Ctx, readable_window
from .service import (
    bump_revision, load_bundles, load_hours, load_lines, load_lots, load_site,
    load_window, recompute_allocation, tz_for, window_json,
)


async def corrections_pull(ctx: Ctx, site_id: str) -> dict[str, Any]:
    user = ctx.require("analyst")
    site = await load_site(ctx.conn, site_id)
    if site is None:
        raise errors.not_found()
    tz = tz_for(site)
    window_rows = await ctx.conn.fetch(
        "SELECT id, month FROM windows WHERE site_id = $1", site_id
    )
    if not window_rows:
        raise errors.not_found()
    earliest = min(month_hours_utc(w["month"], tz)[0] for w in window_rows)
    try:
        corrections = await METER_HUB.corrections(
            site["meter_id"], format_instant(earliest)
        )
    except ProviderUnavailable:
        raise errors.dependency("METER_HUB_UNAVAILABLE")
    applied: list[dict[str, Any]] = []
    restated: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    best: dict[str, dict[str, Any]] = {}
    bad_lines: list[tuple[int, str]] = []
    for index, correction in enumerate(corrections, start=1):
        hour_text = correction.get("hour_utc")
        version = correction.get("version")
        value = correction.get("value")
        unit = correction.get("unit")
        hour = parse_hour(hour_text) if isinstance(hour_text, str) else None
        if not isinstance(version, int) or isinstance(version, bool) or version < 1:
            continue
        wh = to_wh(value, unit) if isinstance(value, str) and unit in ("kWh", "MWh") else None
        if wh is None:
            bad_lines.append((index, "NOT_WHOLE_WATT_HOUR"))
            continue
        prev = best.get(hour_text)
        if prev is None or version > prev["version"]:
            best[hour_text] = {"hour": hour, "version": version, "wh": wh, "index": index}
    if bad_lines:
        index, code = bad_lines[0]
        raise errors.ApiError(422, code, message_for(code, n=index))

    for index, correction in enumerate(corrections, start=1):
        hour_text = correction.get("hour_utc")
        if not isinstance(hour_text, str):
            continue
        chosen = best.get(hour_text)
        if chosen is None or chosen["index"] != index or chosen["hour"] is None:
            skipped.append({"hour_utc": hour_text, "state": "Superseded"})
            continue
        target = await _newest_window_for_hour(ctx, site_id, chosen["hour"])
        if target is None:
            skipped.append({"hour_utc": hour_text, "state": "Unknown"})
            continue
        row = await ctx.conn.fetchrow(
            "SELECT * FROM hours WHERE window_id = $1 AND hour_utc = $2",
            target["id"], chosen["hour"],
        )
        stored_version = row["correction_version"] if row else 0
        if chosen["version"] <= stored_version:
            skipped.append({"hour_utc": hour_text, "state": "Superseded"})
            continue
        conflict = await _conflicts(ctx, site_id, chosen["hour"], chosen["version"], chosen["wh"])
        if conflict:
            raise errors.ApiError(
                422, "CONFLICTING_CORRECTION",
                message_for("CONFLICTING_CORRECTION", n=index),
            )
        result = await _apply_correction(ctx, site, target, chosen, user["name"])
        if result is None:
            skipped.append({"hour_utc": hour_text, "state": target["state"]})
        else:
            if target["state"] == RECONCILING:
                applied.append({"window_id": target["id"], "hour_utc": hour_text})
            if result.get("restated"):
                applied.append({"window_id": target["id"], "hour_utc": hour_text})
                restated.append({
                    "window_id": result["predecessor_id"],
                    "successor_id": result["successor_id"],
                })
    return {"applied": applied, "restated": restated, "skipped": skipped}


async def _newest_window_for_hour(ctx: Ctx, site_id: str,
                                  hour) -> dict[str, Any] | None:
    rows = [dict(r) for r in await ctx.conn.fetch(
        "SELECT * FROM windows WHERE site_id = $1 AND month = $2",
        site_id, hour.strftime("%Y-%m"),
    )]
    if not rows:
        return None
    by_id = {w["id"]: w for w in rows}
    newest = None
    for w in rows:
        if w["predecessor_id"] is None:
            newest = w
    if newest is None:
        newest = rows[0]
    while newest.get("successor_id") and newest["successor_id"] in by_id:
        newest = by_id[newest["successor_id"]]
    if newest.get("successor_id"):
        successor = await load_window(ctx.conn, newest["successor_id"])
        if successor is not None:
            return successor
    return newest


async def _conflicts(ctx: Ctx, site_id: str, hour, version: int, wh: int) -> bool:
    rows = await ctx.conn.fetch(
        "SELECT h.correction_version, h.consumed_wh FROM hours h"
        " JOIN windows w ON w.id = h.window_id"
        " WHERE h.hour_utc = $1 AND w.site_id = $2",
        hour, site_id,
    )
    for row in rows:
        if row["correction_version"] == version and row["consumed_wh"] != wh:
            return True
    return False


async def _apply_correction(ctx: Ctx, site: dict[str, Any], window: dict[str, Any],
                            chosen: dict[str, Any], writer: str) -> dict[str, Any] | None:
    conn = ctx.conn
    row = await conn.fetchrow(
        "SELECT * FROM hours WHERE window_id = $1 AND hour_utc = $2",
        window["id"], chosen["hour"],
    )
    if row is None:
        return None
    if window["state"] == RECONCILING:
        await conn.execute(
            "UPDATE hours SET consumed_wh = $1, quality = 'Actual', correction_version = $2"
            " WHERE window_id = $3 AND hour_utc = $4",
            chosen["wh"], chosen["version"], window["id"], chosen["hour"],
        )
        await bump_revision(conn, window, writer)
        await recompute_allocation(conn, window, site)
        return {"restated": False}
    if window["state"] == SEALED:
        if row["consumed_wh"] == chosen["wh"]:
            await conn.execute(
                "UPDATE hours SET correction_version = $1 WHERE window_id = $2 AND hour_utc = $3",
                chosen["version"], window["id"], chosen["hour"],
            )
            return {"restated": False}
        return await _restate(ctx, site, window, chosen, writer)
    return None


async def _restate(ctx: Ctx, site: dict[str, Any], window: dict[str, Any],
                  hours_chosen: dict[str, Any], writer: str) -> dict[str, Any]:
    """Open exactly one successor, copying hours, lots and Confirmed lines."""
    conn = ctx.conn
    base_id = window["base_window_id"]
    count = await conn.fetchval(
        "SELECT COUNT(*) FROM windows WHERE base_window_id = $1", base_id
    )
    n = count + 1
    successor_id = f"{base_id}-r{n}"
    now = clock.now()
    await conn.execute(
        "INSERT INTO windows (id, site_id, month, state, revision, opens_at,"
        " verifier_firm_id, allocation_digest, base_window_id, predecessor_id,"
        " created_at, signatures_count)"
        " VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,0)",
        successor_id, window["site_id"], window["month"], RECONCILING,
        window["opens_at"], window["verifier_firm_id"], window["allocation_digest"],
        base_id, window["id"], now,
    )
    for h in await load_hours(conn, window["id"]):
        quality = h["quality"]
        consumed = h["consumed_wh"]
        reason = h["substitution_reason"]
        version = h["correction_version"]
        if h["hour_utc"] == hours_chosen["hour"]:
            quality = "Actual"
            consumed = hours_chosen["wh"]
            reason = None
            version = hours_chosen["version"]
        await conn.execute(
            "INSERT INTO hours (window_id, hour_utc, consumed_wh, quality,"
            " correction_version, substitution_reason) VALUES ($1,$2,$3,$4,$5,$6)",
            successor_id, h["hour_utc"], consumed, quality, version, reason,
        )
    for lot in await load_lots(conn, window["id"]):
        await conn.execute(
            "INSERT INTO lots (id, window_id, name, technology, zone, rank, excluded,"
            " battery_shifted, production_month, cancel_by, created_at)"
            " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
            f"{successor_id}::{lot['name']}", successor_id, lot["name"],
            lot["technology"], lot["zone"], lot["rank"], lot["excluded"],
            lot["battery_shifted"], lot["production_month"], lot["cancel_by"], now,
        )
    lot_id_map = {lot["id"]: f"{successor_id}::{lot['name']}"
                  for lot in await load_lots(conn, window["id"])}
    counter = 0
    for b in await load_bundles(conn, window["id"]):
        counter += 1
        new_lot_id = lot_id_map[b["lot_id"]]
        await conn.execute(
            "INSERT INTO bundles (id, window_id, lot_id, bundle_id, production_hour,"
            " discharge_hour, range_start_wh, range_end_wh)"
            " VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
            f"{successor_id}::{b['bundle_id']}", successor_id, new_lot_id,
            b["bundle_id"], b["production_hour"], b["discharge_hour"],
            b["range_start_wh"], b["range_end_wh"],
        )
        gross = int(b["range_end_wh"]) - int(b["range_start_wh"])
        mid = f"dep-{successor_id}-{counter:05d}"
        for account, amount in (("registry", -gross), ("holdings", gross)):
            await conn.execute(
                "INSERT INTO ledger_entries (movement_id, kind, account, wh, window_id,"
                " lot_id, bundle_id, line_id, label, at)"
                " VALUES ($1,'deposit',$2,$3,$4,$5,$6,$7,'Deposit',$8)",
                mid, account, amount, successor_id, new_lot_id, b["bundle_id"], None, now,
            )
        await conn.execute(
            "INSERT INTO bundle_claims (bundle_id, window_id, created_at)"
            " VALUES ($1,$2,$3) ON CONFLICT (bundle_id) DO NOTHING",
            b["bundle_id"], successor_id, now,
        )
    counter = 0
    for line in await load_lines(conn, window["id"]):
        if line["status"] != "Confirmed":
            continue
        counter += 1
        new_lot_id = lot_id_map[line["lot_id"]]
        new_line_id = f"{successor_id}_{line['bundle_id']}_{line['range_start_wh']}"
        await conn.execute(
            "INSERT INTO lines (line_id, window_id, hour_utc, lot_id, bundle_id,"
            " range_start_wh, range_end_wh, wh, status, reason, created_at)"
            " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Confirmed',$9,$10)"
            " ON CONFLICT (line_id) DO NOTHING",
            new_line_id, successor_id, line["hour_utc"], new_lot_id, line["bundle_id"],
            line["range_start_wh"], line["range_end_wh"], line["wh"], None, now,
        )
        for kind, from_acct, to_acct in (("allocate", "holdings", "allocated"),
                                         ("cancel", "allocated", "cancelled")):
            mid = f"mov-{successor_id}-{counter:05d}-{kind}"
            for account, amount in ((from_acct, -line["wh"]), (to_acct, line["wh"])):
                await conn.execute(
                    "INSERT INTO ledger_entries (movement_id, kind, account, wh,"
                    " window_id, lot_id, bundle_id, line_id, label, at)"
                    " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
                    mid, kind, account, amount, successor_id, new_lot_id,
                    line["bundle_id"], None, kind.title(), now,
                )
    counter = 0
    loss_rows = await conn.fetch(
        "SELECT * FROM ledger_entries WHERE window_id = $1 AND kind = 'battery_loss'",
        window["id"],
    )
    for row in loss_rows:
        counter += 1
        mid = f"loss-{successor_id}-{counter:05d}"
        for account, amount in (("holdings", -row["wh"]), ("loss", row["wh"])):
            await conn.execute(
                "INSERT INTO ledger_entries (movement_id, kind, account, wh, window_id,"
                " lot_id, bundle_id, line_id, label, at)"
                " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
                mid, "battery_loss", account, amount, successor_id,
                lot_id_map.get(row["lot_id"]), row["bundle_id"], None,
                row["label"], now,
            )
    await conn.execute(
        "UPDATE windows SET state = $1, successor_id = $2 WHERE id = $3",
        RESTATED, successor_id, window["id"],
    )
    await conn.execute(
        "UPDATE statements SET successor_window_id = $1 WHERE window_id = $2",
        successor_id, window["id"],
    )
    successor = await load_window(conn, successor_id)
    await recompute_allocation(conn, successor, site)
    return {"restated": True, "predecessor_id": window["id"], "successor_id": successor_id}


# --- public ------------------------------------------------------------------
async def public_statement(ctx: Ctx, code: str) -> dict[str, Any]:
    statement = await ctx.conn.fetchrow("SELECT * FROM statements WHERE code = $1", code)
    if statement is None:
        raise errors.not_found()
    window = await load_window(ctx.conn, statement["window_id"])
    if window["seal_status"] != "sealed" or statement["pdf_sha256"] is None:
        raise errors.not_found()
    try:
        data = await STORE.get(statement["pdf_object_key"])
    except ProviderUnavailable:
        raise errors.dependency("STORE_UNAVAILABLE")
    key_row = await ctx.conn.fetchrow(
        "SELECT * FROM firm_keys WHERE key_id = $1", statement["key_id"]
    )
    public_key = key_row["public_key_b64"]
    signature_valid = False
    try:
        Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key)).verify(
            base64.b64decode(statement["pdf_signature"]), data
        )
        signature_valid = True
    except Exception:
        signature_valid = False
    payload = json.loads(statement["attestation_payload"])
    successor_code = await ctx.conn.fetchval(
        "SELECT statement_code FROM windows WHERE id = $1",
        statement["successor_window_id"],
    )
    window_state = await ctx.conn.fetchval(
        "SELECT state FROM windows WHERE id = $1", statement["window_id"]
    )
    state = "Restated" if window_state == RESTATED else statement["state"]
    return {
        "code": code,
        "state": state,
        "site_name": payload["site_name"],
        "month": payload["month"],
        "scores": {
            "month_bp": payload["month_bp"], "week_bp": payload["week_bp"],
            "day_bp": payload["day_bp"], "hour_bp": payload["hour_bp"],
        },
        "opinion": payload["opinion"],
        "firm_name": payload["firm_name"],
        "consumed_wh": payload["consumed_wh"],
        "hour_matched_wh": payload["hour_matched_wh"],
        "allocation_digest": payload["allocation_digest"],
        "pdf_url": f"/check/{code}/attestation.pdf",
        "pdf_object_key": statement["pdf_object_key"],
        "pdf_sha256": statement["pdf_sha256"],
        "key_id": statement["key_id"],
        "public_key": public_key,
        "attestation_payload": statement["attestation_payload"],
        "attestation_signature": statement["attestation_signature"],
        "pdf_signature": statement["pdf_signature"],
        "signature_valid": signature_valid,
        "successor_window_id": statement["successor_window_id"],
        "successor_statement_code": successor_code,
    }


async def public_statement_bytes(ctx: Ctx, code: str) -> bytes:
    statement = await ctx.conn.fetchrow("SELECT * FROM statements WHERE code = $1", code)
    if statement is None or statement["pdf_sha256"] is None:
        raise errors.not_found()
    window = await load_window(ctx.conn, statement["window_id"])
    if window["seal_status"] != "sealed":
        raise errors.not_found()
    try:
        return await STORE.get(statement["pdf_object_key"])
    except ProviderUnavailable:
        raise errors.dependency("STORE_UNAVAILABLE")


async def window_statement_bytes(ctx: Ctx, window_id: str) -> bytes:
    window = await readable_window(ctx, window_id)
    code = window["statement_code"]
    if not code or window["seal_status"] != "sealed":
        raise errors.wrong_state(window["state"])
    statement = await ctx.conn.fetchrow("SELECT * FROM statements WHERE code = $1", code)
    if statement is None or statement["pdf_sha256"] is None:
        raise errors.not_found()
    try:
        return await STORE.get(statement["pdf_object_key"])
    except ProviderUnavailable:
        raise errors.dependency("STORE_UNAVAILABLE")


async def sealed_scores(ctx: Ctx) -> dict[str, Any]:
    rows = await ctx.conn.fetch(
        "SELECT s.code AS code, s.signed_at, w.* FROM statements s"
        " JOIN windows w ON w.id = s.window_id"
        " WHERE w.state = $1 AND s.pdf_sha256 IS NOT NULL"
        " ORDER BY s.signed_at DESC, s.code DESC",
        SEALED,
    )
    items = []
    for row in rows[:20]:
        window = {k: v for k, v in dict(row).items() if k not in ("code", "signed_at")}
        site = await load_site(ctx.conn, window["site_id"])
        hours = await load_hours(ctx.conn, window["id"])
        lots = await load_lots(ctx.conn, window["id"])
        bundles = await load_bundles(ctx.conn, window["id"])
        lines = await load_lines(ctx.conn, window["id"])
        from .service import decorate_lots
        decorate_lots(site, lots, lines, clock.now())
        tz = tz_for(site)
        hour_bp = rules.score_for_grain(hours, "hour", window["month"], tz, lots, bundles, lines)["score_bp"]
        items.append({
            "statement_code": row["code"],
            "site_name": site["name"],
            "month": window["month"],
            "hour_bp": hour_bp,
        })
    return {"items": items}


def health() -> dict[str, Any]:
    return {"status": "ok"}

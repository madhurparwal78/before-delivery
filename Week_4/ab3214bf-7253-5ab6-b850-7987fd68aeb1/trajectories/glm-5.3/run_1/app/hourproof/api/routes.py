"""Reads and shared request context: access rules, validation helpers, and the
window, grain, hour, lot and line JSON views.
"""
from __future__ import annotations

import math
from datetime import datetime
from typing import Any

import asyncpg

from .. import clock
from ..domain import rules
from ..domain.states import IN_REVIEW, RETURNED
from ..domain.timeline import (
    format_hour, format_instant, is_repeated_hour, local_label, parse_hour,
)
from . import errors
from .passwords import verify_password
from .service import (
    computed_lot_statuses, consumed_of, decorate_lots, grain_scores, load_bundles,
    load_hours, load_lines, load_lots, load_site, load_window, matched_total, tz_for,
    unmatched_hours_count, window_json,
)


class Ctx:
    def __init__(self, user: dict[str, Any] | None, body: Any, conn: asyncpg.Connection,
                 method: str) -> None:
        self.user = user
        self.body = body if isinstance(body, dict) else {}
        self.conn = conn
        self.method = method

    def require(self, role: str) -> dict[str, Any]:
        if self.user is None:
            raise errors.unauthenticated()
        if self.user["role"] != role:
            raise errors.forbidden()
        return self.user

    def any_signed_in(self) -> dict[str, Any]:
        if self.user is None:
            raise errors.unauthenticated()
        return self.user


# --- window access ---------------------------------------------------------
async def get_window_for(ctx: Ctx, window_id: str) -> dict[str, Any]:
    """404 for unknown windows and for windows outside the caller's scope."""
    window = await load_window(ctx.conn, window_id)
    if window is None:
        raise errors.not_found()
    if ctx.user is None:
        raise errors.unauthenticated()
    if ctx.user["role"] == "verifier" and window["verifier_firm_id"] != ctx.user["firm_id"]:
        raise errors.not_found()
    return window


async def analyst_window(ctx: Ctx, window_id: str) -> dict[str, Any]:
    ctx.require("analyst")
    return await get_window_for(ctx, window_id)


async def verifier_window(ctx: Ctx, window_id: str) -> dict[str, Any]:
    ctx.require("verifier")
    return await get_window_for(ctx, window_id)


async def readable_window(ctx: Ctx, window_id: str) -> dict[str, Any]:
    if ctx.user is None:
        raise errors.unauthenticated()
    return await get_window_for(ctx, window_id)


def in_state(window: dict[str, Any], allowed: tuple[str, ...]) -> None:
    if window["state"] not in allowed:
        raise errors.wrong_state(window["state"])


async def apply_deadline_transitions(ctx: Ctx, window: dict[str, Any]) -> None:
    """A review past its deadline reads Returned, with the revision raised once."""
    now = clock.now()
    if window["state"] == IN_REVIEW and window["review_deadline"] is not None:
        if now >= window["review_deadline"]:
            from ..copy import message_for
            await ctx.conn.execute(
                "UPDATE windows SET state = $1, returned_reason = $2, revision = revision + 1"
                " WHERE id = $3 AND state = $4",
                RETURNED, message_for("REVIEW_TIMEOUT"), window["id"], IN_REVIEW,
            )
            window["state"] = RETURNED
            window["revision"] = window["revision"] + 1
            window["returned_reason"] = message_for("REVIEW_TIMEOUT")


# --- auth -------------------------------------------------------------------
async def sign_in(ctx: Ctx) -> tuple[dict[str, Any], str]:
    email = ctx.body.get("email")
    password = ctx.body.get("password")
    if not isinstance(email, str) or not isinstance(password, str):
        raise errors.ApiError(401, "INVALID_CREDENTIALS")
    row = await ctx.conn.fetchrow("SELECT * FROM users WHERE email = $1", email)
    if row is None or not verify_password(password, row["password_hash"]):
        raise errors.ApiError(401, "INVALID_CREDENTIALS")
    token = __import__("secrets").token_urlsafe(32)
    await ctx.conn.execute(
        "INSERT INTO sessions (token, user_id, created_at) VALUES ($1,$2,$3)",
        token, row["id"], clock.now(),
    )
    landing = {"analyst": "/windows", "verifier": "/review", "lead": "/group"}[row["role"]]
    return {
        "user": {"id": row["id"], "name": row["name"], "role": row["role"],
                 "firm_id": row["firm_id"]},
        "landing_url": landing,
    }, token


async def sign_out(ctx: Ctx, token: str | None) -> dict[str, Any]:
    if token:
        await ctx.conn.execute("DELETE FROM sessions WHERE token = $1", token)
    return {"signed_out": True}


async def me(ctx: Ctx) -> dict[str, Any]:
    user = ctx.any_signed_in()
    return {"user": {"id": user["id"], "name": user["name"], "role": user["role"],
                     "firm_id": user["firm_id"]}}


# --- field validation ---------------------------------------------------------
def int_field(ctx: Ctx, name: str, *, minimum: int | None = None,
              maximum: int | None = None) -> int:
    value = ctx.body.get(name)
    if not isinstance(value, int) or isinstance(value, bool):
        raise errors.field_error(name)
    if minimum is not None and value < minimum:
        raise errors.field_error(name)
    if maximum is not None and value > maximum:
        raise errors.field_error(name)
    return value


def text_field(ctx: Ctx, name: str, *, minimum: int, maximum: int) -> str:
    value = ctx.body.get(name)
    if not isinstance(value, str):
        raise errors.field_error(name)
    if len(value) < minimum or len(value) > maximum or not value.strip():
        raise errors.field_error(name)
    return value


def bool_field(ctx: Ctx, name: str) -> bool:
    value = ctx.body.get(name)
    if not isinstance(value, bool):
        raise errors.field_error(name)
    return value


async def check_revision(window: dict[str, Any], revision: Any) -> None:
    if not isinstance(revision, int) or isinstance(revision, bool):
        raise errors.field_error("revision")
    if revision != window["revision"]:
        raise errors.stale_revision(
            window["last_writer_name"] or "Another analyst",
            format_instant(window["wrote_at"] or clock.now()),
        )


# --- reads ---------------------------------------------------------------------
async def windows_list(ctx: Ctx, state_filter: str | None) -> list[dict[str, Any]]:
    user = ctx.any_signed_in()
    rows = await ctx.conn.fetch(
        "SELECT w.* FROM windows w JOIN sites s ON s.id = w.site_id"
        " ORDER BY w.month DESC, s.name ASC, w.id DESC"
    )
    result = []
    for record in rows:
        window = dict(record)
        if user["role"] == "verifier" and window["verifier_firm_id"] != user["firm_id"]:
            continue
        if state_filter and window["state"] != state_filter:
            continue
        await apply_deadline_transitions(ctx, window)
        result.append(await window_json(ctx.conn, window))
    return {"windows": result}


async def window_get(ctx: Ctx, window_id: str) -> dict[str, Any]:
    window = await get_window_for(ctx, window_id)
    await apply_deadline_transitions(ctx, window)
    return await window_json(ctx.conn, window)


def line_json(line: dict[str, Any], lot_name: str | None = None) -> dict[str, Any]:
    return {
        "line_id": line["line_id"],
        "hour_utc": format_hour(line["hour_utc"]),
        "lot_id": line["lot_id"],
        "lot_name": lot_name if lot_name is not None else line.get("lot_name"),
        "bundle_id": line["bundle_id"],
        "range_start_wh": line["range_start_wh"],
        "range_end_wh": line["range_end_wh"],
        "wh": line["wh"],
        "status": line["status"],
        "reason": line["reason"],
    }


def lot_json(lot: dict[str, Any], status: str, lines: list[dict[str, Any]],
             bundle_count: int, opening_wh: int, now: datetime) -> dict[str, Any]:
    lot_lines = [l for l in lines if l["lot_id"] == lot["id"]]
    confirmed = sum(1 for l in lot_lines if l["status"] == "Confirmed")
    cancel_seconds = None
    if now < lot["cancel_by"]:
        left = (lot["cancel_by"] - now).total_seconds()
        cancel_seconds = max(1, math.ceil(left)) if left > 0 else None
    return {
        "id": lot["id"],
        "name": lot["name"],
        "technology": lot["technology"],
        "zone": lot["zone"],
        "rank": lot["rank"],
        "status": status,
        "excluded": lot["excluded"],
        "battery_shifted": lot["battery_shifted"],
        "production_month": lot["production_month"],
        "cancel_by": format_instant(lot["cancel_by"]),
        "cancel_seconds_left": cancel_seconds,
        "opening_wh": opening_wh,
        "bundle_count": bundle_count,
        "lines_confirmed": confirmed,
        "lines_total": len(lot_lines),
    }


async def lots_get(ctx: Ctx, window_id: str) -> dict[str, Any]:
    window = await get_window_for(ctx, window_id)
    await apply_deadline_transitions(ctx, window)
    site = await load_site(ctx.conn, window["site_id"])
    lots = await load_lots(ctx.conn, window_id)
    bundles = await load_bundles(ctx.conn, window_id)
    lines = await load_lines(ctx.conn, window_id)
    now = clock.now()
    statuses = computed_lot_statuses(site, lots, lines, now)
    result = []
    for lot in sorted(lots, key=lambda l: (l["rank"], l["id"])):
        lot_bundles = [b for b in bundles if b["lot_id"] == lot["id"]]
        opening = sum(int(b["range_end_wh"]) - int(b["range_start_wh"]) for b in lot_bundles)
        result.append(lot_json(lot, statuses[lot["id"]], lines, len(lot_bundles), opening, now))
    return {"lots": result, "revision": window["revision"]}


async def grains_get(ctx: Ctx, window_id: str, grain: str) -> dict[str, Any]:
    window = await get_window_for(ctx, window_id)
    await apply_deadline_transitions(ctx, window)
    if grain not in rules.GRAINS:
        raise errors.not_found()
    site = await load_site(ctx.conn, window["site_id"])
    tz = tz_for(site)
    hours = await load_hours(ctx.conn, window_id)
    lots = await load_lots(ctx.conn, window_id)
    bundles = await load_bundles(ctx.conn, window_id)
    lines = await load_lines(ctx.conn, window_id)
    decorate_lots(site, lots, lines, clock.now())
    result = rules.score_for_grain(hours, grain, window["month"], tz, lots, bundles, lines)
    buckets = list(result["buckets"].values())
    hours_by_key = {format_hour(h["hour_utc"]): h for h in hours}
    for bucket in buckets:
        if grain == "hour":
            bucket["quality"] = hours_by_key[bucket["key"]]["quality"]
        else:
            bucket.pop("quality", None)
    falls: list[dict[str, Any]] = []
    if grain != "month":
        coarser = {"week": "month", "day": "week", "hour": "day"}[grain]
        coarse = rules.score_for_grain(hours, coarser, window["month"], tz, lots, bundles, lines)["buckets"]
        children_by_parent: dict[str, set[str]] = {}
        for hour in hours:
            fine = rules.bucket_key(hour["hour_utc"], grain, window["month"], tz)
            parent = rules.bucket_key(hour["hour_utc"], coarser, window["month"], tz)
            children_by_parent.setdefault(parent, set()).add(fine)
        for parent_key, child_keys in children_by_parent.items():
            parent = coarse[parent_key]
            child_matched = sum(result["buckets"][k]["matched_wh"] for k in child_keys)
            falls.append({"parent_key": parent_key,
                          "detached_wh": parent["matched_wh"] - child_matched})
    if grain != "hour":
        finer = {"month": "week", "week": "day", "day": "hour"}[grain]
        fine = rules.score_for_grain(hours, finer, window["month"], tz, lots, bundles, lines)["buckets"]
        children_by_parent: dict[str, set[str]] = {}
        for hour in hours:
            fine_key = rules.bucket_key(hour["hour_utc"], finer, window["month"], tz)
            parent_key = rules.bucket_key(hour["hour_utc"], grain, window["month"], tz)
            children_by_parent.setdefault(parent_key, set()).add(fine_key)
        for bucket in buckets:
            worst = []
            for key in children_by_parent.get(bucket["key"], set()):
                fb = fine[key]
                unmatched = fb["consumed_wh"] - fb["matched_wh"]
                if unmatched > 0:
                    worst.append({"key": key, "unmatched_wh": unmatched})
            worst.sort(key=lambda w: (-w["unmatched_wh"], w["key"]))
            bucket["worst"] = worst[:3]
    return {
        "grain": grain,
        "revision": window["revision"],
        "score_bp": result["score_bp"],
        "buckets": buckets,
        "falls": falls,
    }


async def hours_get(ctx: Ctx, window_id: str, hour_text: str) -> dict[str, Any]:
    window = await get_window_for(ctx, window_id)
    hour = parse_hour(hour_text)
    if hour is None:
        raise errors.not_found()
    row = await ctx.conn.fetchrow(
        "SELECT * FROM hours WHERE window_id = $1 AND hour_utc = $2", window_id, hour
    )
    if row is None:
        raise errors.not_found()
    site = await load_site(ctx.conn, window["site_id"])
    tz = tz_for(site)
    lines = await load_lines(ctx.conn, window_id)
    matched_map = rules.hour_matched(lines)
    lot_names = {l["id"]: l["name"] for l in await load_lots(ctx.conn, window_id)}
    hour_lines = [l for l in lines if l["hour_utc"] == hour]
    return {
        "hour_utc": format_hour(hour),
        "local_label": local_label(hour, tz, repeated=is_repeated_hour(hour, tz)),
        "consumed_wh": row["consumed_wh"],
        "matched_wh": min(row["consumed_wh"] or 0, matched_map.get(hour, 0)),
        "quality": row["quality"],
        "substitution_reason": row["substitution_reason"] if row["quality"] == "Substituted" else None,
        "lines": [line_json(l, lot_names.get(l["lot_id"])) for l in hour_lines],
    }

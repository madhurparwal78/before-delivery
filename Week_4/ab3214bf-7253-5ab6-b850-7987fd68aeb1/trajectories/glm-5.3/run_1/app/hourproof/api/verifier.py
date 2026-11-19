"""Verifier writes: sample results, return, complete, sign, key rotation; and
the lead's policy, verifier assignment and group scores.
"""
from __future__ import annotations

import base64
import hashlib
import json
from typing import Any

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import (
    Encoding, NoEncryption, PrivateFormat, PublicFormat, load_pem_private_key,
)

from .. import clock
from ..copy import message_for
from ..domain import rules
from ..domain.exact import basis_points
from ..domain.states import (
    AWAITING_METERS, CANCELLING, CANCELLED, IN_REVIEW, RECONCILING, RESTATED,
    RETURNED, SEALED, SIGNED,
)
from ..domain.timeline import format_instant
from ..providers.services import PRESS, STORE, ProviderUnavailable
from . import errors
from .routes import (
    Ctx, get_window_for, in_state, int_field, line_json, text_field, verifier_window,
)
from .service import (
    bump_revision, consumed_of, decorate_lots, grain_scores, load_bundles, load_hours,
    load_lines, load_lots, load_site, load_window, matched_total, residual_emissions,
    tz_for, window_json,
)


def _wrong(window: dict[str, Any]) -> None:
    raise errors.wrong_state(window["state"])


async def sample_get(ctx: Ctx, window_id: str) -> dict[str, Any]:
    window = await verifier_window(ctx, window_id)
    rows = await ctx.conn.fetch(
        "SELECT * FROM sample_hours WHERE window_id = $1 ORDER BY draw_index", window_id
    )
    if not rows:
        _wrong(window)
    hours = {h["hour_utc"]: h for h in await load_hours(ctx.conn, window_id)}
    lines = await load_lines(ctx.conn, window_id)
    lot_names = {l["id"]: l["name"] for l in await load_lots(ctx.conn, window_id)}
    matched_map = rules.hour_matched(lines)
    by_hour: dict[Any, list[dict[str, Any]]] = {}
    for line in lines:
        by_hour.setdefault(line["hour_utc"], []).append(line)
    out = []
    for row in rows:
        hour = row["hour_utc"]
        h = hours.get(hour)
        out.append({
            "hour_utc": hour.strftime("%Y-%m-%dT%H:00:00Z"),
            "consumed_wh": h["consumed_wh"] if h else None,
            "matched_wh": min((h["consumed_wh"] or 0) if h else 0, matched_map.get(hour, 0)),
            "quality": h["quality"] if h else None,
            "lines": [line_json(l, lot_names.get(l["lot_id"])) for l in by_hour.get(hour, [])],
            "result": row["result"],
            "note": row["note"],
        })
    return {"allocation_digest": window["allocation_digest"], "hours": out}


async def sample_put(ctx: Ctx, window_id: str, hour_text: str) -> dict[str, Any]:
    ctx.require("verifier")
    window = await verifier_window(ctx, window_id)
    if window["state"] != IN_REVIEW:
        _wrong(window)
    from ..domain.timeline import parse_hour
    hour = parse_hour(hour_text)
    if hour is None:
        raise errors.not_found()
    row = await ctx.conn.fetchrow(
        "SELECT * FROM sample_hours WHERE window_id = $1 AND hour_utc = $2", window_id, hour
    )
    if row is None:
        raise errors.not_found()
    result = ctx.body.get("result")
    if result not in ("agree", "exception"):
        raise errors.field_error("result")
    note = ctx.body.get("note")
    if result == "exception":
        if not isinstance(note, str) or not note.strip() or len(note) > 2000:
            raise errors.field_error("note")
    elif note is not None:
        if not isinstance(note, str) or len(note) > 2000:
            raise errors.field_error("note")
    await ctx.conn.execute(
        "UPDATE sample_hours SET result = $1, note = $2 WHERE window_id = $3 AND hour_utc = $4",
        result, note, window_id, hour,
    )
    return {"hour_utc": hour.strftime("%Y-%m-%dT%H:00:00Z"), "result": result, "note": note}


async def review_return(ctx: Ctx, window_id: str) -> dict[str, Any]:
    user = ctx.require("verifier")
    window = await verifier_window(ctx, window_id)
    in_state(window, (IN_REVIEW,))
    reason = text_field(ctx, "reason", minimum=1, maximum=2000)
    await ctx.conn.execute(
        "UPDATE windows SET state = $1, returned_reason = $2 WHERE id = $3",
        RETURNED, reason, window_id,
    )
    await bump_revision(ctx.conn, window, user["name"])
    window = await load_window(ctx.conn, window_id)
    return await window_json(ctx.conn, window)


async def review_complete(ctx: Ctx, window_id: str) -> dict[str, Any]:
    user = ctx.require("verifier")
    window = await verifier_window(ctx, window_id)
    in_state(window, (IN_REVIEW,))
    rows = await ctx.conn.fetch(
        "SELECT * FROM sample_hours WHERE window_id = $1", window_id
    )
    missing = [r for r in rows if r["result"] is None]
    if not rows or missing:
        raise errors.ApiError(
            409, "SAMPLE_INCOMPLETE",
            message_for("SAMPLE_INCOMPLETE", n=len(missing) or 25),
        )
    lines = await load_lines(ctx.conn, window_id)
    pending = any(l["status"] in ("Unsubmitted", "Pending") for l in lines)
    new_state = CANCELLING if pending else CANCELLED
    await ctx.conn.execute(
        "UPDATE windows SET state = $1, returned_reason = NULL WHERE id = $2",
        new_state, window_id,
    )
    await bump_revision(ctx.conn, window, user["name"])
    window = await load_window(ctx.conn, window_id)
    return await window_json(ctx.conn, window)


# --- signing and sealing ------------------------------------------------------
def attestation_html(code: str, site_name: str, month: str, scores: dict[str, int],
                     opinion: str, firm_name: str, consumed_wh: int,
                     hour_matched_wh: int, digest: str) -> str:
    def mwh(wh: int) -> str:
        return f"{wh // 1_000_000}.{wh % 1_000_000:06d}"

    def esc(text: str) -> str:
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    def pct_str(bp: int) -> str:
        return f"{bp // 100}.{bp % 100:02d}"

    rows = [
        f"Statement {esc(code)}",
        f"Site {esc(site_name)}",
        f"Month {month}",
        f"Month score {pct_str(scores['month_bp'])}%",
        f"Week score {pct_str(scores['week_bp'])}%",
        f"Day score {pct_str(scores['day_bp'])}%",
        f"Hour score {pct_str(scores['hour_bp'])}%",
        f"Consumed {mwh(consumed_wh)} MWh",
        f"Hour matched {mwh(hour_matched_wh)} MWh",
        f"Opinion {esc(opinion)}",
        f"Verifier firm {esc(firm_name)}",
        f"Allocation digest {digest}",
    ]
    body = "".join(f"<div>{row}</div>" for row in rows)
    return (
        "<html><head><meta charset='utf-8'><style>"
        "body{font-family:DejaVu Sans,sans-serif;margin:48px}"
        "div{font-size:16pt;margin:8pt 0}"
        "</style></head><body>" + body + "</body></html>"
    )


def _load_private(pem: str) -> Ed25519PrivateKey:
    key = load_pem_private_key(pem.encode(), password=None)
    return key


async def sign_window(ctx: Ctx, window_id: str) -> tuple[int, dict[str, Any]]:
    user = ctx.require("verifier")
    window = await verifier_window(ctx, window_id)
    in_state(window, (CANCELLED,))
    typed = ctx.body.get("typed_name")
    if not isinstance(typed, str) or typed != user["name"]:
        raise errors.field_error("typed_name")
    conn = ctx.conn
    key_row = await conn.fetchrow(
        "SELECT * FROM firm_keys WHERE key_id ="
        " (SELECT current_key_id FROM firms WHERE id = $1)",
        user["firm_id"],
    )
    if key_row is None:
        raise errors.not_found()
    site = await load_site(conn, window["site_id"])
    tz = tz_for(site)
    hours = await load_hours(conn, window_id)
    lots = await load_lots(conn, window_id)
    bundles = await load_bundles(conn, window_id)
    lines = await load_lines(conn, window_id)
    decorate_lots(site, lots, lines, clock.now())
    scores = grain_scores(hours, window["month"], tz, lots, bundles, lines)
    consumed = consumed_of(hours)
    matched = matched_total(lines, hours)
    non_actual = sum(h["consumed_wh"] or 0 for h in hours if h["quality"] != "Actual")
    opinion = "Qualified" if non_actual * 100 > consumed * 5 else "Unqualified"
    exceptions = await conn.fetchval(
        "SELECT COUNT(*) FROM sample_hours WHERE window_id = $1 AND result = 'exception'",
        window_id,
    )
    if exceptions > 0:
        opinion = "Qualified"
    firm_name = (await conn.fetchrow(
        "SELECT name FROM firms WHERE id = $1", user["firm_id"]
    ))["name"]
    signed_at = clock.now()
    sig_count = window["signatures_count"] + 1
    code = f"HP-{window['month'].split('-')[0]}-{window['month'].split('-')[1]}-{site['code']}-{sig_count}"
    payload = {
        "window_id": window_id,
        "site_name": site["name"],
        "month": window["month"],
        "month_bp": scores["month"],
        "week_bp": scores["week"],
        "day_bp": scores["day"],
        "hour_bp": scores["hour"],
        "opinion": opinion,
        "firm_name": firm_name,
        "consumed_wh": consumed,
        "hour_matched_wh": matched,
        "allocation_digest": window["allocation_digest"],
        "signed_at": format_instant(signed_at),
    }
    payload_text = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    private = _load_private(key_row["private_key_pem"])
    signature = private.sign(payload_text.encode("utf-8"))
    existing = await conn.fetchrow("SELECT * FROM statements WHERE window_id = $1", window_id)
    if existing is None:
        await conn.execute(
            "INSERT INTO statements (code, window_id, state, signed_at, key_id,"
            " attestation_payload, attestation_signature)"
            " VALUES ($1,$2,$3,$4,$5,$6,$7)",
            code, window_id, "Sealed", signed_at, key_row["key_id"], payload_text,
            base64.b64encode(signature).decode(),
        )
        await conn.execute(
            "UPDATE windows SET state = $1, seal_status = 'held_press', statement_code = $2,"
            " signatures_count = $3, target_grain = $4, target_bp = $5, frozen_target = true"
            " WHERE id = $6",
            SIGNED, code, sig_count,
            window["target_grain"] or site["target_grain"],
            window["target_bp"] if window["target_bp"] is not None else site["target_bp"],
            window_id,
        )
    else:
        code = existing["code"]
    window = await load_window(conn, window_id)
    sealed = await _try_seal(ctx, window_id, code)
    window = await load_window(conn, window_id)
    if sealed:
        return 200, {"window": await window_json(conn, window), "statement_code": code,
                     "landing_url": f"/check/{code}"}
    held = message_for("HELD_PRESS") if window["seal_status"] == "held_press" \
        else message_for("HELD_STORE")
    return 202, {"window": await window_json(conn, window), "statement_code": code,
                 "message": held}


async def _try_seal(ctx: Ctx, window_id: str, code: str) -> bool:
    """Render, sign the PDF, store, read back and compare. True when sealed."""
    conn = ctx.conn
    statement = await conn.fetchrow("SELECT * FROM statements WHERE code = $1", code)
    if statement is None or statement["pdf_sha256"] is not None:
        return statement is not None and statement["pdf_sha256"] is not None
    payload = json.loads(statement["attestation_payload"])
    html = attestation_html(
        code, payload["site_name"], payload["month"],
        {"month_bp": payload["month_bp"], "week_bp": payload["week_bp"],
         "day_bp": payload["day_bp"], "hour_bp": payload["hour_bp"]},
        payload["opinion"], payload["firm_name"], payload["consumed_wh"],
        payload["hour_matched_wh"], payload["allocation_digest"],
    )
    key_row = await conn.fetchrow(
        "SELECT * FROM firm_keys WHERE key_id = $1", statement["key_id"]
    )
    private = _load_private(key_row["private_key_pem"])
    try:
        pdf = await PRESS.render(html)
    except ProviderUnavailable:
        await conn.execute(
            "UPDATE windows SET seal_status = 'held_press' WHERE id = $1", window_id
        )
        return False
    digest = hashlib.sha256(pdf).hexdigest()
    pdf_sig = private.sign(pdf)
    object_key = f"attestations/{code}.pdf"
    try:
        await STORE.put(object_key, pdf)
        fetched = await STORE.get(object_key)
    except ProviderUnavailable:
        await conn.execute(
            "UPDATE windows SET seal_status = 'held_store' WHERE id = $1", window_id
        )
        return False
    if hashlib.sha256(fetched).hexdigest() != digest:
        await conn.execute(
            "UPDATE windows SET seal_status = 'held_store' WHERE id = $1", window_id
        )
        return False
    await conn.execute(
        "UPDATE statements SET pdf_sha256 = $1, pdf_signature = $2, pdf_object_key = $3"
        " WHERE code = $4",
        digest, base64.b64encode(pdf_sig).decode(), object_key, code,
    )
    await conn.execute(
        "UPDATE windows SET state = $1, seal_status = 'sealed' WHERE id = $2",
        SEALED, window_id,
    )
    return True


async def rotate_key(ctx: Ctx, firm_id: str) -> dict[str, Any]:
    user = ctx.require("verifier")
    if user["firm_id"] != firm_id:
        raise errors.not_found()
    private = Ed25519PrivateKey.generate()
    pem = private.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()).decode()
    raw = private.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    public_b64 = base64.b64encode(raw).decode()
    key_id = hashlib.sha256(raw).hexdigest()[:16]
    await ctx.conn.execute(
        "INSERT INTO firm_keys (key_id, firm_id, private_key_pem, public_key_b64, created_at)"
        " VALUES ($1,$2,$3,$4,$5)",
        key_id, firm_id, pem, public_b64, clock.now(),
    )
    await ctx.conn.execute(
        "UPDATE firms SET current_key_id = $1 WHERE id = $2", key_id, firm_id
    )
    return {"firm_id": firm_id, "key_id": key_id, "public_key": public_b64}


# --- lead actions -------------------------------------------------------------
async def policy_put(ctx: Ctx, site_id: str) -> dict[str, Any]:
    ctx.require("lead")
    site = await load_site(ctx.conn, site_id)
    if site is None:
        raise errors.not_found()
    grain = ctx.body.get("target_grain")
    if grain not in ("MONTH", "WEEK", "DAY", "HOUR"):
        raise errors.field_error("target_grain")
    bp = int_field(ctx, "target_bp", minimum=0, maximum=10000)
    await ctx.conn.execute(
        "UPDATE sites SET target_grain = $1, target_bp = $2 WHERE id = $3",
        grain, bp, site_id,
    )
    return {"site_id": site_id, "target_grain": grain, "target_bp": bp}


async def verifier_put(ctx: Ctx, window_id: str) -> dict[str, Any]:
    ctx.require("lead")
    window = await get_window_for(ctx, window_id)
    in_state(window, (AWAITING_METERS, RECONCILING, RETURNED))
    firm_id = ctx.body.get("firm_id")
    firm = await ctx.conn.fetchrow("SELECT * FROM firms WHERE id = $1", firm_id)
    if firm is None:
        raise errors.field_error("firm_id")
    if window["verifier_firm_id"] == firm_id:
        return await window_json(ctx.conn, window)
    await ctx.conn.execute(
        "UPDATE windows SET verifier_firm_id = $1 WHERE id = $2", firm_id, window_id
    )
    await ctx.conn.execute("DELETE FROM sample_hours WHERE window_id = $1", window_id)
    window = await load_window(ctx.conn, window_id)
    return await window_json(ctx.conn, window)


async def firms_get(ctx: Ctx) -> dict[str, Any]:
    ctx.require("lead")
    rows = await ctx.conn.fetch("SELECT id, name FROM firms ORDER BY id")
    return {"firms": [{"id": r["id"], "name": r["name"]} for r in rows]}


async def group_scores(ctx: Ctx) -> dict[str, Any]:
    ctx.require("lead")
    windows = [dict(r) for r in await ctx.conn.fetch(
        "SELECT w.* FROM windows w JOIN sites s ON s.id = w.site_id"
        " ORDER BY w.month DESC, s.name ASC, w.id DESC"
    )]
    window_rows = [await window_json(ctx.conn, w) for w in windows]
    months: dict[str, list[dict[str, Any]]] = {}
    for w in windows:
        if w["state"] == RESTATED:
            continue
        months.setdefault(w["month"], []).append(w)
    rollups = []
    for month in sorted(months.keys(), reverse=True):
        members = months[month]
        consumed = 0
        matched_by_grain = {g: 0 for g in rules.GRAINS}
        residual: int | None = 0
        any_null = False
        for w in members:
            site = await load_site(ctx.conn, w["site_id"])
            tz = tz_for(site)
            hours = await load_hours(ctx.conn, w["id"])
            lots = await load_lots(ctx.conn, w["id"])
            bundles = await load_bundles(ctx.conn, w["id"])
            lines = await load_lines(ctx.conn, w["id"])
            decorate_lots(site, lots, lines, clock.now())
            consumed += consumed_of(hours)
            for grain in rules.GRAINS:
                matched_by_grain[grain] += rules.score_for_grain(
                    hours, grain, w["month"], tz, lots, bundles, lines)["matched_wh"]
            r = residual_emissions(hours, lines)
            if r is None:
                any_null = True
            else:
                residual = (residual or 0) + r
        scores = {f"{g}_bp": basis_points(matched_by_grain[g], consumed)
                  for g in rules.GRAINS}
        rollups.append({
            "month": month,
            "window_count": len(members),
            "consumed_wh": consumed,
            "scores": scores,
            "residual_emissions_g": None if any_null else residual,
        })
    return {"windows": window_rows, "rollups": rollups}
